/**
 * El precio promocional de los box se terminó el 13 de octubre.
 *
 * De Agus: "le vamos a modificar el precio a los box porque ya se terminó el
 * precio promocional. Lo voy a modificar en el sistema, pero no sé si en algún
 * lado podés poner por si preguntan 'no era 46'. Que contestes: ese era el
 * precio promocional abonando hasta el 13".
 *
 * Y va a pasar mucho: el precio viejo se nombró 2.603 veces en veinte días.
 * Toda esa gente tiene $46.000 escrito en su chat.
 *
 * Los precios nuevos NO se escriben acá: salen del catálogo, que es donde el
 * local los cambia. Si los repitiera en la ficha, el día que los vuelva a
 * tocar tendríamos dos números distintos y ninguna forma de saber cuál manda.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/ficha-precio-promocional.mts
 *   npx tsx --env-file=../../.env.produccion scripts/ficha-precio-promocional.mts --borrar
 */
import { openDb, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

const TITULO = 'SI DICEN QUE EL BOX ERA MÁS BARATO';

const BLOQUE = `
${TITULO}

Los box del Día de la Madre tuvieron un precio promocional —$46.000 el "gracias por todo" y $35.000 el "te amo má"— que valía para quienes abonaran hasta el 13 de octubre. Ese precio ya terminó. Los que valen ahora son los del catálogo.

Mucha gente tiene el precio viejo escrito en su chat, así que van a preguntar. Cuando digan "yo vi que era 46", "me habían dicho 35" o parecido:

- No se les dice que están equivocados ni que se confundieron. Tenían razón: ese precio existió.
- Se les explica cortito que era el precio promocional por abonar hasta el 13 de octubre, que ya pasó, y se les pasa el precio de ahora.
- No se discute ni se insiste. Una vez dicho, se sigue con la venta.

Si insisten, dicen que les habían prometido ese precio, o que ya habían arreglado antes, NO decidas vos: decile que lo estás viendo y que en un ratito le confirman. Eso lo resuelve una persona del local, porque puede haber un caso puntual que valga la pena respetar y esa decisión no es tuya.

Y al revés también: nunca ofrezcas el precio promocional por tu cuenta, ni digas "te lo puedo dejar al precio de antes". Ese descuento no existe más.
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

const sinBloque = ficha
  .replace(new RegExp(`\\n*${TITULO}[\\s\\S]*?(?=\\n[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ,/—"-]{14,}\\n|$)`), '\n')
  .trimEnd();

const nueva = borrar ? sinBloque : `${sinBloque}\n\n${BLOQUE}\n`;

console.log(`  ficha antes   : ${ficha.length} caracteres`);
console.log(`  ficha después : ${nueva.length}`);

const despues = await repos.settings.write({ conocimiento: nueva });
console.log(`\n  ${borrar ? 'Borrado' : 'Guardado'}. El bloque ${(despues.conocimiento ?? '').includes(TITULO) ? 'está' : 'NO está'}.`);

/* Lo que el bot va a cobrar de verdad, que sale del catálogo y no de acá. */
const box = (await repos.products.list()).filter((p) => p.id.startsWith('box-madre'));
console.log('\n  Los precios que manda el catálogo:');
for (const p of box) console.log(`    ${p.name.padEnd(26)} $${p.price.toLocaleString('es-AR')}`);
console.log('\n  No hace falta deploy.\n');

await closeDb();
