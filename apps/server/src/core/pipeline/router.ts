/**
 * PROCESAMIENTO. Decide qué hacer con un mensaje ya ingresado.
 *
 * El orden importa y es barato antes de ser caro:
 *   1. ¿el bot está apagado o la conversación la tomó una persona? → no responder
 *   2. ¿hay un mensaje rápido con `autoSend` que matchea exacto? → responder sin LLM
 *   3. → LLM con herramientas
 *
 * El paso 2 existe porque hay consultas que llegan cien veces por día con la
 * misma respuesta pulida; gastar un turno de modelo en eso es tirar plata. Pero
 * está apagado por defecto en todos los mensajes rápidos: el equipo lo habilita
 * desde el panel cuando confía en el match.
 */

import type { Conversation, QuickReply } from '../types/domain.js';
import type { Repositories } from '../store/repositories.js';
import type { InboundContent } from '../types/message.js';

export type Decision =
  | { kind: 'ignore'; reason: string }
  | { kind: 'quick-reply'; quickReply: QuickReply }
  | { kind: 'agent' };

/** Normaliza para comparar: minúsculas, sin tildes, sin signos. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sugiere mensajes rápidos por coincidencia de disparadores. Se usa tanto para
 * el auto-envío como para mostrarle sugerencias al operador en el panel.
 */
export function matchQuickReplies(text: string, quickReplies: QuickReply[]): QuickReply[] {
  const haystack = normalize(text);
  if (!haystack) return [];
  const scored = quickReplies
    .map((qr) => {
      let score = 0;
      for (const trigger of qr.triggers) {
        const needle = normalize(trigger);
        if (!needle) continue;
        if (haystack === needle) score += 10;
        else if (new RegExp(`\\b${escapeRegExp(needle)}\\b`).test(haystack)) score += 3;
        else if (haystack.includes(needle)) score += 1;
      }
      return { qr, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((s) => s.qr);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface RouteInput {
  repos: Repositories;
  conversation: Conversation;
  content: InboundContent;
}

export async function route({ repos, conversation, content }: RouteInput): Promise<Decision> {
  const settings = await repos.settings.read();

  if (!settings.botEnabled) {
    return { kind: 'ignore', reason: 'El bot está apagado desde el panel.' };
  }
  if (conversation.mode === 'human') {
    return { kind: 'ignore', reason: 'La conversación la está atendiendo una persona.' };
  }
  if (conversation.mode === 'muted') {
    return { kind: 'ignore', reason: 'Conversación silenciada.' };
  }
  if (!settings.activeChannels.includes(conversation.channel)) {
    return { kind: 'ignore', reason: `El canal ${conversation.channel} está desactivado.` };
  }

  // Audio y stickers no se transcriben: van a una persona en vez de a un LLM
  // que no puede oírlos.
  if (content.kind === 'audio') {
    return { kind: 'agent' };
  }

  const text = content.kind === 'text' ? content.text : content.kind === 'interactive' ? content.title : '';
  if (text) {
    const candidates = matchQuickReplies(text, await repos.quickReplies.list());
    const auto = candidates.find((qr) => qr.autoSend);
    // Solo auto-responde si el mensaje es corto: un texto largo casi siempre
    // trae contexto que merece una respuesta pensada.
    if (auto && normalize(text).split(' ').length <= 6) {
      return { kind: 'quick-reply', quickReply: auto };
    }
  }

  return { kind: 'agent' };
}
