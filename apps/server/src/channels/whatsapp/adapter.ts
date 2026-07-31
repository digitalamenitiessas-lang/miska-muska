/**
 * Adaptador de WhatsApp Cloud API (Meta Graph API).
 *
 * Es el destino final del proyecto, y ya está implementado: cuando lleguen las
 * credenciales de Meta se completan las 5 variables de entorno, se agrega
 * 'whatsapp' a `activeChannels` desde el panel, y el resto del sistema no cambia.
 *
 * Diferencias reales frente a Telegram que este archivo absorbe:
 *  - VENTANA DE 24 h: fuera de ella solo se pueden enviar plantillas aprobadas.
 *    No lo adivinamos: mandamos y traducimos el error 131047 a
 *    `outsideServiceWindow`, que el egress convierte en una alerta del panel.
 *  - Límites de interactividad: 3 botones de 20 caracteres, 10 filas de lista.
 *    Declarados en `capabilities`; el degradado genérico se ocupa del resto.
 *  - Firma HMAC del webhook (X-Hub-Signature-256) sobre el cuerpo CRUDO.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../config.js';
import { log } from '../../core/events/bus.js';
import type { ChannelAdapter, ChannelCapabilities, InboundSink, MediaPayload } from '../../core/types/channel.js';
import type {
  ConversationRef,
  InboundContent,
  InboundMessage,
  OutboundMessage,
  SendResult,
} from '../../core/types/message.js';
import { newId } from '../../core/store/db.js';

const CAPABILITIES: ChannelCapabilities = {
  maxTextLength: 4096,
  maxButtons: 3,
  maxButtonTitleLength: 20,
  maxListRows: 10,
  supportsImages: true,
  supportsDocuments: true,
  supportsTypingIndicator: true,
  supportsReadReceipts: true,
  hasServiceWindow: true,
  serviceWindowHours: 24,
};

/** Meta: "más de 24 h desde la última respuesta del cliente". */
const OUTSIDE_WINDOW_CODES = new Set([131047, 131026]);

interface WaContact {
  wa_id: string;
  profile?: { name?: string };
}

interface WaMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type?: string; caption?: string };
  document?: { id: string; filename?: string; mime_type?: string; caption?: string };
  audio?: { id: string; mime_type?: string; voice?: boolean };
  video?: { id: string; mime_type?: string; caption?: string };
  sticker?: { id: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: Array<{ name?: { formatted_name?: string }; phones?: Array<{ phone?: string }> }>;
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  button?: { payload?: string; text?: string };
  context?: { id?: string };
}

interface WaWebhook {
  object?: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      field: string;
      value: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: WaContact[];
        messages?: WaMessage[];
        statuses?: Array<{ id: string; status: string; errors?: Array<{ code: number; title: string }> }>;
      };
    }>;
  }>;
}

export class WhatsAppAdapter implements ChannelAdapter {
  readonly id = 'whatsapp' as const;
  readonly capabilities = CAPABILITIES;

  #sink: InboundSink | null = null;

  async start(sink: InboundSink): Promise<void> {
    this.#sink = sink;
    if (!config.whatsapp.accessToken || !config.whatsapp.phoneNumberId) {
      log('warn', 'WhatsApp sin credenciales: el canal queda inactivo (esperado hasta migrar).');
      return;
    }
    log('info', 'WhatsApp listo. Los mensajes entran por POST /webhooks/whatsapp.');
  }

  async stop(): Promise<void> {
    this.#sink = null;
  }

  /** Handshake GET que Meta hace al guardar la URL del webhook. */
  verifyWebhook(query: Record<string, string | undefined>): string | null {
    if (
      query['hub.mode'] === 'subscribe' &&
      query['hub.verify_token'] === config.whatsapp.verifyToken &&
      config.whatsapp.verifyToken
    ) {
      return query['hub.challenge'] ?? '';
    }
    return null;
  }

  /**
   * Valida la firma HMAC. `raw` tiene que ser el cuerpo tal como llegó: si se
   * re-serializa el JSON, la firma no coincide nunca.
   */
  verifySignature(raw: string, signatureHeader: string | undefined): boolean {
    const secret = config.whatsapp.appSecret;
    if (!secret) return true; // sin app secret configurado no se valida
    if (!signatureHeader?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
    const received = signatureHeader.slice('sha256='.length);
    if (expected.length !== received.length) return false;
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  }

  parseWebhook(body: unknown): InboundMessage[] {
    const payload = body as WaWebhook;
    if (payload?.object !== 'whatsapp_business_account') return [];

    const out: InboundMessage[] = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;

        // Reportes de entrega/lectura: no son mensajes, pero los errores importan.
        for (const status of value.statuses ?? []) {
          if (status.errors?.length) {
            log('warn', `WhatsApp reportó un error de entrega (${status.id})`, status.errors);
          }
        }

        const contactsByWaId = new Map(
          (value.contacts ?? []).map((c) => [c.wa_id, c] as const),
        );

        for (const msg of value.messages ?? []) {
          const content = this.#content(msg);
          if (!content) continue;
          const profile = contactsByWaId.get(msg.from);
          out.push({
            id: newId('in_'),
            channel: this.id,
            channelMessageId: msg.id,
            ref: {
              channel: this.id,
              externalId: msg.from,
              businessPhoneId: value.metadata?.phone_number_id,
            },
            contact: {
              externalId: msg.from,
              displayName: profile?.profile?.name ?? `+${msg.from}`,
              // En WhatsApp el wa_id ES el teléfono en E.164 sin '+'.
              phone: `+${msg.from}`,
            },
            timestamp: new Date(Number(msg.timestamp) * 1000).toISOString(),
            content,
            replyToChannelMessageId: msg.context?.id,
            raw: msg,
          });
        }
      }
    }
    return out;
  }

  #content(msg: WaMessage): InboundContent | null {
    switch (msg.type) {
      case 'text':
        return msg.text?.body ? { kind: 'text', text: msg.text.body } : null;
      case 'interactive': {
        const reply = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
        return reply ? { kind: 'interactive', replyId: reply.id, title: reply.title } : null;
      }
      case 'button':
        return msg.button?.text
          ? { kind: 'interactive', replyId: msg.button.payload ?? msg.button.text, title: msg.button.text }
          : null;
      case 'image':
        return msg.image
          ? { kind: 'image', mediaId: msg.image.id, mimeType: msg.image.mime_type, caption: msg.image.caption }
          : null;
      case 'document':
        return msg.document
          ? {
              kind: 'document',
              mediaId: msg.document.id,
              filename: msg.document.filename,
              mimeType: msg.document.mime_type,
              caption: msg.document.caption,
            }
          : null;
      case 'audio':
        return msg.audio
          ? { kind: 'audio', mediaId: msg.audio.id, mimeType: msg.audio.mime_type, voice: msg.audio.voice }
          : null;
      case 'video':
        return msg.video
          ? { kind: 'video', mediaId: msg.video.id, mimeType: msg.video.mime_type, caption: msg.video.caption }
          : null;
      case 'sticker':
        return msg.sticker ? { kind: 'sticker', mediaId: msg.sticker.id } : null;
      case 'location':
        return msg.location
          ? {
              kind: 'location',
              latitude: msg.location.latitude,
              longitude: msg.location.longitude,
              name: msg.location.name,
              address: msg.location.address,
            }
          : null;
      case 'contacts': {
        const first = msg.contacts?.[0];
        return {
          kind: 'contact',
          name: first?.name?.formatted_name ?? 'contacto',
          phones: (first?.phones ?? []).map((p) => p.phone ?? '').filter(Boolean),
        };
      }
      default:
        return { kind: 'unsupported', description: `mensaje de WhatsApp tipo ${msg.type}` };
    }
  }

  // --- salida -------------------------------------------------------------

  async send(message: OutboundMessage): Promise<SendResult> {
    const to = message.ref.externalId;
    const content = message.content;
    let body: Record<string, unknown>;

    switch (content.kind) {
      case 'text':
        body = {
          type: 'text',
          text: { body: content.text, preview_url: content.previewUrl ?? false },
        };
        break;

      case 'buttons':
        body = {
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: content.text.slice(0, 1024) },
            ...(content.footer ? { footer: { text: content.footer.slice(0, 60) } } : {}),
            action: {
              buttons: content.buttons.slice(0, 3).map((b) => ({
                type: 'reply',
                reply: { id: b.id, title: b.title.slice(0, 20) },
              })),
            },
          },
        };
        break;

      case 'list':
        body = {
          type: 'interactive',
          interactive: {
            type: 'list',
            body: { text: content.text.slice(0, 1024) },
            ...(content.footer ? { footer: { text: content.footer.slice(0, 60) } } : {}),
            action: {
              button: content.buttonLabel.slice(0, 20),
              sections: content.sections.map((s) => ({
                title: s.title.slice(0, 24),
                rows: s.rows.map((r) => ({
                  id: r.id,
                  title: r.title.slice(0, 24),
                  ...(r.description ? { description: r.description.slice(0, 72) } : {}),
                })),
              })),
            },
          },
        };
        break;

      case 'image':
        body = { type: 'image', image: { link: content.url, caption: content.caption } };
        break;

      case 'document':
        body = {
          type: 'document',
          document: { link: content.url, filename: content.filename, caption: content.caption },
        };
        break;

      case 'template':
        body = {
          type: 'template',
          template: {
            name: content.name,
            language: { code: content.language },
            components: content.variables.length
              ? [
                  {
                    type: 'body',
                    parameters: content.variables.map((text) => ({ type: 'text', text })),
                  },
                ]
              : [],
          },
        };
        break;

      case 'typing':
        return { ok: true };
    }

    return this.#post({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...body });
  }

  /**
   * Marca leído y muestra "escribiendo…" en el mismo request. En Cloud API el
   * indicador de tipeo viaja junto al acuse de lectura.
   */
  async markRead(channelMessageId: string): Promise<void> {
    await this.#post({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: channelMessageId,
      typing_indicator: { type: 'text' },
    });
  }

  async setTyping(_ref: ConversationRef): Promise<void> {
    // Cubierto por `markRead`; sin un message_id no hay a qué asociarlo.
  }

  async downloadMedia(mediaId: string): Promise<MediaPayload> {
    const meta = await this.#get<{ url: string; mime_type: string }>(mediaId);
    const res = await fetch(meta.url, {
      headers: { authorization: `Bearer ${config.whatsapp.accessToken}` },
    });
    if (!res.ok) throw new Error(`No pude descargar el archivo: ${res.status}`);
    return { data: Buffer.from(await res.arrayBuffer()), mimeType: meta.mime_type };
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    if (!config.whatsapp.accessToken || !config.whatsapp.phoneNumberId) {
      return { ok: false, detail: 'Faltan WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID' };
    }
    try {
      const info = await this.#get<{ display_phone_number?: string; verified_name?: string }>(
        config.whatsapp.phoneNumberId,
      );
      return { ok: true, detail: `${info.verified_name ?? ''} ${info.display_phone_number ?? ''}`.trim() };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  // --- transporte ---------------------------------------------------------

  #base(): string {
    return `https://graph.facebook.com/${config.whatsapp.graphVersion}`;
  }

  async #post(payload: Record<string, unknown>): Promise<SendResult> {
    try {
      const res = await fetch(`${this.#base()}/${config.whatsapp.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.whatsapp.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        messages?: Array<{ id: string }>;
        error?: { message: string; code: number };
      };
      if (!res.ok || json.error) {
        const code = json.error?.code ?? 0;
        return {
          ok: false,
          error: `WhatsApp ${code}: ${json.error?.message ?? res.status}`,
          outsideServiceWindow: OUTSIDE_WINDOW_CODES.has(code),
        };
      }
      return { ok: true, channelMessageId: json.messages?.[0]?.id };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async #get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.#base()}/${path}`, {
      headers: { authorization: `Bearer ${config.whatsapp.accessToken}` },
    });
    const json = (await res.json()) as T & { error?: { message: string } };
    if (!res.ok || json.error) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
    return json;
  }
}
