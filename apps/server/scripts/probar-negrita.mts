/**
 * Los asteriscos de la negrita no salen al chat.
 *
 * Del local: "antes no ponía los **, no sé qué pasó". En WhatsApp la negrita es
 * con UN asterisco, así que "**Cookies:**" se ve tal cual, con los cuatro
 * asteriscos a la vista.
 *
 * Lo que se mide con más cuidado es lo que NO se toca: la ficha usa "* Café
 * doble — $3.800" como viñeta, y el asterisco solo está bien escrito.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-negrita.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { normalizeWriting } from '../src/core/policies/writing.js';

const CASOS: Array<[string, string]> = [
  // Reales, de hoy.
  ['**Cookies:** vainilla con chips, nutella, kinder, dubai, ferrero — todas a $5.000',
   'Cookies: vainilla con chips, nutella, kinder, dubai, ferrero — todas a $5.000'],
  ['🎁 **Box de Cookies Edición Limitada** a $22.000 — trae 4 sabores nuevos',
   '🎁 Box de Cookies Edición Limitada a $22.000 — trae 4 sabores nuevos'],
  ['**Total:** $17.800', 'Total: $17.800'],
  ['Para confirmarlo te paso el alias: **miskapedidos**', 'Para confirmarlo te paso el alias: miskapedidos'],
  // Varios pares en el mismo mensaje.
  ['**Alias:** miskapedidos **Titular:** Mathias Exequiel Lovey',
   'Alias: miskapedidos Titular: Mathias Exequiel Lovey'],
  // Un par mal cerrado: el suelto también se va.
  ['**Total: $22.000 y el envío aparte', 'Total: $22.000 y el envío aparte'],
  // Y lo que NO se toca.
  ['* Café doble — $3.800', '* Café doble — $3.800'],
  ['Tenemos 2 x Muffin pistacho a $4.800', 'Tenemos 2 x Muffin pistacho a $4.800'],
  ['Hoy tenemos cookies Kinder y Dubai a $5.000', 'Hoy tenemos cookies Kinder y Dubai a $5.000'],
];

let mal = 0;
console.log('\n  Casos\n');
for (const [entra, espera] of CASOS) {
  const sale = normalizeWriting(entra).text;
  const ok = sale === espera;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${entra.slice(0, 66)}`);
  if (!ok) console.log(`      esperaba: ${espera}\n      salió:    ${sale}`);
}

/*
  El corpus. Acá interesan dos números: cuántos tocaría —tienen que ser los del
  modelo nuevo y ninguno de los viejos— y que ninguno quede con un asterisco
  suelto después de pasar.
*/
openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const msgs = await q<{ d: string; text: string }>(
  `select to_char(created_at at time zone $1,'DD/MM') d, text
   from messages
   where direction='out' and author='bot' and text is not null
     and created_at > now() - interval '10 days'`,
  [TIMEZONE],
);

const por = new Map<string, number>();
let quedanAsteriscos = 0;
for (const m of msgs) {
  const r = normalizeWriting(m.text);
  if (!r.fixes.includes('asteriscos de negrita')) continue;
  por.set(m.d, (por.get(m.d) ?? 0) + 1);
  if (r.text.includes('**')) quedanAsteriscos++;
}

console.log(`\n  Corpus: ${msgs.length} mensajes del bot, 10 días. Tocaría:\n`);
for (const [d, n] of [...por].sort()) console.log(`  ${d}   ${n}`);
console.log(`\n  Quedan con ** después de pasar: ${quedanAsteriscos}`);
if (quedanAsteriscos) mal++;
console.log(mal ? `\n  ${mal} problemas.\n` : '\n  Los casos pasan todos.\n');

await closeDb();
process.exit(mal ? 1 : 0);
