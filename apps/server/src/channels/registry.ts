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

export interface ChannelHealth {
  channel: ChannelId;
  configured: boolean;
  ok: boolean;
  detail?: string;
}

/**
 * Cuánto vale la última respuesta de salud antes de volver a preguntar.
 *
 * Treinta segundos: lo suficiente para que una ráfaga de arranques del panel
 * cueste una sola llamada, y lo bastante poco para que quien acaba de pegar un
 * token en Ajustes vea si anduvo sin esperar sentado.
 */
const SALUD_VIGENTE_MS = 30_000;

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

  /*
    La última respuesta de `healthAll`, y la consulta que está en vuelo.

    Preguntarle a Meta y a Telegram si están vivos cuesta dos llamadas por
    Internet, y esto lo llaman dos rutas que se piden mucho más seguido de lo
    que nadie imagina: `/api/settings` —que el panel pide en cada arranque, y
    "arranque" incluye cada vez que aparece una conversación cuyo contacto
    todavía no tiene— y `/health`, que le pega cualquier monitor de uptime.

    En un día como el Día de la Madre eso son cientos de clientas nuevas, o sea
    más de mil llamadas a Graph salidas del mismo proceso que está contestando,
    y contra EL MISMO TOKEN con el que mandamos los mensajes. Si Meta decide
    frenarnos por preguntarle mil veces si está vivo, nos frena el envío. El
    dato que devuelven, además, es el mismo durante horas.

    `#enVuelo` no es un lujo: sin él, la ráfaga de arranques que llegan juntos
    entra toda antes de que la primera termine de guardar, y la caché no ahorra
    nada justo en el momento en que hace falta.
  */
  #salud: { al: number; datos: ChannelHealth[] } | null = null;
  #enVuelo: Promise<ChannelHealth[]> | null = null;

  async healthAll(): Promise<ChannelHealth[]> {
    if (this.#salud && Date.now() - this.#salud.al < SALUD_VIGENTE_MS) return this.#salud.datos;
    if (this.#enVuelo) return this.#enVuelo;

    this.#enVuelo = Promise.all(
      this.all().map(async (adapter) => {
        const configured = channelConfigured(adapter.id);
        if (!configured) return { channel: adapter.id, configured, ok: false, detail: 'Sin credenciales' };
        /*
          Un canal caído no puede tumbar la ruta que lo pregunta. Antes esto
          propagaba: `adapter.health()` tira si Graph contesta un error, y con
          eso `/api/settings` devolvía 500 y el panel entero se quedaba sin
          cargar por un canal apagado.
        */
        try {
          const health = await adapter.health();
          return { channel: adapter.id, configured, ok: health.ok, detail: health.detail };
        } catch (err) {
          return { channel: adapter.id, configured, ok: false, detail: String(err) };
        }
      }),
    )
      .then((datos) => {
        this.#salud = { al: Date.now(), datos };
        return datos;
      })
      .finally(() => {
        this.#enVuelo = null;
      });

    return this.#enVuelo;
  }

  /** Para cuando el panel guarda credenciales nuevas y quiere ver el resultado ya. */
  olvidarSalud(): void {
    this.#salud = null;
  }
}
