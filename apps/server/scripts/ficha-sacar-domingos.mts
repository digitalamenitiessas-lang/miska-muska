/**
 * Saca de la ficha la línea de los domingos: ahora es una guarda.
 *
 * El local la había escrito ahí y no alcanzó. El bot cargó un box con nuestro
 * cadete para el domingo 13 y después le discutió a la empleada que ya le había
 * avisado a la clienta:
 *
 *   PERSONA  "marina el 13 seria domingo y no hacemos envios ese dia"
 *   bot      "este pedido es un box de regalo, así que ese lo llevamos siempre
 *             nosotros con nuestro cadete 🩷 el domingo lo mandamos desde…"
 *   PERSONA  "marina, es un error del bot. los domingos no realizamos envios"
 *
 * Perdió contra la regla del prompt que dice que los boxes van "SIEMPRE con
 * nuestro cadete": entre una línea de la ficha y una regla del sistema, gana la
 * regla. Ahora las dos dicen lo mismo y además `crear_pedido` rechaza
 * cadete-miska los domingos.
 *
 * Se saca de la ficha para dejarle lugar al local, que es para lo que sirve ese
 * campo: lo que ya hace el código no tiene por qué ocupar espacio ahí.
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
  Se busca la línea por su contenido y no por su texto exacto: la escribió una
  persona a mano y puede tener una coma de más o una tilde de menos.
*/
const lineas = original.split('\n');
const encontradas = lineas.filter(
  (l) => /domingo/i.test(l) && /cadete|envi[oó]/i.test(l) && /no ten|no hac|no realiz/i.test(l),
);

if (!encontradas.length) {
  console.log('  (no encontré la línea de los domingos; no toco nada)');
  await closeDb();
  process.exit(0);
}

console.log('  === se saca ===\n');
for (const l of encontradas) console.log(`  − ${l.trim()}`);

const texto = lineas
  .filter((l) => !encontradas.includes(l))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trimEnd()
  .concat('\n');

console.log(`\n  antes ${original.length} car → después ${texto.length} car (−${original.length - texto.length})`);

if (!aplicar) {
  console.log('\n  (en seco: no se escribió nada. Corré con --aplicar)');
} else {
  await q(`update settings set value = jsonb_set(value, '{conocimiento}', $1::jsonb)`, [
    JSON.stringify(texto),
  ]);
  const dsp = await q<{ v: Record<string, unknown> }>(`select value as v from settings limit 1`, []);
  const guardado = String((dsp[0]?.v ?? {}).conocimiento ?? '');
  const limpio = !/domingo.*(cadete|envi)/i.test(guardado) || guardado === texto;
  console.log(guardado === texto && limpio ? '\n  APLICADO y verificado.' : '\n  ALGO SALIÓ MAL.');
}
await closeDb();
