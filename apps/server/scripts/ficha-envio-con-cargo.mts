/**
 * El envío nunca es gratis.
 *
 * Del local, el 13 de octubre: "acá le dice que le enviamos sin cargo extra, o
 * sea, algo que nunca hemos hecho, nunca hemos enviado cosas sin extra".
 *
 * El mensaje fue del 11/10 a las 14:32: "El Box Requete Feliz lo llevamos
 * nosotros sin cargo extra 🩷". Uno solo en seis días, pero cada uno de esos
 * es una entrega que el local hace perdiendo plata, o una discusión con la
 * clienta cuando le cobran algo que le dijeron que era gratis.
 *
 * Y no era un invento del modelo: en toda la ficha no hay una sola línea que
 * diga que el envío se cobra. Hay varias sobre a qué zonas llegamos y sobre el
 * Uber, pero ninguna sobre el costo. Sin esa línea, "lo llevamos nosotros" se
 * parece bastante a "gratis".
 *
 *   npx tsx --env-file=../../.env.produccion scripts/ficha-envio-con-cargo.mts
 *   npx tsx --env-file=../../.env.produccion scripts/ficha-envio-con-cargo.mts --borrar
 */
import { openDb, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

const TITULO = 'EL ENVÍO SIEMPRE SE COBRA';

const BLOQUE = `
${TITULO}

Llevarlo nosotros tiene un costo aparte, siempre, en todos los casos. Nunca se dice "sin cargo", "sin costo extra", "el envío va incluido" ni "te lo llevamos gratis". Nunca se hizo un envío gratis y no se va a empezar ahora por un mensaje nuestro.

El precio depende de la zona y no lo sabés vos. Si preguntan cuánto sale, se les pide la dirección y se les dice que alguien del local les confirma el costo en un ratito. Eso es lo correcto y es lo que hay que hacer: no inventes un número ni digas "es barato".

Tampoco se dice que el envío está incluido en el precio del producto. El precio del catálogo es el del producto solo.

Si lo que quieren es evitar el costo, las dos alternativas que sí existen son pasar a retirar por el local o mandar un Uber que ellos pagan. Esas se pueden ofrecer.
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
console.log(`  sin el bloque : ${sinBloque.length}`);
console.log(`  ficha después : ${nueva.length}`);

const despues = await repos.settings.write({ conocimiento: nueva });
const ok = (despues.conocimiento ?? '').includes(TITULO);
console.log(`\n  ${borrar ? 'Borrado' : 'Guardado'}. El bloque ${ok ? 'está' : 'NO está'} en la ficha.`);
console.log('  No hace falta deploy: la ficha se relee en cada turno.\n');

await closeDb();
