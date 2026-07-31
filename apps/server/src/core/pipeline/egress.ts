/**
 * SALIDA. Toma contenidos canónicos y los pone en el canal.
 *
 * Acá vive todo lo que hace que el bot no se sienta un bot:
 *  - degradar el contenido a lo que el canal soporta
 *  - partir textos largos
 *  - indicador de "escribiendo…" con un retardo proporcional al largo
 *  - persistir cada mensaje enviado y publicarlo al panel
 *
 * El pipeline no sabe si el canal es Telegram o WhatsApp; solo pasa el adapter.
 */

import type { ChannelAdapter } from '../types/channel.js';
import { degradeForChannel } from '../types/channel.js';
import type { Repositories } from '../store/repositories.js';
import { bus, log } from '../events/bus.js';
import type { BotSettings, Conversation } from '../types/domain.js';
import {
  describeOutbound,
  type MessageAuthor,
  type OutboundContent,
  type OutboundMessage,
} from '../types/message.js';

export interface DeliverInput {
  repos: Repositories;
  adapter: ChannelAdapter;
  conversation: Conversation;
  settings: BotSettings;
  contents: OutboundContent[];
  author: MessageAuthor;
  intent?: string;
  handler?: string;
  quickReplyKey?: string;
  /** Métricas del turno del modelo, si vienen. Se guardan en el primer mensaje. */
  metrics?: {
    latencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    costUsd?: number;
    model?: string | null;
  };
  /** false para tests: envía sin simular tipeo. */
  humanize?: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Cuánto "tardaría" una persona en escribir esto. */
export function typingDelay(text: string, settings: BotSettings): number {
  const base = Math.min(text.length * settings.typingMsPerChar, settings.maxTypingMs);
  // Un piso para que no se sienta instantáneo ni siquiera en respuestas cortas.
  return Math.max(600, Math.round(base));
}

export async function deliver(input: DeliverInput): Promise<void> {
  const { repos, adapter, conversation, settings, contents, author } = input;
  const humanize = input.humanize ?? true;

  const ref = {
    channel: conversation.channel,
    externalId: conversation.externalId,
  };

  let first = true;
  for (const content of contents) {
    for (const piece of degradeForChannel(content, adapter.capabilities)) {
      if (piece.kind === 'typing') {
        if (humanize) {
          await adapter.setTyping?.(ref, piece.durationMs).catch(() => undefined);
          await sleep(piece.durationMs);
        }
        continue;
      }

      const text = describeOutbound(piece);

      if (humanize && piece.kind === 'text') {
        const delay = typingDelay(text, settings);
        bus.emit({ type: 'typing', conversationId: conversation.id, on: true });
        await adapter.setTyping?.(ref, delay).catch(() => undefined);
        await sleep(delay);
        bus.emit({ type: 'typing', conversationId: conversation.id, on: false });
      }

      // Se guarda ANTES de enviar para que el panel vea el intento incluso si
      // el canal falla; después se completa con el id del proveedor o el error.
      const stored = await repos.messages.insert({
        conversationId: conversation.id,
        channel: conversation.channel,
        channelMessageId: null,
        direction: 'out',
        author,
        contentKind: piece.kind,
        text,
        payload: piece,
        intent: input.intent ?? null,
        handler: input.handler ?? null,
        latencyMs: first ? (input.metrics?.latencyMs ?? null) : null,
        inputTokens: first ? (input.metrics?.inputTokens ?? null) : null,
        outputTokens: first ? (input.metrics?.outputTokens ?? null) : null,
        cacheReadTokens: first ? (input.metrics?.cacheReadTokens ?? null) : null,
        costUsd: first ? (input.metrics?.costUsd ?? null) : null,
        model: first ? (input.metrics?.model ?? null) : null,
        error: null,
      });
      first = false;

      const message: OutboundMessage = {
        conversationId: conversation.id,
        ref,
        content: piece,
        meta: {
          author,
          intent: input.intent,
          handler: input.handler,
          quickReplyKey: input.quickReplyKey,
        },
      };

      const result = await adapter.send(message);
      await repos.messages.setChannelMessageId(
        stored.id,
        result.channelMessageId ?? null,
        result.ok ? null : (result.error ?? 'error desconocido'),
      );

      if (!result.ok) {
        log('error', `No pude enviar por ${adapter.id}`, result.error);
        if (result.outsideServiceWindow) {
          await repos.conversations.setAttention(
            conversation.id,
            true,
            'Pasaron más de 24 h desde el último mensaje del cliente: solo se puede escribir con una plantilla aprobada.',
          );
        }
      }

      await repos.conversations.markOutbound(conversation.id, text);
      bus.emit({
        type: 'message',
        conversationId: conversation.id,
        message: { ...stored, error: result.ok ? null : (result.error ?? 'error') },
      });
    }
  }

  const refreshed = await repos.conversations.get(conversation.id);
  if (refreshed) bus.emit({ type: 'conversation', conversation: refreshed });
}
