/**
 * Los marcadores internos no salen al chat.
 *
 * Al historial que ve el modelo le metemos rótulos que no existen en la
 * conversación real: "[hoy]", "[ayer]", "[el 8/9/2026]" y "[operador del
 * local]". Una vez el modelo repitió uno: "el operador del local te ofrece que
 * mandes un Uber a retirar", justo en el mensaje donde una clienta cancelaba.
 *
 * Acá se mide lo de siempre, con el peso al revés: que los saque, y sobre todo
 * que no toque nada más. Esta guarda reescribe texto que ya salió bien 10.519
 * veces de 10.520.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-marcadores.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { normalizeWriting } from '../src/core/policies/writing.js';

const CASOS: Array<[string, string]> = [
  // El caso real.
  [
    'Si en algún momento te cambia de idea, el operador del local te ofrece que mandes un Uber a retirar.',
    'Si en algún momento te cambia de idea, el local te ofrece que mandes un Uber a retirar.',
  ],
  // Los rótulos, tal como se inyectan.
  ['[operador del local] podes enviar el uber!', 'podes enviar el uber!'],
  ['[hoy] Holaa! en qué te ayudo?', 'Holaa! en qué te ayudo?'],
  ['[ayer] Te confirmo el pedido', 'Te confirmo el pedido'],
  ['[el 8/9/2026] Te confirmo el pedido', 'Te confirmo el pedido'],
  // Y lo que NO se toca: las mismas palabras usadas normalmente.
  ['Te lo dejamos operativo para hoy', 'Te lo dejamos operativo para hoy'],
  ['Hoy tenemos cookies Kinder y Dubai a $5.000', 'Hoy tenemos cookies Kinder y Dubai a $5.000'],
  ['Ayer se agotaron, pero hoy tenemos de nuevo', 'Ayer se agotaron, pero hoy tenemos de nuevo'],
];

let mal = 0;
console.log('\n  Casos\n');
for (const [entra, espera] of CASOS) {
  const sale = normalizeWriting(entra).text;
  const ok = sale === espera;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${entra.slice(0, 68)}`);
  if (!ok) console.log(`      esperaba: ${espera}\n      salió:    ${sale}`);
}

/*
  El corpus. Lo único que importa acá es cuántos mensajes YA ENVIADOS tocaría:
  tienen que ser los que traen un marcador y ninguno más.
*/
openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const msgs = await q<{ t: string; text: string }>(
  `select to_char(created_at at time zone $1,'DD/MM HH24:MI') t, text
   from messages
   where direction='out' and author='bot' and text is not null
     and created_at > now() - interval '14 days'`,
  [TIMEZONE],
);

let tocaria = 0;
for (const m of msgs) {
  const r = normalizeWriting(m.text);
  if (!r.fixes.includes('marcador interno')) continue;
  tocaria++;
  console.log(`\n  ${m.t}  antes: ${m.text.replace(/\s+/g, ' ').slice(0, 120)}`);
  console.log(`         ahora: ${r.text.replace(/\s+/g, ' ').slice(0, 120)}`);
}

console.log(`\n  Corpus: ${msgs.length} mensajes del bot de 14 días. Tocaría ${tocaria}.`);
console.log(mal ? `\n  ${mal} casos fallaron.\n` : '\n  Los casos pasan todos.\n');

await closeDb();
process.exit(mal ? 1 : 0);
