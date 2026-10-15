/**
 * La respuesta rápida "Día de la madre" pasa a decir que se agotaron.
 *
 * POR QUÉ NO SE BORRA: el local la tiene en el cajón con ese nombre y la busca
 * por ahí. Borrarla deja el hueco y a alguien escribiendo el aviso a mano doce
 * veces por día. Cambiarle el cuerpo hace que el botón que ya conocen mande lo
 * correcto.
 *
 * QUÉ TENÍA ADENTRO: los dos box con su precio, el alias, el titular y cómo
 * encargar. Todo cierto hasta la noche del 14 de octubre, cuando se agotaron.
 * La guarda nueva no la cubre, porque una respuesta rápida la manda una persona
 * y no pasa por el pipeline del bot: el único arreglo posible es el texto.
 *
 * Guarda el cuerpo viejo en pantalla antes de pisarlo, por si hay que volver.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/rapido-box-agotado.mts
 *   npx tsx --env-file=../../.env.produccion scripts/rapido-box-agotado.mts --en-serio
 */
import { openDb, q, closeDb } from '../src/core/store/db.js';

const enSerio = process.argv.includes('--en-serio');
const KEY = 'Díadelamadre';

const CUERPO = `Los box del Día de la Madre ya se agotaron 🥺 Cerramos los pedidos y no nos quedan más.

Mil gracias a todas las que encargaron! 🫶🏼

Si ya tenés el tuyo encargado: se retira el sábado 17 de octubre de 14 a 21 hs en Marcos Paz 473. Lo puede retirar otra persona, solo tiene que decir tu nombre y apellido y saber cuál de los dos box es.

Si querés ver qué otras cosas tenemos para regalar, contanos y te mostramos ✨`;

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const [antes] = await q<{ key: string; label: string; body: string; usage_count: number }>(
  'SELECT key, label, body, usage_count FROM quick_replies WHERE key = $1',
  [KEY],
);

if (!antes) {
  console.error(`\n  No existe la respuesta rápida "${KEY}". No toqué nada.\n`);
  await closeDb();
  process.exit(1);
}

console.log(`\n  "${antes.label}" — usada ${antes.usage_count} veces`);
console.log('\n  ── LO QUE DICE HOY ──────────────────────────────');
console.log(antes.body.replace(/^/gm, '  '));
console.log('\n  ── LO QUE VA A DECIR ────────────────────────────');
console.log(CUERPO.replace(/^/gm, '  '));
console.log('  ─────────────────────────────────────────────────\n');

if (!enSerio) {
  console.log('  Esto fue solo la vista previa: NO se tocó nada.');
  console.log('  Para cambiarlo de verdad, volvé a correrlo con --en-serio\n');
  await closeDb();
  process.exit(0);
}

await q('UPDATE quick_replies SET body = $2, updated_at = now() WHERE key = $1', [KEY, CUERPO]);

const [despues] = await q<{ body: string }>('SELECT body FROM quick_replies WHERE key = $1', [KEY]);
const ok = despues?.body === CUERPO;
console.log(`  ${ok ? 'Cambiada.' : 'NO quedó guardada — revisalo.'}`);
console.log('  No hace falta deploy: el panel lee las respuestas rápidas en cada consulta.\n');

await closeDb();
process.exit(ok ? 0 : 1);
