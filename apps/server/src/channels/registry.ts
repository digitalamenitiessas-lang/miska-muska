/**
 * Registro de canales. Es el único lugar que conoce las implementaciones
 * concretas; el pipeline solo recibe un `AdapterResolver`.
 *
 * Migrar a WhatsApp = configurar sus variables de entorno y activarlo desde el
 * panel. No hay código nuevo que escribir.
 */

import { channelConfigured } from '../config.js';
import { log } from '../core/events/bus.js';
import type { ChannelAdapter, InboundSink } from '../core/types/channel.js';
import type { ChannelId } from '../core/types/message.js';
import { TelegramAdapter } from './telegram/adapter.js';
import { WhatsAppAdapter } from './whatsapp/adapter.js';

export class ChannelRegistry {
  #adapters = new Map<ChannelId, ChannelAdapter>();

  constructor() {
    this.#adapters.set('telegram', new TelegramAdapter());
    this.#adapters.set('whatsapp', new WhatsAppAdapter());
  }

  get(channel: ChannelId): ChannelAdapter | undefined {
    return this.#adapters.get(channel);
  }

  all(): ChannelAdapter[] {
    return [...this.#adapters.values()];
  }

  /** Arranca solo los canales que tienen credenciales. */
  async startAll(sink: InboundSink): Promise<void> {
    for (const adapter of this.all()) {
      if (!channelConfigured(adapter.id)) {
        log('info', `Canal ${adapter.id} sin credenciales: no se arranca.`);
        continue;
      }
      try {
        await adapter.start(sink);
      } catch (err) {
        log('error', `No pude arrancar el canal ${adapter.id}`, err);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const adapter of this.all()) {
      await adapter.stop().catch(() => undefined);
    }
  }

  async healthAll(): Promise<Array<{ channel: ChannelId; configured: boolean; ok: boolean; detail?: string }>> {
    return Promise.all(
      this.all().map(async (adapter) => {
        const configured = channelConfigured(adapter.id);
        if (!configured) return { channel: adapter.id, configured, ok: false, detail: 'Sin credenciales' };
        const health = await adapter.health();
        return { channel: adapter.id, configured, ok: health.ok, detail: health.detail };
      }),
    );
  }
}
