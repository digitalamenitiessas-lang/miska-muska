/**
 * ENTRADA. Convierte un `InboundMessage` canónico en estado persistido y decide
 * si vale la pena seguir procesando.
 *
 * Responsabilidades (y nada más):
 *  - deduplicar reintentos de webhook
 *  - resolver/crear contacto y conversación
 *  - guardar el mensaje
 *  - publicar el evento para el panel
 *
 * No decide respuestas. Eso es del router.
 */

import type { Repositories } from '../store/repositories.js';
import { bus, log } from '../events/bus.js';
import type { Contact, Conversation, StoredMessage } from '../types/domain.js';
import { describeInbound, type InboundMessage } from '../types/message.js';

export interface IngressResult {
  conversation: Conversation;
  contact: Contact;
  stored: StoredMessage;
}

/** Postgres: violación de restricción única. */
const UNIQUE_VIOLATION = '23505';

export async function ingest(
  repos: Repositories,
  inbound: InboundMessage,
): Promise<IngressResult | null> {
  if (await repos.messages.alreadyProcessed(inbound.channel, inbound.channelMessageId)) {
    log('info', `Mensaje duplicado ignorado (${inbound.channel} ${inbound.channelMessageId})`);
    return null;
  }

  const contact = await repos.contacts.upsert(inbound.channel, inbound.contact);
  const conversation = await repos.conversations.ensure(
    inbound.channel,
    inbound.ref.externalId,
    contact.id,
  );

  const text = describeInbound(inbound.content);

  let stored: StoredMessage;
  try {
    stored = await repos.messages.insert({
      conversationId: conversation.id,
      channel: inbound.channel,
      channelMessageId: inbound.channelMessageId,
      direction: 'in',
      author: 'human',
      contentKind: inbound.content.kind,
      text,
      payload: inbound.content,
      intent: null,
      handler: null,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      costUsd: null,
      model: null,
      error: null,
    });
  } catch (err) {
    // Carrera entre dos webhooks con el mismo id: el índice único la frena. El
    // chequeo de arriba cubre el caso normal; esto cubre el simultáneo.
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      log('info', `Carrera de deduplicación resuelta por el índice (${inbound.channelMessageId})`);
      return null;
    }
    throw err;
  }

  await repos.conversations.markInbound(conversation.id, text, null);

  const refreshed = (await repos.conversations.get(conversation.id))!;
  bus.emit({ type: 'message', conversationId: conversation.id, message: stored });
  bus.emit({ type: 'conversation', conversation: refreshed });

  return { conversation: refreshed, contact, stored };
}
