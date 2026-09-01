/**
 * El saludo enlatado es para quien SOLO dijo hola.
 *
 * Los casos de abajo salen de la base: los de la izquierda son mensajes reales
 * a los que el bot contestó con el saludo enlatado, y en la mitad de ellos la
 * persona había preguntado algo. Una esperó una hora y volvió a escribir "??".
 *
 *   npx tsx scripts/probar-guarda-saludo.mts
 */

import { esSoloUnSaludo } from '../src/core/policies/writing.js';

/** Solo saludan: el mensaje rápido está bien acá. */
const SOLO_HOLA: string[] = [
  'Hola',
  'hola',
  'Holaa',
  'Buenas tardes',
  'Hola buenas tardes',
  'Hola buenas',
  'Hola que tal',
  'Holis como estás?',
  'holiss, como estás?',
  'hola, cómo estás?',
  'Buenas!!',
  'Hola! 😊',
  'Holaa 💕',
  'buen día',
  'Hola, buenas noches!',
];

/** Preguntaron algo: el saludo enlatado ahí les tapa la pregunta. */
const PREGUNTARON: string[] = [
  'Tienen disponible tarta de frutilla',
  'Le quedan fechas para muffins',
  'que precio tienen las cookies ?',
  'Que precio de el box de brownies',
  'Para ordenar?',
  'Quería hacer una consulta',
  'Hola buenas tardes, le quedan fechas para muffins',
  'holaa, que precio tienen las cookies?',
  'hola, cómo estás? cómo es para el tema de envío si quiero pedir algo dulce?',
  'Están haciendo envíos?',
  'a que precio la cookie de nutella?',
  'Hola si acá estoy',
];

let fallas = 0;

for (const t of SOLO_HOLA) {
  const ok = esSoloUnSaludo(t);
  console.log(`${ok ? 'ok   ' : 'FALLA'} solo hola    ${JSON.stringify(t)}`);
  if (!ok) fallas++;
}

console.log();

for (const t of PREGUNTARON) {
  const ok = !esSoloUnSaludo(t);
  console.log(`${ok ? 'ok   ' : 'FALLA'} preguntaron  ${JSON.stringify(t)}`);
  if (!ok) fallas++;
}

const total = SOLO_HOLA.length + PREGUNTARON.length;
console.log(fallas ? `\n${fallas} falla(s) de ${total}` : `\nTodo bien: ${total} mensajes.`);
process.exit(fallas ? 1 : 0);
