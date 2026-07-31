/**
 * Orquestación: entrada → procesamiento → salida.
 *
 * Dos detalles que cambian mucho la sensación de la conversación:
 *
 *  - DEBOUNCE. La gente escribe "hola" / "queria consultar" / "por una torta" en
 *    tres mensajes seguidos. Responder cada uno es la marca registrada de un
 *    bot. Se espera una ventana corta y se contesta a todo junto.
 *
 *  - MUTEX por conversación. Sin esto, dos mensajes casi simultáneos disparan
 *    dos turnos de modelo en paralelo que se pisan y duplican respuestas.
 *
 * Los dos viven en memoria, y por eso el bot corre en UNA sola instancia. Si
 * alguna vez hay que escalar, el mutex pasa a `pg_advisory_lock` y el debounce a
 * una tabla con `run_after`.
 *
 * `core/` no importa nada de `channels/`: el adapter llega por inyección.
 */

import type { ChannelAdapter } from '../types/channel.js';
import type { Repositories } from '../store/repositories.js';
import { bus, log } from '../events/bus.js';
import type {
  ChannelId,
  InboundContent,
  InboundMessage,
  OutboundContent,
} from '../types/message.js';
import { isOutsideBusinessHours } from '../policies/rules.js';
import { renderQuickReply } from '../agent/persona.js';
import { runTurn } from '../agent/brain.js';
import type { ToolContext } from '../agent/tools.js';
import { ingest } from './ingress.js';
import { route } from './router.js';
import { deliver, typingDelay } from './egress.js';

export type AdapterResolver = (channel: ChannelId) => ChannelAdapter | undefined;

/** Ventana de espera para juntar mensajes seguidos del mismo cliente. */
const DEBOUNCE_MS = 1500;

interface SendOptions {
  author: 'bot' | 'human' | 'system';
  intent?: string;
  handler?: string;
  quickReplyKey?: string;
  metrics?: Parameters<typeof deliver>[0]['metrics'];
  humanize?: boolean;
}

export class Pipeline {
  #repos: Repositories;
  #resolve: AdapterResolver;
  #pending = new Map<string, NodeJS.Timeout>();
  #running = new Set<string>();
  #errorStreak = new Map<string, number>();

  constructor(repos: Repositories, resolveAdapter: AdapterResolver) {
    this.#repos = repos;
    this.#resolve = resolveAdapter;
  }

  /** Punto de entrada único desde cualquier canal. */
  async handleInbound(inbound: InboundMessage): Promise<void> {
    const result = await ingest(this.#repos, inbound);
    if (!result) return;

    const { conversation, stored } = result;
    // `payload` viene de una columna jsonb: ya es un objeto, no hay que parsearlo.
    const content = (stored.payload ?? { kind: 'text', text: '' }) as InboundContent;
    const decision = await route({ repos: this.#repos, conversation, content });

    if (decision.kind === 'ignore') {
      log('info', `Sin respuesta automática (${conversation.id}): ${decision.reason}`);
      return;
    }

    const adapter = this.#resolve(conversation.channel);
    if (adapter?.markRead && inbound.channelMessageId) {
      adapter
        .markRead(inbound.channelMessageId, {
          channel: conversation.channel,
          externalId: conversation.externalId,
        })
        .catch(() => undefined);
    }

    if (decision.kind === 'quick-reply') {
      const [settings, products] = await Promise.all([
        this.#repos.settings.read(),
        this.#repos.products.list(),
      ]);
      const text = renderQuickReply(decision.quickReply.body, settings, products);
      await this.#repos.quickReplies.countUse(decision.quickReply.key);
      await this.#send(conversation.id, [{ kind: 'text', text }], {
        author: 'bot',
        intent: 'mensaje_rapido',
        handler: 'quick-reply',
        quickReplyKey: decision.quickReply.key,
      });
      return;
    }

    this.#scheduleAgentTurn(conversation.id);
  }

  /** Coalesce: si llega otro mensaje, se reinicia el reloj. */
  #scheduleAgentTurn(conversationId: string): void {
    const existing = this.#pending.get(conversationId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.#pending.delete(conversationId);
      void this.#runAgentTurn(conversationId);
    }, DEBOUNCE_MS);
    this.#pending.set(conversationId, timer);
  }

  async #runAgentTurn(conversationId: string): Promise<void> {
    if (this.#running.has(conversationId)) {
      // Ya hay un turno en vuelo: se reprograma para después.
      this.#scheduleAgentTurn(conversationId);
      return;
    }
    this.#running.add(conversationId);
    try {
      await this.#agentTurn(conversationId);
    } catch (err) {
      log('error', `Turno del agente falló (${conversationId})`, err);
    } finally {
      this.#running.delete(conversationId);
    }
  }

  async #agentTurn(conversationId: string): Promise<void> {
    const repos = this.#repos;
    const conversation = await repos.conversations.get(conversationId);
    if (!conversation) return;
    // El estado puede haber cambiado mientras esperábamos el debounce.
    if (conversation.mode !== 'bot') return;

    const contact = await repos.contacts.get(conversation.contactId);
    if (!contact) return;

    const [settings, history, products, quickReplies, activeCampaigns] = await Promise.all([
      repos.settings.read(),
      repos.messages.history(conversationId, 40),
      repos.products.list(),
      repos.quickReplies.list(),
      repos.campaigns.listActive(),
    ]);
    const campaigns = await Promise.all(
      activeCampaigns.map(async (campaign) => ({
        campaign,
        skus: await repos.campaigns.skus(campaign.id),
      })),
    );

    const toolContext: ToolContext = { repos, conversation, contact, settings, effects: {} };

    const turn = await runTurn({
      settings,
      history,
      toolContext,
      dailyContext: {
        settings,
        products,
        campaigns,
        quickReplies,
        contact,
        outsideHours: isOutsideBusinessHours(settings),
      },
    });

    // --- manejo de errores del modelo ---------------------------------------
    if (turn.error || !turn.bubbles.length) {
      const streak = (this.#errorStreak.get(conversationId) ?? 0) + 1;
      this.#errorStreak.set(conversationId, streak);
      log('warn', `Turno sin respuesta (${conversationId}), racha ${streak}`, turn.error);

      if (streak >= settings.escalateAfterErrors) {
        await repos.conversations.setMode(conversationId, 'human');
        await repos.conversations.setAttention(
          conversationId,
          true,
          turn.refused
            ? `El modelo declinó responder: ${turn.error}`
            : `El bot falló ${streak} veces seguidas: ${turn.error ?? 'sin respuesta'}`,
        );
        const refreshed = await repos.conversations.get(conversationId);
        if (refreshed) bus.emit({ type: 'conversation', conversation: refreshed });
        await this.#send(
          conversationId,
          [
            {
              kind: 'text',
              text: 'Dame un minutito que te contesto bien 🙏🏻 ya te escribe alguien del local 💕',
            },
          ],
          { author: 'system', intent: 'error', handler: 'escalate' },
        );
      }
      return;
    }
    this.#errorStreak.delete(conversationId);

    // --- efectos de las herramientas ----------------------------------------
    const { escalate } = toolContext.effects;
    if (escalate) {
      await repos.conversations.setMode(conversationId, 'human');
      await repos.conversations.setAttention(
        conversationId,
        true,
        `[${escalate.reason}] ${escalate.summary}`,
      );
      const refreshed = await repos.conversations.get(conversationId);
      if (refreshed) bus.emit({ type: 'conversation', conversation: refreshed });
    }

    const contents: OutboundContent[] = turn.bubbles.map((text) => ({ kind: 'text', text }));

    await this.#send(conversationId, contents, {
      author: 'bot',
      intent: turn.intent,
      handler: escalate ? 'escalate' : 'agent',
      quickReplyKey: toolContext.effects.quickReplyUsed,
      metrics: {
        latencyMs: turn.latencyMs,
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        cacheReadTokens: turn.cacheReadTokens,
        costUsd: turn.costUsd,
        model: turn.model,
      },
    });
  }

  /** Envío usado por el pipeline y por el panel (mensajes del operador). */
  async #send(
    conversationId: string,
    contents: OutboundContent[],
    opts: SendOptions,
  ): Promise<void> {
    const conversation = await this.#repos.conversations.get(conversationId);
    if (!conversation) return;
    const adapter = this.#resolve(conversation.channel);
    if (!adapter) {
      log('error', `No hay adapter activo para ${conversation.channel}; no envío nada.`);
      return;
    }
    await deliver({
      repos: this.#repos,
      adapter,
      conversation,
      settings: await this.#repos.settings.read(),
      contents,
      author: opts.author,
      intent: opts.intent,
      handler: opts.handler,
      quickReplyKey: opts.quickReplyKey,
      metrics: opts.metrics,
      humanize: opts.humanize,
    });
  }

  /** API pública para que un operador escriba desde el panel. */
  async sendAsOperator(conversationId: string, text: string): Promise<void> {
    await this.#send(conversationId, [{ kind: 'text', text }], {
      author: 'human',
      handler: 'operator',
      humanize: false,
    });
  }

  /** API pública para reenviar un mensaje rápido desde el panel. */
  async sendQuickReply(conversationId: string, key: string): Promise<boolean> {
    const qr = await this.#repos.quickReplies.get(key);
    if (!qr) return false;
    const [settings, products] = await Promise.all([
      this.#repos.settings.read(),
      this.#repos.products.list(),
    ]);
    const text = renderQuickReply(qr.body, settings, products);
    await this.#repos.quickReplies.countUse(key);
    await this.#send(conversationId, [{ kind: 'text', text }], {
      author: 'human',
      intent: 'mensaje_rapido',
      handler: 'operator',
      quickReplyKey: key,
      humanize: false,
    });
    return true;
  }

  /** Expuesto para pruebas del retardo de tipeo. */
  static typingDelay = typingDelay;
}
