/**
 * Adaptador de Telegram. Implementa `ChannelAdapter` y nada más: si mañana
 * cambia la Bot API, se toca solo este archivo.
 *
 * Soporta los dos modos:
 *  - `polling` (getUpdates en bucle): ideal en desarrollo, no necesita URL pública.
 *  - `webhook`: para producción; el endpoint HTTP delega en `parseWebhook`.
 *
 * No se usa `parse_mode`: los mensajes de la marca vienen con emojis, asteriscos
 * y guiones bajos sueltos, y escapar MarkdownV2 solo agrega formas de fallar.
 */

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
  maxButtons: 8,
  maxButtonTitleLength: 64,
  // Telegram no tiene un "list message" nativo; el degradado lo convierte en
  // teclado inline o en texto numerado.
  maxListRows: 0,
  supportsImages: true,
  supportsDocuments: true,
  supportsTypingIndicator: true,
  supportsReadReceipts: false,
  hasServiceWindow: false,
};

interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number };
  date: number;
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; width: number; height: number }>;
  document?: { file_id: string; file_name?: string; mime_type?: string };
  voice?: { file_id: string; duration: number; mime_type?: string };
  audio?: { file_id: string; duration: number; mime_type?: string };
  video?: { file_id: string; mime_type?: string };
  sticker?: { file_id: string; emoji?: string };
  location?: { latitude: number; longitude: number };
  contact?: { phone_number: string; first_name: string };
  reply_to_message?: { message_id: number };
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: {
    id: string;
    from: TgUser;
    data?: string;
    message?: TgMessage;
  };
}

export class TelegramAdapter implements ChannelAdapter {
  readonly id = 'telegram' as const;
  readonly capabilities = CAPABILITIES;

  #token: string;
  #sink: InboundSink | null = null;
  #offset = 0;
  #polling = false;
  #abort: AbortController | null = null;

  constructor(token = config.telegram.botToken) {
    this.#token = token;
  }

  // --- ciclo de vida ------------------------------------------------------

  async start(sink: InboundSink): Promise<void> {
    this.#sink = sink;
    if (!this.#token) {
      log('warn', 'Telegram sin TELEGRAM_BOT_TOKEN: el canal queda inactivo.');
      return;
    }

    if (config.telegram.mode === 'webhook') {
      if (!config.publicUrl) {
        log('error', 'TELEGRAM_MODE=webhook requiere PUBLIC_URL.');
        return;
      }
      const url = `${config.publicUrl.replace(/\/$/, '')}/webhooks/telegram`;
      await this.#call('setWebhook', {
        url,
        secret_token: config.telegram.webhookSecret || undefined,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: false,
      });
      log('info', `Telegram en modo webhook: ${url}`);
      return;
    }

    // Modo polling: hay que soltar cualquier webhook previo o getUpdates falla.
    await this.#call('deleteWebhook', { drop_pending_updates: false }).catch(() => undefined);
    this.#polling = true;
    void this.#pollLoop();
    log('info', 'Telegram en modo polling.');
  }

  async stop(): Promise<void> {
    this.#polling = false;
    this.#abort?.abort();
  }

  async #pollLoop(): Promise<void> {
    while (this.#polling) {
      this.#abort = new AbortController();
      try {
        const updates = await this.#call<TgUpdate[]>(
          'getUpdates',
          { offset: this.#offset, timeout: 25, allowed_updates: ['message', 'callback_query'] },
          this.#abort.signal,
        );
        for (const update of updates ?? []) {
          this.#offset = Math.max(this.#offset, update.update_id + 1);
          for (const message of this.#normalize(update)) {
            await this.#sink?.(message);
          }
        }
      } catch (err) {
        if (!this.#polling) break;
        const message = (err as Error).message;
        if ((err as Error).name === 'AbortError') continue;
        log('error', 'Error en el polling de Telegram; reintento en 5 s', message);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  // --- entrada ------------------------------------------------------------

  parseWebhook(body: unknown, headers: Record<string, string | undefined>): InboundMessage[] {
    const expected = config.telegram.webhookSecret;
    if (expected && headers['x-telegram-bot-api-secret-token'] !== expected) {
      log('warn', 'Webhook de Telegram con secret_token inválido: descartado.');
      return [];
    }
    return this.#normalize(body as TgUpdate);
  }

  #normalize(update: TgUpdate): InboundMessage[] {
    if (update.callback_query) {
      const cq = update.callback_query;
      // Se responde el callback para que Telegram apague el reloj del botón.
      void this.#call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => undefined);
      const chatId = cq.message?.chat.id ?? cq.from.id;
      return [
        {
          id: newId('in_'),
          channel: this.id,
          channelMessageId: `cb:${cq.id}`,
          ref: { channel: this.id, externalId: String(chatId) },
          contact: this.#contact(cq.from),
          timestamp: new Date().toISOString(),
          content: { kind: 'interactive', replyId: cq.data ?? '', title: cq.data ?? '' },
          raw: update,
        },
      ];
    }

    const msg = update.message ?? update.edited_message;
    if (!msg?.from) return [];

    const content = this.#content(msg);
    if (!content) return [];

    return [
      {
        id: newId('in_'),
        channel: this.id,
        channelMessageId: String(msg.message_id),
        ref: { channel: this.id, externalId: String(msg.chat.id) },
        contact: this.#contact(msg.from),
        timestamp: new Date(msg.date * 1000).toISOString(),
        content,
        replyToChannelMessageId: msg.reply_to_message
          ? String(msg.reply_to_message.message_id)
          : undefined,
        raw: update,
      },
    ];
  }

  #contact(user: TgUser) {
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    return {
      externalId: String(user.id),
      displayName: name || user.username || `Telegram ${user.id}`,
      username: user.username,
    };
  }

  #content(msg: TgMessage): InboundContent | null {
    if (msg.text) return { kind: 'text', text: msg.text };
    if (msg.photo?.length) {
      // El último elemento es la resolución más alta.
      const best = msg.photo[msg.photo.length - 1];
      return { kind: 'image', mediaId: best.file_id, caption: msg.caption };
    }
    if (msg.document) {
      return {
        kind: 'document',
        mediaId: msg.document.file_id,
        filename: msg.document.file_name,
        mimeType: msg.document.mime_type,
        caption: msg.caption,
      };
    }
    if (msg.voice) {
      return {
        kind: 'audio',
        mediaId: msg.voice.file_id,
        mimeType: msg.voice.mime_type,
        durationSec: msg.voice.duration,
        voice: true,
      };
    }
    if (msg.audio) {
      return {
        kind: 'audio',
        mediaId: msg.audio.file_id,
        mimeType: msg.audio.mime_type,
        durationSec: msg.audio.duration,
      };
    }
    if (msg.video) {
      return { kind: 'video', mediaId: msg.video.file_id, mimeType: msg.video.mime_type, caption: msg.caption };
    }
    if (msg.sticker) return { kind: 'sticker', mediaId: msg.sticker.file_id, emoji: msg.sticker.emoji };
    if (msg.location) {
      return { kind: 'location', latitude: msg.location.latitude, longitude: msg.location.longitude };
    }
    if (msg.contact) {
      return { kind: 'contact', name: msg.contact.first_name, phones: [msg.contact.phone_number] };
    }
    if (msg.caption) return { kind: 'text', text: msg.caption };
    return { kind: 'unsupported', description: 'mensaje de Telegram no soportado' };
  }

  // --- salida -------------------------------------------------------------

  async send(message: OutboundMessage): Promise<SendResult> {
    const chatId = message.ref.externalId;
    const content = message.content;

    try {
      switch (content.kind) {
        case 'text': {
          const res = await this.#call<TgMessage>('sendMessage', {
            chat_id: chatId,
            text: content.text,
            link_preview_options: content.previewUrl ? undefined : { is_disabled: true },
          });
          return { ok: true, channelMessageId: String(res.message_id) };
        }

        case 'buttons': {
          const res = await this.#call<TgMessage>('sendMessage', {
            chat_id: chatId,
            text: [content.text, content.footer].filter(Boolean).join('\n\n'),
            link_preview_options: { is_disabled: true },
            reply_markup: {
              inline_keyboard: content.buttons.map((b) => [{ text: b.title, callback_data: b.id }]),
            },
          });
          return { ok: true, channelMessageId: String(res.message_id) };
        }

        case 'image': {
          const res = await this.#call<TgMessage>('sendPhoto', {
            chat_id: chatId,
            photo: content.url,
            caption: content.caption,
          });
          return { ok: true, channelMessageId: String(res.message_id) };
        }

        case 'document': {
          const res = await this.#call<TgMessage>('sendDocument', {
            chat_id: chatId,
            document: content.url,
            caption: content.caption,
          });
          return { ok: true, channelMessageId: String(res.message_id) };
        }

        case 'template': {
          // Telegram no tiene plantillas: se envía el texto ya armado.
          const res = await this.#call<TgMessage>('sendMessage', {
            chat_id: chatId,
            text: content.variables.join(' '),
          });
          return { ok: true, channelMessageId: String(res.message_id) };
        }

        case 'list':
        case 'typing':
          // El degradado de `core/types/channel.ts` ya los transformó.
          return { ok: true };
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async setTyping(ref: ConversationRef): Promise<void> {
    await this.#call('sendChatAction', { chat_id: ref.externalId, action: 'typing' });
  }

  async downloadMedia(mediaId: string, maxBytes?: number): Promise<MediaPayload> {
    const file = await this.#call<{ file_path: string; file_size?: number }>('getFile', {
      file_id: mediaId,
    });
    // Telegram dice el tamaño acá, antes de mandar un byte: es el lugar barato
    // para frenar. Igual se vuelve a chequear con el content-length, porque
    // file_size es opcional en la respuesta.
    if (maxBytes && file.file_size && file.file_size > maxBytes) {
      throw new Error(`El archivo pesa ${file.file_size} bytes y el tope es ${maxBytes}.`);
    }
    const url = `https://api.telegram.org/file/bot${this.#token}/${file.file_path}`;
    // Con techo de tiempo: una descarga colgada deja el archivo en memoria y un
    // lugar de la cola de descargas tomado hasta que alguien reinicie el bot.
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`No pude descargar el archivo: ${res.status}`);
    const declarado = Number(res.headers.get('content-length'));
    if (maxBytes && Number.isFinite(declarado) && declarado > maxBytes) {
      throw new Error(`El archivo pesa ${declarado} bytes y el tope es ${maxBytes}.`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      data: buffer,
      mimeType: res.headers.get('content-type') ?? 'application/octet-stream',
      filename: file.file_path.split('/').pop(),
    };
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    if (!this.#token) return { ok: false, detail: 'Falta TELEGRAM_BOT_TOKEN' };
    try {
      const me = await this.#call<{ username: string }>('getMe', {});
      return { ok: true, detail: `@${me.username} (${config.telegram.mode})` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  // --- transporte ---------------------------------------------------------

  /*
    `signal` sigue siendo opcional porque el long polling manda el suyo, que
    dura lo que dura la espera larga. Lo que cambia es el respaldo: sin nada,
    el default de undici son 300 segundos, y `health()` llama sin señal desde
    una ruta del panel. Un Telegram colgado dejaba la carga del panel esperando
    cinco minutos.
  */
  async #call<T>(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.#token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: signal ?? AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
    return json.result as T;
  }
}
