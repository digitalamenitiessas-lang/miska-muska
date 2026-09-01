/**
 * DETECTAR QUE EL BOT ESTÁ PIDIENDO EL NOMBRE DE CERO.
 *
 * El local lo marcó así: "está muy insistente, hasta hay veces que pregunta
 * varias veces el nombre cuando el cliente ya lo dio".
 *
 * Esto no reescribe nada ni frena ningún mensaje. Solo anota, igual que el
 * termómetro de precios y el de "quedó reservado", y por el mismo motivo: la
 * pregunta por el nombre casi siempre viaja pegada al resto de los datos que sí
 * hay que pedir ("pasame tu nombre y apellido, el teléfono y la hora de
 * retiro"), así que borrarla se llevaría puesto lo que corresponde preguntar.
 *
 * Lo que se arregla de verdad está en otro lado: el nombre del perfil de
 * WhatsApp ahora viaja en el contexto, y `crear_pedido` le devuelve el candidato
 * en la mano cuando el dato falta. Esto mide si eso alcanzó.
 *
 * Por eso la distinción que hace este módulo es la que hace o rompe la medición:
 * PEDIR el nombre de cero es lo que queremos que baje; CONFIRMAR uno que ya
 * tenemos —"te lo anoto a nombre de Ariana Robles?"— es exactamente lo que
 * queremos que haga en su lugar. Si las dos contaran igual, el número no podría
 * bajar nunca y el termómetro no serviría para nada.
 */

import type { StoredMessage } from '../types/domain.js';

function sinTildes(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/** Las formas en que el bot pide el nombre, sacadas de charlas reales. */
const PIDE: RegExp[] = [
  /\ba nombre de quien(es)?\b/,
  /\bcomo te llamas\b/,
  /\bcual es tu nombre\b/,
  /\b(pasame|decime|mandame|necesito|dejame|me pasas|me decis|me das)\b[^.?!]{0,30}\bnombre\b/,
  /\bnombre y apellido\b/,
  /\bnombre completo\b/,
  /\btu nombre\b/,
];

/**
 * Lo que NO cuenta, porque es la conducta que queremos.
 *
 * "a nombre de" seguido de algo que no es "quién" quiere decir que el nombre ya
 * está sobre la mesa y el bot lo está confirmando, no pidiendo.
 */
const CONFIRMA: RegExp[] = [
  /\ba nombre de (?!quien)\p{L}/u,
  /\bconfirm\p{L}*\b[^.?!]{0,30}\bnombre\b/u,
  // "sos Ariana Robles?". Sin "es": se comía "cuál es tu nombre?".
  /\b(sos|eres) \p{L}+ \p{L}+\?/u,
];

/**
 * ¿Este texto le está pidiendo el nombre al cliente, de cero?
 *
 * Confirmar un nombre que ya tenemos no cuenta: ver el comentario de arriba.
 */
export function pideElNombre(texto: string): boolean {
  const plano = sinTildes(texto);
  if (CONFIRMA.some((re) => re.test(plano))) return false;
  return PIDE.some((re) => re.test(plano));
}

/**
 * ¿Ya se lo habíamos pedido antes en esta misma charla?
 *
 * Se miran solo los mensajes salientes del bot. Que una persona del local lo
 * haya pedido no cuenta: si lo pidió a mano, sabía por qué.
 */
export function yaSePidioElNombre(mensajes: StoredMessage[]): boolean {
  return mensajes.some(
    (m) =>
      m.direction === 'out' &&
      m.author === 'bot' &&
      m.contentKind === 'text' &&
      pideElNombre(m.text),
  );
}
