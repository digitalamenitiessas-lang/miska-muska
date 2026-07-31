/**
 * Puerto de canal (hexagonal). El pipeline depende SOLO de esta interfaz.
 * Agregar WhatsApp = implementar `ChannelAdapter`, registrarlo, y nada más
 * cambia en `core/`.
 */

import type {
  ChannelId,
  ConversationRef,
  InboundMessage,
  OutboundContent,
  OutboundMessage,
  SendResult,
} from './message.js';

/**
 * Lo que sabe hacer un canal. El renderer de cada adaptador consulta esto para
 * degradar contenidos no soportados en vez de fallar.
 */
export interface ChannelCapabilities {
  /** Máximo de caracteres por mensaje de texto. */
  maxTextLength: number;
  /** Botones de respuesta rápida (0 = no soportado). WhatsApp: 3. Telegram: ~8 útiles. */
  maxButtons: number;
  /** Longitud máxima del título de un botón. WhatsApp: 20. */
  maxButtonTitleLength: number;
  /** Filas totales en un mensaje de lista (0 = no soportado). WhatsApp: 10. */
  maxListRows: number;
  supportsImages: boolean;
  supportsDocuments: boolean;
  supportsTypingIndicator: boolean;
  supportsReadReceipts: boolean;
  /**
   * true si el canal impone una ventana de atención al cliente (WhatsApp: 24 h
   * desde el último mensaje del usuario) fuera de la cual solo se pueden enviar
   * plantillas aprobadas.
   */
  hasServiceWindow: boolean;
  serviceWindowHours?: number;
}

/** El pipeline expone esto al adaptador para recibir mensajes normalizados. */
export type InboundSink = (message: InboundMessage) => Promise<void>;

export interface MediaPayload {
  data: Buffer;
  mimeType: string;
  filename?: string;
}

export interface ChannelAdapter {
  readonly id: ChannelId;
  readonly capabilities: ChannelCapabilities;

  /** Arranca el transporte (long polling en Telegram, nada en webhook puro). */
  start(sink: InboundSink): Promise<void>;
  stop(): Promise<void>;

  /**
   * Normaliza un payload crudo de webhook a 0..n mensajes canónicos.
   * Separado de `start()` para que el endpoint HTTP pueda delegar acá.
   */
  parseWebhook(body: unknown, headers: Record<string, string | undefined>): InboundMessage[];

  /** Verificación del handshake de webhook (WhatsApp usa hub.challenge). */
  verifyWebhook?(query: Record<string, string | undefined>): string | null;

  send(message: OutboundMessage): Promise<SendResult>;

  downloadMedia?(mediaId: string): Promise<MediaPayload>;
  markRead?(channelMessageId: string, ref: ConversationRef): Promise<void>;
  setTyping?(ref: ConversationRef, durationMs: number): Promise<void>;

  /** Chequeo de salud para el panel. */
  health(): Promise<{ ok: boolean; detail?: string }>;
}

/**
 * Divide un texto en trozos que respeten el límite del canal, cortando por
 * párrafo/oración y nunca a mitad de palabra.
 */
export function splitForChannel(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('. ', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * Degrada un contenido de salida a lo que el canal soporta. Devuelve una lista
 * porque un contenido puede convertirse en varios mensajes.
 */
export function degradeForChannel(
  content: OutboundContent,
  caps: ChannelCapabilities,
): OutboundContent[] {
  switch (content.kind) {
    case 'text':
      return splitForChannel(content.text, caps.maxTextLength).map((t) => ({
        kind: 'text' as const,
        text: t,
        previewUrl: content.previewUrl,
      }));

    case 'buttons': {
      if (caps.maxButtons === 0) {
        const numbered = content.buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
        return degradeForChannel({ kind: 'text', text: `${content.text}\n\n${numbered}` }, caps);
      }
      const buttons = content.buttons
        .slice(0, caps.maxButtons)
        .map((b) => ({ id: b.id, title: b.title.slice(0, caps.maxButtonTitleLength) }));
      // Los botones que no entran se listan como texto para no perder opciones.
      const overflow = content.buttons.slice(caps.maxButtons);
      const text =
        overflow.length > 0
          ? `${content.text}\n\n${overflow.map((b) => `• ${b.title}`).join('\n')}`
          : content.text;
      return [{ ...content, text: text.slice(0, caps.maxTextLength), buttons }];
    }

    case 'list': {
      const rows = content.sections.flatMap((s) => s.rows);
      if (caps.maxListRows === 0) {
        if (caps.maxButtons > 0 && rows.length <= caps.maxButtons) {
          return degradeForChannel(
            {
              kind: 'buttons',
              text: content.text,
              footer: content.footer,
              buttons: rows.map((r) => ({ id: r.id, title: r.title })),
            },
            caps,
          );
        }
        const numbered = rows
          .map((r, i) => `${i + 1}. ${r.title}${r.description ? ` — ${r.description}` : ''}`)
          .join('\n');
        return degradeForChannel({ kind: 'text', text: `${content.text}\n\n${numbered}` }, caps);
      }
      // Recorta secciones hasta caber en maxListRows sin romper el orden.
      let budget = caps.maxListRows;
      const sections: typeof content.sections = [];
      for (const section of content.sections) {
        if (budget <= 0) break;
        const take = section.rows.slice(0, budget);
        budget -= take.length;
        sections.push({ ...section, rows: take });
      }
      return [{ ...content, sections }];
    }

    case 'image':
      return caps.supportsImages
        ? [content]
        : degradeForChannel(
            { kind: 'text', text: [content.caption, content.url].filter(Boolean).join('\n') },
            caps,
          );

    case 'document':
      return caps.supportsDocuments
        ? [content]
        : degradeForChannel(
            { kind: 'text', text: [content.caption, content.url].filter(Boolean).join('\n') },
            caps,
          );

    case 'template':
      // Sin ventana de servicio la plantilla no aporta nada: es texto.
      if (!caps.hasServiceWindow) {
        return degradeForChannel({ kind: 'text', text: content.variables.join(' ') }, caps);
      }
      return [content];

    case 'typing':
      return caps.supportsTypingIndicator ? [content] : [];
  }
}
