/**
 * Alguien está esperando en la puerta.
 *
 * Todos los mensajes de abajo son REALES, sacados de la base. Los de la primera
 * lista tienen que encender la alerta; los de la segunda son los que se le
 * parecen y no lo son, y salieron uno por uno de los falsos positivos que dio la
 * medición sobre 4.098 mensajes.
 *
 *   npx tsx scripts/probar-llegadas.mts
 */

import { avisaQueLlego } from '../src/core/policies/llegadas.js';

/** Hay un chofer esperando: hay que salir. */
const LLEGARON: string[] = [
  'Esta afuera',
  'ya esta el uber afuera',
  'Holaaa esta el cadete afuera',
  'El uber está afura',
  'Ahí está el conductor',
  'Está afuera se llama Carlos',
  'Me dijo que está afuera',
  'La moto está afuera',
  'está a 1 min',
  'Esta a 2 cuadras creo',
  'dice que ya está ahí',
  'Ahí llegó el Uber',
  'Ya está el Uber',
  'Por favor está esperando el Uber',
  'y esta ahi en el local el uber con mis datos queriendo retirar el pedido',
  'Okey dice que esta afuera del local, creo que no se quiere bajar',
];

/** Se le parecen y NO lo son. */
const NO_LLEGARON: string[] = [
  // La clienta recibió el pedido: es el otro extremo.
  'Si ya me llegó',
  'Muchas gracias ya me llego',
  'Bueno ya m llegó x ahí',
  'llego muchas gracias😊🫶🏽',
  'Me llegó por el local.',
  // Las mismas palabras para otra cosa.
  'ahí está el comprobante jiji',
  'ahi esta el comprobante',
  // Preguntas, no avisos.
  'Ya llego?',
  'Llego?',
  'Está ahí ya el cadete?',
  // Reclamos y otras cosas.
  'se suponía q lo iban a traer a las 17 hs pero no llegó',
  'Si puedo me llego sino me la tendrán q enviar. Vi q hacen envíos a Alderetes 😉',
  // Charla normal.
  'Hola buenas tardes para hacerte un pedido',
  '2 cookies de oreo con nutella',
  'Ya te lo mande',
];

let fallas = 0;

for (const t of LLEGARON) {
  const ok = avisaQueLlego(t);
  console.log(`${ok ? 'ok   ' : 'FALLA'} avisa      ${JSON.stringify(t.slice(0, 62))}`);
  if (!ok) fallas++;
}

console.log();

for (const t of NO_LLEGARON) {
  const ok = !avisaQueLlego(t);
  console.log(`${ok ? 'ok   ' : 'FALLA'} no avisa   ${JSON.stringify(t.slice(0, 62))}`);
  if (!ok) fallas++;
}

const total = LLEGARON.length + NO_LLEGARON.length;
console.log(fallas ? `\n${fallas} falla(s) de ${total}` : `\nTodo bien: ${total} mensajes reales.`);
process.exit(fallas ? 1 : 0);
