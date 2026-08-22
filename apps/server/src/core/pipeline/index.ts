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
  /*
    Último mensaje entrante que un turno ya LEYÓ y contestó, por conversación.
    No necesita limpieza: una entrada vieja solo puede volver a coincidir con el
    mismo id de mensaje, y ese id no vuelve a llegar nunca. Crece como
    #errorStreak y por la misma razón: el bot corre en una sola instancia. Cuando
    haya que escalar, esto se muda a una columna junto con el mutex.
  */
  #answered = new Map<string, string>();
  /*
    Conversaciones que tienen que correr un turno aunque el último entrante ya
    esté contestado: el equipo respondió una consulta y el bot le debe esa
    respuesta al cliente. Es un permiso y no un borrado de la marca porque el
    turno que estaba en vuelo la reescribe al terminar, y ahí el permiso se
    perdía sin que nadie se enterara.
  */
  #forzar = new Set<string>();

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
      /*
        Este entrante ya quedó contestado. No se cancela el timer pendiente: si
        llega un mensaje NUEVO, ese turno tiene que correr igual.
      */
      this.#answered.set(conversation.id, stored.id);
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

    const [settings, history, products, quickReplies, activeCampaigns, openOrders] =
      await Promise.all([
        repos.settings.read(),
        repos.messages.history(conversationId, 40),
        repos.products.list(),
        repos.quickReplies.list(),
        repos.campaigns.listActive(),
        repos.orders.list({ conversationId, limit: 5 }),
      ]);

    /*
      Un turno existe para contestar algo nuevo. El reloj del debounce se rearma
      cada vez que el mutex está tomado, así que es normal que dispare un turno
      cuyo último entrante ya contestó el turno anterior: ese mensaje llegó en la
      ventana entre que el timer disparó y que este SELECT corrió, o sea que el
      turno de antes también lo leyó. Correrlo igual es la forma más común de
      mandar dos respuestas casi idénticas, y de cargar dos veces el mismo pedido.

      Se compara contra el historial que este turno LEYÓ, no contra lo que había
      cuando disparó el timer: es lo único que distingue "ya contestado" de
      "todavía sin contestar".
    */
    /*
      `resumeAfterReview` es la única puerta al turno que no pasa por `route()`,
      así que el interruptor general del panel se chequea también acá. Sin esto,
      apagar el bot desde Ajustes no impedía que contestara una consulta resuelta.
    */
    if (!settings.botEnabled) return;

    const forzado = this.#forzar.delete(conversationId);
    const ultimoEntrante = [...history]
      .reverse()
      .find((m) => m.direction === 'in' && m.contentKind !== 'typing');
    if (!ultimoEntrante) return;
    if (!forzado && this.#answered.get(conversationId) === ultimoEntrante.id) {
      log('info', `Turno omitido (${conversationId}): nada nuevo que contestar.`);
      return;
    }
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
        openOrders,
        pendingReview: conversation.pendingReview,
      },
    });

    // --- efectos de las herramientas ----------------------------------------
    /*
      Van ANTES del manejo de errores a propósito: si el modelo escaló y después se
      quedó sin burbujas, la escalada tiene que valer igual. Hasta acá el `return`
      del bloque de errores la descartaba en silencio, y con una consulta de
      modificación eso es peor: el bot seguía habilitado y en el turno siguiente
      cerraba el pedido.
    */
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

    // --- manejo de errores del modelo ---------------------------------------
    if (turn.error || !turn.bubbles.length) {
      const streak = (this.#errorStreak.get(conversationId) ?? 0) + 1;
      this.#errorStreak.set(conversationId, streak);
      log('warn', `Turno sin respuesta (${conversationId}), racha ${streak}`, turn.error);

      /*
        Si escaló y el turno igual se cayó, el cliente no puede quedarse en
        silencio: la conversación ya quedó en 'human', así que el bot no vuelve a
        intentar nunca. Se avisa sin esperar la racha, y no se toca la alerta: el
        motivo de la escalada vale más que "el bot falló N veces".
      */
      if (escalate) {
        /*
          La charla ya quedó en 'human': esta racha pertenece a una sesión del bot
          que terminó. Si no se borra, el primer tropiezo después de que el equipo
          conteste la consulta re-escala con el motivo equivocado y la respuesta
          que el cliente estaba esperando no sale nunca.
        */
        this.#errorStreak.delete(conversationId);
        await this.#send(
          conversationId,
          [
            {
              kind: 'text',
              text: 'Dame un minutito que lo confirmo, ya te escribe alguien del local 🙏🏻',
            },
          ],
          { author: 'system', intent: 'error', handler: 'escalate' },
        );
        return;
      }

      if (streak >= settings.escalateAfterErrors) {
        this.#errorStreak.delete(conversationId);
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
              text: 'Dame un minutito que te contesto bien, ya te escribe alguien del local 🙏🏻',
            },
          ],
          { author: 'system', intent: 'error', handler: 'escalate' },
        );
      }
      return;
    }
    this.#errorStreak.delete(conversationId);
    /*
      Se marca acá y no antes de llamar al modelo. Un turno que falló no contestó
      nada, y el disparo pendiente del debounce es la única segunda oportunidad que
      tiene el cliente: marcarlo por adelantado se la saca. Lo que estamos cerrando
      es la duplicación del turno anterior que SÍ contestó.
      Antes del #send y no después: si el envío se corta a mitad, reintentar manda
      de nuevo las burbujas que ya salieron.
    */
    this.#answered.set(conversationId, ultimoEntrante.id);

    const contents: OutboundContent[] = turn.bubbles.map((text) => ({ kind: 'text', text }));

    /*
      El cliente ya escuchó la respuesta del equipo: recién ahora la consulta deja
      de ser contexto. Se limpia acá y no al contestarla en el panel, porque entre
      las dos cosas el turno puede fallar, y una consulta resuelta que no se borra
      hace que el modelo la anuncie de nuevo en cada turno de las próximas 48 h.
    */
    if (conversation.pendingReview?.resueltoEn) {
      await repos.conversations.clearReview(conversationId);
      await repos.conversations.setAttention(conversationId, false, null);
      const limpia = await repos.conversations.get(conversationId);
      if (limpia) bus.emit({ type: 'conversation', conversation: limpia });
    }

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

  /**
   * El equipo contestó una consulta de modificación: el bot retoma la charla.
   *
   * Hace falta un empujón explícito porque el cliente ya escribió y quedó
   * esperando: sin esto, la respuesta del local queda guardada y el bot no dice
   * nada hasta que la persona vuelva a escribir, que es justo la sensación de
   * "me dejaron colgado" que hay que evitar. Se borra la marca de agua porque el
   * último entrante ya fue contestado ("lo estoy consultando") y sin eso el turno
   * se saltearía solo.
   */
  async resumeAfterReview(conversationId: string): Promise<void> {
    this.#forzar.add(conversationId);
    this.#scheduleAgentTurn(conversationId);
  }

  /**
   * Contestó una persona, así que el turno que el debounce dejó pendiente no
   * tiene que volver a hablar sobre el mismo mensaje del cliente.
   *
   * Contrapartida asumida: después de un mensaje del operador el bot se queda
   * callado sobre ese entrante hasta que el cliente escriba de nuevo. Es lo que
   * corresponde: cuando habla una persona, manda la persona.
   */
  async #marcarContestadoPorPersona(conversationId: string): Promise<void> {
    const previos = await this.#repos.messages.history(conversationId, 10);
    const ultimo = [...previos].reverse().find((m) => m.direction === 'in');
    if (ultimo) this.#answered.set(conversationId, ultimo.id);
  }

  /** API pública para que un operador escriba desde el panel. */
  async sendAsOperator(conversationId: string, text: string): Promise<void> {
    await this.#marcarContestadoPorPersona(conversationId);
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
    await this.#marcarContestadoPorPersona(conversationId);
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
