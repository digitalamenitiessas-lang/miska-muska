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

/*
  UN RELLENO NO ES UN NOMBRE.

  El local: "el bot pasando un rato borra los nombres que primero si figuraban".
  No los borraba: les escribia encima la cadena que esta abajo, y el panel
  muestra el nombre cargado antes que el del perfil de WhatsApp, asi que el
  bueno quedaba tapado.

  De donde salia: el rescate del comprobante le pide al modelo que arme el
  pedido leyendo la charla, y cuando el nombre no esta en ningun lado el modelo
  devuelve un marcador en vez de omitir el campo. `validateOrder` lo dejaba
  pasar porque recibe aparte el nombre del perfil como candidato valido, y de
  ahi seguia derecho hasta la ficha del contacto.

  Medido: 28 pedidos y 26 contactos marcados asi, todos desde el 13/09, que es
  el dia que el rescate entro en produccion.

  La lista NO intenta adivinar si un nombre es real: "Lei", los que son un solo
  emoji y "jo pino" son nombres de clientas de verdad. Solo caza los rellenos
  que escribe una maquina cuando no sabe.
*/
const RELLENOS = new Set([
  'unknown',
  'desconocido',
  'sin nombre',
  'sin datos',
  'no especificado',
  'no disponible',
  'cliente',
  'n/a',
  'na',
  'null',
  'none',
  'undefined',
  '-',
  '--',
  '?',
]);

/** `<UNKNOWN>`, `<sin nombre>`, `[desconocido]`: cualquier cosa entre marcas. */
const ENTRE_MARCAS = /^[<[{(].*[>\]})]$/;

/**
 * El nombre si sirve para guardar, o `null` si es un relleno del modelo.
 *
 * Devuelve `null` para que quien llama use lo que ya tenía en vez de pisarlo.
 * Un nombre real vuelve tal cual, sin recortes.
 */
export function nombreUsable(nombre: string | null | undefined): string | null {
  const limpio = (nombre ?? '').trim();
  if (!limpio) return null;
  if (ENTRE_MARCAS.test(limpio)) return null;
  if (RELLENOS.has(limpio.toLowerCase())) return null;
  return limpio;
}
