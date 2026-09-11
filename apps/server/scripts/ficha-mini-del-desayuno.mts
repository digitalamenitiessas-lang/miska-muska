/**
 * Saca de la ficha el "matilda o 3 leches" del final de la línea de la mini.
 *
 * La línea decía: "Si preguntan que trae la cajita del desayuno respondele que
 * ahi va la mini torta que tenemos disponible segun el stock del local, matilda
 * o 3 leches". Los dos sabores del final leen como un menú, y el bot los tomó
 * así: ofreció las cuatro minis que había ese día para que la clienta eligiera
 * cuál iba adentro. El local lo cortó con "no pueden elegir la mini".
 *
 * Además estaba viejo: hoy la de tres leches está apagada y hay Matilda,
 * Chocotorta, Oreo y Kinder.
 *
 * Se preguntó antes de tocar, porque la ficha es del local. Agus:
 *   "Sii, la mini torta depende del stock de mini torta que tengamos en el día.
 *    Q conteste asi."
 *
 * Corre en seco por defecto; con --aplicar escribe.
 */
import { openDb, q, closeDb } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const aplicar = process.argv.includes('--aplicar');
const filas = await q<{ v: Record<string, unknown> }>(`select value as v from settings limit 1`, []);
const original = String((filas[0]?.v ?? {}).conocimiento ?? '');
if (!original) throw new Error('La ficha vino vacía: no toco nada.');

/*
  Se busca por contenido y no por el texto exacto: lo escribió una persona a
  mano, sin tildes y con la coma donde cayó. Lo que se corta es solo la cola de
  sabores; la explicación de que va según el stock se queda, que es la correcta.
*/
const COLA = /\s*,?\s*matilda\s*(?:o|y|\/)\s*(?:3|tres)\s*leches\.?/gi;

const encontradas = original
  .split('\n')
  .filter((l) => /mini\s*torta/i.test(l) && COLA.test(l));
COLA.lastIndex = 0;

if (!encontradas.length) {
  console.log('\n  La cola de sabores ya no está en la ficha. No hago nada.\n');
  await closeDb();
  process.exit(0);
}

console.log('\n  === como está ===\n');
for (const l of encontradas) console.log('  ' + l.trim());

const nueva = original.replace(COLA, '.');

console.log('\n  === como queda ===\n');
for (const l of nueva.split('\n').filter((l) => /mini\s*torta/i.test(l) && /stock/i.test(l))) {
  console.log('  ' + l.trim());
}
console.log(`\n  ficha: ${original.length} → ${nueva.length} caracteres`);

if (!aplicar) {
  console.log('\n  En seco. Con --aplicar lo escribe.\n');
  await closeDb();
  process.exit(0);
}

await q(
  `update settings set value = jsonb_set(value, '{conocimiento}', to_jsonb($1::text))`,
  [nueva],
);
console.log('\n  Escrito. La ficha se lee de la base en cada turno: no hace falta deploy.\n');
await closeDb();
