/**
 * Mete en la ficha la propuesta del Día de la Madre.
 *
 * Los datos son los que mandó Agus el 2 de octubre de 2026. La ficha vive en
 * los ajustes, así que esto NO necesita deploy: el bot la relee en cada turno.
 *
 * Es idempotente: si el bloque ya está, lo reemplaza.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/ficha-box-de-la-madre.mts
 *   npx tsx --env-file=../../.env.produccion scripts/ficha-box-de-la-madre.mts --borrar
 */
import { openDb, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

const TITULO = 'BOX DEL DÍA DE LA MADRE — SE RETIRAN EL SÁBADO 17 DE OCTUBRE';

const BLOQUE = `
${TITULO}

Hay dos y están en el catálogo con su precio. Cuando pregunten por el box del Día de la Madre se mandan LOS DOS, con la foto de cada uno, y en el mismo mensaje va cómo se encarga. No se manda uno solo ni se pregunta cuál quiere antes de mostrarle las dos opciones.

- Box "gracias por todo" — $46.000. Brownie franui, pavlova de durazno, shot de suspiro limeño, shot de panacota, cookie de frambuesa, 2 alfajores, sandwich de jamón y queso, 2 chipá, conito de dulce de leche y jugo de naranja. Viene con una cadenita de regalo.
- Box "te amo má" — $35.000. Taza de cerámica, mini brownie, mini pavlova, mini alfajor de pistacho y shot de suspiro limeño.

Cómo se encarga, y esto va pegado a las dos opciones en el mismo mensaje: se abona previamente el box completo por transferencia al alias miskapedidos, a nombre de Mathias Lovey. Nos manda la foto del comprobante, su nombre y apellido, y el nombre del box que eligió, y le respondemos a la brevedad con toda la info para retirar.

Se retiran de Marcos Paz 473 el sábado 17 de octubre. No hacemos envíos a domicilio: el box es delicado y queremos que llegue perfecto para regalar.

La fecha, por si la preguntan: el Día de la Madre es el domingo 18 de octubre, y los box se retiran el sábado 17, el día anterior. No es el 12 ni el 11.

EL PEDIDO NO EXISTE HASTA QUE TRANSFIERE. Es lo más importante de toda la propuesta.

Antes del comprobante no se le confirma NADA a nadie: no se dice "listo, te lo anoto", ni "ya te lo reservo", ni "lo retirás el sábado 17". Que el retiro sea el sábado 17 es un dato de la propuesta, no una confirmación de SU pedido: son dos cosas distintas y no hay que mezclarlas. Mientras no haya comprobante lo único que corresponde es explicarle cómo encargarlo.

Tampoco se anota el pedido con la herramienta. Estos box los carga una persona del local en su propio sistema, y si los anota el bot también quedan cargados dos veces.

CUANDO LLEGA EL COMPROBANTE: se le agradece, se le dice que en un ratito le confirman con toda la info para retirar, y ahí queda. El pedido lo carga una persona.
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
  .replace(new RegExp(`\\n*${TITULO}[\\s\\S]*?(?=\\n[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ,/—-]{14,}\\n|$)`), '\n')
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
