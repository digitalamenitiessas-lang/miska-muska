/**
 * Saca de la base todo rastro de la propuesta del Día de la Madre 2026.
 *
 * Agus, el 19 de octubre —dos días después del retiro—: "borrá todo lo del día
 * de la madre xfa. Nombres de los box, cómo tomar pedidos etc. q ya no los
 * ofrezca. Horario retiro todo así no se confunda".
 *
 * El horario es lo que más le preocupa, y con razón: los box se entregaban de
 * 14 a 21 y el local abre a las 8. Mientras esa regla siga escrita el bot tiene
 * dos horarios dando vueltas, y ya confundió uno con otro una vez.
 *
 * QUÉ NO SE TOCA: los 293 pedidos que ya se entregaron. Cada uno guarda el
 * nombre y el precio adentro de su propio JSON —`description` y `unitPrice`— y
 * nada los resuelve contra el catálogo, así que borrar los productos no les
 * cambia nada. El historial queda entero.
 *
 * CÓMO SE CORTA EL BLOQUE DE LA FICHA: desde el título hasta el próximo título
 * en mayúsculas, o hasta el final. Se busca el título como texto plano y se
 * corta con índices, A PROPÓSITO, en vez de armar una expresión regular con el
 * título adentro: el título tiene una raya larga y una coma, y cualquier cosa
 * que se le parezca a un metacarácter convierte un borrado en una ruleta.
 *
 * Hay un respaldo entero de hoy en /var/backups/miska, así que esto se puede
 * deshacer si hiciera falta.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/limpiar-dia-de-la-madre.mts
 *   npx tsx --env-file=../../.env.produccion scripts/limpiar-dia-de-la-madre.mts --en-serio
 */
import { openDb, q, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

const enSerio = process.argv.includes('--en-serio');
const BOXES = ['box-madre-gracias-por-todo', 'box-madre-te-amo-ma'];

const TITULOS = [
  'BOX DEL DÍA DE LA MADRE — PEDIDOS CERRADOS, SE RETIRAN EL SÁBADO 17',
  'BOX DEL DÍA DE LA MADRE — SE RETIRAN EL SÁBADO 17 DE OCTUBRE',
  'SI DICEN QUE EL BOX ERA MÁS BARATO',
];

/*
  LOS TÍTULOS DE LAS OTRAS SECCIONES, que son el límite de lo que se puede
  borrar. Se listan a mano en vez de deducir cuál es un título.

  Deducirlo ya falló: la primera versión cortaba hasta la próxima línea en
  mayúsculas, y adentro del bloque hay frases enteras en mayúsculas —"LO QUE
  SIGUE ES PARA QUIEN YA ENCARGÓ Y PAGÓ"— que no son títulos de nada. Cortaba
  a un tercio y dejaba el resto, que es el peor resultado posible: la ficha
  sigue explicando cómo vender los box pero sin la parte que avisa que están
  agotados.
*/
const OTRAS_SECCIONES = [
  'CONSULTAS POR COOKIES DISPONIBLES',
  'CONTENIDO DE CADA OPCIÓN',
  'BOX REQUETE FELIZ',
  'DESAYUNO MISKA MUSKA',
  'DESAYUNO BUEN DÍA',
  'BOX DE COOKIES EDICIÓN LIMITADA',
  'EL ENVÍO SIEMPRE SE COBRA',
];

/**
 * Saca el bloque que arranca en `titulo`, hasta la próxima sección conocida o
 * hasta el final de la ficha.
 *
 * Trabaja por líneas y con una lista explícita de dónde termina. Es más largo
 * de leer que una expresión regular y no se equivoca, que acá es lo único que
 * importa: lo que se borra mal no se entera nadie hasta que el bot contesta
 * cualquier cosa.
 */
function sacarBloque(texto: string, titulo: string): string {
  const lineas = texto.split('\n');
  const desde = lineas.findIndex((l) => l.trim() === titulo);
  if (desde === -1) return texto;

  let hasta = lineas.length;
  for (let i = desde + 1; i < lineas.length; i++) {
    const l = lineas[i].trim();
    if (OTRAS_SECCIONES.some((s) => l.startsWith(s))) {
      hasta = i;
      break;
    }
  }

  const quedan = [...lineas.slice(0, desde), ...lineas.slice(hasta)];
  // Tres saltos seguidos o más quedan en dos: si no, el recorte deja agujeros.
  return quedan.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const repos = createRepositories();

const ficha = (await repos.settings.read()).conocimiento ?? '';
const fichaLimpia = TITULOS.reduce(sacarBloque, ficha);

const prods = await q<{ id: string; name: string }>(
  'SELECT id, name FROM products WHERE id = ANY($1)',
  [BOXES],
);
const camps = await q<{ id: string; name: string; skus: string }>(
  `SELECT c.id, c.name, count(s.*) AS skus FROM campaigns c
     LEFT JOIN campaign_skus s ON s.campaign_id = c.id
    WHERE c.name ILIKE '%madre%' GROUP BY c.id, c.name`,
);
const rapidas = await q<{ key: string }>(
  `SELECT key FROM quick_replies WHERE key ILIKE '%madre%' OR body ILIKE '%día de la madre%'`,
);

console.log('\n  SE VA A BORRAR:');
console.log(`    ficha      : ${ficha.length} → ${fichaLimpia.length} caracteres`);
for (const p of prods) console.log(`    producto   : ${p.name}`);
for (const c of camps) console.log(`    campaña    : ${c.name} (${c.skus} SKUs)`);
for (const r of rapidas) console.log(`    respuesta  : ${r.key}`);

const [ped] = await q<{ n: string }>(
  `SELECT count(*) AS n FROM orders WHERE items::text ILIKE '%box-madre%'`,
);
console.log(`\n  SE CONSERVA: los ${ped.n} pedidos ya entregados, con su nombre y precio adentro.`);

/*
  Si el recorte de la ficha no sacó nada, algo está mal y es mejor frenar que
  borrar los productos y dejar la ficha explicando cómo venderlos.
*/
if (fichaLimpia.length >= ficha.length - 5) {
  console.error('\n  LA FICHA NO SE RECORTÓ. No sigo: revisá los títulos.\n');
  await closeDb();
  process.exit(1);
}

if (!enSerio) {
  console.log('\n  Vista previa: NO se tocó nada.');
  console.log('  Para borrarlo de verdad, volvé a correrlo con --en-serio\n');
  await closeDb();
  process.exit(0);
}

await repos.settings.write({ conocimiento: fichaLimpia });
// Los SKUs se van solos: la FK de campaign_skus es ON DELETE CASCADE.
for (const c of camps) await q('DELETE FROM campaigns WHERE id = $1', [c.id]);
for (const r of rapidas) await q('DELETE FROM quick_replies WHERE key = $1', [r.key]);
await q('DELETE FROM products WHERE id = ANY($1)', [BOXES]);

/* Se vuelve a leer de la base, no de lo que creemos haber escrito. */
const despues = (await repos.settings.read()).conocimiento ?? '';
const quedan = await q<{ q: string }>(
  `SELECT 'producto: ' || name AS q FROM products WHERE id = ANY($1)
   UNION ALL SELECT 'campaña: ' || name FROM campaigns WHERE name ILIKE '%madre%'
   UNION ALL SELECT 'respuesta: ' || key FROM quick_replies
     WHERE key ILIKE '%madre%' OR body ILIKE '%día de la madre%'`,
  [BOXES],
);
const rastros = despues.match(/d[ií]a de la madre|gracias por todo|te amo m[aá]|14 a 21/gi) ?? [];

console.log(`\n  ficha: ${rastros.length ? `TODAVÍA menciona: ${rastros.join(', ')}` : 'limpia'}`);
console.log(`  base : ${quedan.length ? 'quedan cosas:' : 'limpia'}`);
for (const x of quedan) console.log(`    ${x.q}`);
console.log('\n  No hace falta deploy: la ficha y el catálogo se releen en cada turno.\n');

await closeDb();
process.exit(!rastros.length && !quedan.length ? 0 : 1);
