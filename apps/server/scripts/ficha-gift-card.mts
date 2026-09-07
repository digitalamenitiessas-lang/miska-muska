/**
 * Suma la Gift Card a la ficha.
 *
 * Texto del local, tal cual lo mandaron. Va acá y no en el código porque es una
 * decisión comercial de ellas: qué venden, y cuándo se ofrece.
 *
 * Urge: hoy a las 10:59 el bot contestó "Sobre la gift card: de momento no
 * manejamos eso 🙈" — o sea que ya la están pidiendo y se está perdiendo la
 * venta por no tener el dato cargado.
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

const BLOQUE = `
GIFT CARD – SOLO SI LA PIDEN

Sí tenemos gift cards, y esto es lo que hay que saber:

* 💳 Por el monto que el cliente quiera, no hay montos fijos.
* 🎁 Quien la recibe usa ese monto para comprar cualquiera de nuestros productos.
* 📲 Es digital y se manda por el chat. No hay que retirarla por el local.

IMPORTANTE: NO la ofrezcas por tu cuenta. Cuando pregunten por regalos, por desayunos, por
box o por opciones en general, la gift card NO entra en la lista. Se habla de gift card
únicamente cuando el cliente pregunta específicamente por ella.
`;

if (original.includes('GIFT CARD')) {
  console.log('  (ya hay un bloque de gift card en la ficha: no lo duplico)');
  console.log('  revisalo a mano antes de volver a correr esto.');
  await closeDb();
  process.exit(0);
}

const texto = `${original.trimEnd()}\n${BLOQUE}`;

console.log('  ok  bloque de gift card agregado al final');
console.log(`\n  antes ${original.length} car → después ${texto.length} car`);

if (!aplicar) {
  console.log('\n  (en seco: no se escribió nada. Corré con --aplicar)');
} else {
  await q(`update settings set value = jsonb_set(value, '{conocimiento}', $1::jsonb)`, [
    JSON.stringify(texto),
  ]);
  const dsp = await q<{ v: Record<string, unknown> }>(`select value as v from settings limit 1`, []);
  const guardado = String((dsp[0]?.v ?? {}).conocimiento ?? '');
  console.log(
    guardado === texto && guardado.includes('GIFT CARD')
      ? '\n  APLICADO y verificado.'
      : '\n  ALGO SALIÓ MAL al guardar.',
  );
}
await closeDb();
