/**
 * "Combo" es como la gente llama a nuestros desayunos y boxes.
 *
 * Del local: "combos y box podría ser lo mismo porque preguntan mucho por
 * combos. Que responda los desayunos y box que tenemos".
 *
 * Y preguntan: 56 mensajes en 54 charlas en 90 días, casi todos de octubre.
 * El bot venía abriendo con una negación —"de momento no vendemos combos",
 * "combos no manejamos", "los combos no es lo nuestro"— y recién después
 * pasaba a las opciones. No era un invento suyo: no hay ninguna línea nuestra
 * sobre combos, así que dedujo bien que la palabra no está en el catálogo. Lo
 * que faltaba era decirle que sí está, con otro nombre.
 *
 * La ficha vive en los ajustes, así que esto NO necesita deploy.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/ficha-combos.mts
 *   npx tsx --env-file=../../.env.produccion scripts/ficha-combos.mts --borrar
 */
import { openDb, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

const TITULO = 'CUANDO DICEN "COMBO"';

const BLOQUE = `
${TITULO}

"Combo" es como mucha gente llama a nuestros desayunos y boxes. No es un producto distinto ni algo que no tengamos: es la misma cosa con otro nombre.

NO se contesta "no vendemos combos", ni "no manejamos combos", ni "los combos no son lo nuestro". Arrancar negando hace que la persona crea que vino al lugar equivocado, y después ya no lee lo que viene abajo.

Se contesta directo con lo que hay: los desayunos y boxes disponibles, con su precio. Lo mismo que contestarías si hubiera preguntado "qué boxes tienen".

Si preguntan por el combo del Día de la Madre, van los dos box del Día de la Madre con las reglas de siempre.

Si lo que describen no es ninguno de los nuestros —un combo con bebidas, uno armado a pedido— no se inventa nada: se le cuenta qué sí tenemos y se le ofrece eso.
`.trim();

const borrar = process.argv.includes('--borrar');

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const repos = createRepositories();

const antes = await repos.settings.read();
const ficha = antes.conocimiento ?? '';

/* Se corta desde el título hasta el próximo título en mayúsculas, o hasta el final. */
const sinBloque = ficha
  .replace(new RegExp(`\\n*${TITULO}[\\s\\S]*?(?=\\n[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ,/—"-]{14,}\\n|$)`), '\n')
  .trimEnd();

const nueva = borrar ? sinBloque : `${sinBloque}\n\n${BLOQUE}\n`;

console.log(`  ficha antes   : ${ficha.length} caracteres`);
console.log(`  sin el bloque : ${sinBloque.length}`);
console.log(`  ficha después : ${nueva.length}`);

const despues = await repos.settings.write({ conocimiento: nueva });
const ok = (despues.conocimiento ?? '').includes(TITULO);
console.log(`\n  ${borrar ? 'Borrado' : 'Guardado'}. El bloque ${ok ? 'está' : 'NO está'} en la ficha.`);
console.log('  No hace falta deploy: la ficha se relee en cada turno.\n');

await closeDb();
