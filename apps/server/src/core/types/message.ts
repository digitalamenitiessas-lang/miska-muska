/**
 * Modelo canónico de mensajes.
 *
 * Esta es la frontera del sistema: TODO lo que entra por un canal (Telegram,
 * WhatsApp Cloud API, o el que venga) se normaliza a `InboundMessage`, y todo lo
 * que sale se expresa como `OutboundMessage`. El pipeline de procesamiento
 * (`core/pipeline`) y el cerebro (`core/agent`) no conocen ningún canal.
 *
 * Regla de diseño: el formato de salida es la UNIÓN de capacidades de los
 * canales, no la intersección. Cada adaptador declara sus `ChannelCapabilities`
 * y su renderer degrada lo que no soporta (ej. una lista de 10 filas de
 * WhatsApp se convierte en teclado inline en Telegram, y en texto numerado si
 * el canal no soporta interactividad). Así el pipeline puede expresar la
 * intención rica sin ramificar por canal.
 */

export type ChannelId = 'telegram' | 'whatsapp';

/** Identifica un chat dentro de un canal concreto. */
export interface ConversationRef {
  channel: ChannelId;
  /** chat_id de Telegram o wa_id (teléfono E.164 sin '+') de WhatsApp. */
  externalId: string;
  /** Número de teléfono del negocio que recibió el mensaje (WhatsApp multi-número). */
  businessPhoneId?: string;
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export type InboundContent =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mediaId: string; mimeType?: string; caption?: string }
  | { kind: 'document'; mediaId: string; filename?: string; mimeType?: string; caption?: string }
  | { kind: 'audio'; mediaId: string; mimeType?: string; durationSec?: number; voice?: boolean }
  | { kind: 'video'; mediaId: string; mimeType?: string; caption?: string }
  | { kind: 'sticker'; mediaId: string; emoji?: string }
  | { kind: 'location'; latitude: number; longitude: number; name?: string; address?: string }
  /** Respuesta a un botón o fila de lista que enviamos antes. */
  | { kind: 'interactive'; replyId: string; title: string }
  | { kind: 'contact'; name: string; phones: string[] }
  | { kind: 'unsupported'; description: string };

export interface InboundContact {
  /** Id estable dentro del canal. */
  externalId: string;
  displayName?: string;
  username?: string;
  /** E.164 cuando el canal lo expone (WhatsApp siempre; Telegram casi nunca). */
  phone?: string;
}

export interface InboundMessage {
  /** Id interno (ULID-ish) asignado por el ingress. */
  id: string;
  channel: ChannelId;
  /** Id del mensaje en el proveedor. Se usa para deduplicar reintentos de webhook. */
  channelMessageId: string;
  ref: ConversationRef;
  contact: InboundContact;
  /** ISO 8601. */
  timestamp: string;
  content: InboundContent;
  /** Id (del proveedor) del mensaje al que responde, si es una cita. */
  replyToChannelMessageId?: string;
  /** Payload original del proveedor. Se guarda para depurar desde el panel. */
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

export interface QuickReplyButton {
  /** Se recibe de vuelta como `InboundContent.interactive.replyId`. */
  id: string;
  /** WhatsApp trunca a 20 caracteres. */
  title: string;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

export type OutboundContent =
  | { kind: 'text'; text: string; previewUrl?: boolean }
  | { kind: 'image'; url: string; caption?: string }
  | { kind: 'document'; url: string; filename?: string; caption?: string }
  | { kind: 'buttons'; text: string; buttons: QuickReplyButton[]; footer?: string }
  | { kind: 'list'; text: string; buttonLabel: string; sections: ListSection[]; footer?: string }
  /**
   * Plantilla aprobada de WhatsApp. Único formato permitido fuera de la ventana
   * de 24 h de atención al cliente. En Telegram se renderiza como texto plano
   * con las variables interpoladas.
   */
  | { kind: 'template'; name: string; language: string; variables: string[] }
  /** Indicador de "escribiendo…". Efímero, no se persiste como mensaje. */
  | { kind: 'typing'; durationMs: number };

export type MessageAuthor = 'bot' | 'human' | 'system';

export interface OutboundMessage {
  conversationId: string;
  ref: ConversationRef;
  content: OutboundContent;
  meta?: {
    author: MessageAuthor;
    /** Intención detectada por el router, para analítica en el panel. */
    intent?: string;
    /** Qué handler produjo el mensaje: 'quick-reply' | 'agent' | 'operator' | ... */
    handler?: string;
    /** Clave del mensaje rápido reutilizado, si aplica. */
    quickReplyKey?: string;
  };
}

export interface SendResult {
  ok: boolean;
  channelMessageId?: string;
  error?: string;
  /** true si el canal rechazó el envío por estar fuera de la ventana de 24 h. */
  outsideServiceWindow?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function refKey(ref: ConversationRef): string {
  return `${ref.channel}:${ref.externalId}`;
}

/** Texto plano de un contenido de entrada, para logs y para el prompt. */
export function describeInbound(content: InboundContent): string {
  switch (content.kind) {
    case 'text':
      return content.text;
    case 'interactive':
      return content.title;
    case 'image':
      return content.caption ? `[imagen] ${content.caption}` : '[imagen]';
    case 'document':
      return `[archivo${content.filename ? ` ${content.filename}` : ''}]${content.caption ? ` ${content.caption}` : ''}`;
    case 'audio':
      return content.voice ? '[mensaje de voz]' : '[audio]';
    case 'video':
      return content.caption ? `[video] ${content.caption}` : '[video]';
    case 'sticker':
      return `[sticker${content.emoji ? ` ${content.emoji}` : ''}]`;
    case 'location':
      return `[ubicación ${content.latitude},${content.longitude}]`;
    case 'contact':
      return `[contacto ${content.name}]`;
    case 'unsupported':
      return `[${content.description}]`;
  }
}

/** Texto plano de un contenido de salida, para persistir y mostrar en el panel. */
export function describeOutbound(content: OutboundContent): string {
  switch (content.kind) {
    case 'text':
      return content.text;
    case 'image':
      return content.caption ? `[imagen] ${content.caption}` : '[imagen]';
    case 'document':
      return `[archivo${content.filename ? ` ${content.filename}` : ''}]`;
    case 'buttons':
      return `${content.text}\n${content.buttons.map((b) => `• ${b.title}`).join('\n')}`;
    case 'list':
      return `${content.text}\n${content.sections
        .flatMap((s) => s.rows.map((r) => `• ${r.title}`))
        .join('\n')}`;
    case 'template':
      return `[plantilla ${content.name}] ${content.variables.join(' | ')}`;
    case 'typing':
      return '[escribiendo…]';
  }
}
