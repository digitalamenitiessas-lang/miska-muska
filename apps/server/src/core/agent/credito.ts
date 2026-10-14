/**
 * Cuánto crédito le queda a la cuenta de OpenRouter que está pagando el bot.
 *
 * POR QUÉ ESTO ESTÁ EN EL PANEL Y NO EN UN MAIL QUE NADIE LEE: desde el 14 de
 * octubre de 2026 la API key la administra el local, no nosotros. El día que
 * el crédito llegue a cero el bot deja de contestar, y el aviso le tiene que
 * llegar a quien puede cargarle plata. Si vive en la cuenta de OpenRouter, la
 * primera señal es que el bot se calló un sábado a la mañana.
 *
 * El número sale de la cuenta, no de la key: una key sin límite propio gasta
 * del saldo de la cuenta, y ese saldo es lo único que importa para saber
 * cuántos días quedan.
 */

import { config } from '../../config.js';
import { log } from '../events/bus.js';

export interface CreditoDeOpenRouter {
  /** Lo cargado en la cuenta, en dólares. */
  cargado: number;
  /** Lo gastado contra ese crédito, en dólares. */
  usado: number;
  /** Lo que queda. Es `cargado - usado`, y es el número que mira el local. */
  restante: number;
}

/*
  Quince minutos, igual que el costo de WhatsApp y por el mismo motivo: el
  panel pide esto en CADA pantalla para la barra de arriba, y el saldo se
  mueve de a centésimas de centavo. Sin caché serían miles de consultas por
  día a un número que cambia una vez por semana, cuando alguien carga.
*/
const CACHE_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 8_000;
let cache: { en: number; dato: CreditoDeOpenRouter } | null = null;

/**
 * Devuelve el saldo, o `null` si no se puede saber.
 *
 * NULL NO ES CERO, y la diferencia importa: sin key configurada, con OpenRouter
 * caído o con la consulta demorada, no sabemos cuánto hay. El panel no dibuja
 * nada en ese caso. Pintar "quedan $0" porque la consulta falló es peor que no
 * mostrar nada: manda a alguien a cargar plata que ya está cargada, o peor,
 * lo acostumbra a ignorar el cartel.
 */
export async function creditoDeOpenRouter(ahora = new Date()): Promise<CreditoDeOpenRouter | null> {
  if (!config.openrouter.apiKey) return null;
  if (cache && ahora.getTime() - cache.en < CACHE_MS) return cache.dato;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${config.openrouter.baseUrl}/credits`, {
      headers: { authorization: `Bearer ${config.openrouter.apiKey}` },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      log('warn', `No pude leer el crédito de OpenRouter (HTTP ${res.status})`, text.slice(0, 200));
      return cache?.dato ?? null;
    }

    const json = JSON.parse(text) as { data?: { total_credits?: number; total_usage?: number } };
    const cargado = Number(json.data?.total_credits);
    const usado = Number(json.data?.total_usage);
    /*
      Si OpenRouter cambia el nombre de los campos, `Number(undefined)` es NaN
      y el panel dibujaría "quedan $NaN". Se prefiere no dibujar nada.
    */
    if (!Number.isFinite(cargado) || !Number.isFinite(usado)) {
      log('warn', 'El crédito de OpenRouter vino con otra forma', text.slice(0, 200));
      return cache?.dato ?? null;
    }

    const dato: CreditoDeOpenRouter = { cargado, usado, restante: cargado - usado };
    cache = { en: ahora.getTime(), dato };
    return dato;
  } catch (err) {
    /*
      Se devuelve lo último que supimos antes que nada. Un saldo de hace veinte
      minutos sigue siendo una respuesta útil; que el cartel parpadee y
      desaparezca cada vez que la red tose, no.
    */
    log('warn', 'No pude leer el crédito de OpenRouter', err instanceof Error ? err.message : err);
    return cache?.dato ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/** Para los scripts y las pruebas: obliga a volver a preguntar. */
export function olvidarElCredito(): void {
  cache = null;
}
