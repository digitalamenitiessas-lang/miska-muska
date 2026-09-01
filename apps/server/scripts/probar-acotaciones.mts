/**
 * Una acotación de guion no le llega nunca a la clienta.
 *
 * Pasó de verdad: alguien mandó un CV, el bot agradeció, y el mensaje siguiente
 * que recibió fue "*(sin respuesta adicional, la conversación quedó cerrada con
 * el agradecimiento)*". El modelo narrando que no tiene nada que decir, en vez
 * de no decir nada.
 *
 * La causa se arregló con `no_contestar`. Esto es la red, y lo que importa acá
 * son los casos que NO hay que descartar: hay burbujas legítimas que también
 * son un paréntesis entero.
 *
 *   npx tsx scripts/probar-acotaciones.mts
 */

import { esAcotacion, normalizeBubbles } from '../src/core/policies/writing.js';

const ACOTACIONES: string[] = [
  '*(sin respuesta adicional, la conversación quedó cerrada con el agradecimiento)*',
  '(sin respuesta adicional)',
  '(no hace falta responder nada más)',
  '*No respondo nada más, la charla ya terminó*',
  '[el mensaje no requiere respuesta]',
  '(la conversación quedó cerrada)',
];

const MENSAJES_DE_VERDAD: string[] = [
  '(te lo dejo anotado)',
  '(el precio es por docena)',
  'Perfecto! (te lo anoto para las 18)',
  'Cerrado por acá 🙌',
  'Gracias a vos! que la disfrutes 💕',
  '*Importante*: el envío se cobra aparte',
  '(pasame el nombre cuando puedas)',
];

let fallas = 0;

for (const t of ACOTACIONES) {
  const ok = esAcotacion(t);
  console.log(`${ok ? 'ok   ' : 'FALLA'} se descarta   ${JSON.stringify(t.slice(0, 66))}`);
  if (!ok) fallas++;
}

console.log();

for (const t of MENSAJES_DE_VERDAD) {
  const ok = !esAcotacion(t);
  console.log(`${ok ? 'ok   ' : 'FALLA'} se manda      ${JSON.stringify(t.slice(0, 66))}`);
  if (!ok) fallas++;
}

// Y que el turno entero sobreviva: si la acotación viaja con un mensaje bueno,
// se va la acotación y queda el mensaje.
const { bubbles, fixes } = normalizeBubbles([
  'Gracias por escribirnos! Quedan guardados tus datos 🙏',
  '*(sin respuesta adicional, la conversación quedó cerrada)*',
]);
const bien = bubbles.length === 1 && bubbles[0].startsWith('Gracias') && fixes.includes('acotación de guion');
console.log(`\n${bien ? 'ok   ' : 'FALLA'} el turno con dos burbujas conserva la buena y descarta la acotación`);
if (!bien) {
  fallas++;
  console.log('         quedó: ' + JSON.stringify(bubbles) + '  fixes: ' + JSON.stringify(fixes));
}

const total = ACOTACIONES.length + MENSAJES_DE_VERDAD.length + 1;
console.log(fallas ? `\n${fallas} falla(s) de ${total}` : `\nTodo bien: ${total} casos.`);
process.exit(fallas ? 1 : 0);
