/**
 * El termómetro del acento, contra los mensajes de verdad.
 *
 * Lo que se mide no es que encuentre "mola" —eso lo encuentra cualquiera—, sino
 * que NO se prenda con lo que el bot dice bien todos los días. "vale $4.700"
 * sale cien veces por día y es correcto; "no lo podemos coger" no lo dice nunca
 * pero "recoger" sí. Un termómetro que se prende de más no sirve para decidir
 * nada, porque nadie le va a creer.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-acento.mts
 */
import { openDb, q, closeDb } from '../src/core/store/db.js';
import { suenaAEspana } from '../src/core/policies/writing.js';

/** Lo que tiene que prenderse. */
const DEBE: Array<[string, string]> = [
  ['Ah, un regalo grupal para el jefe, eso mola 🤝', 'mola'],
  ['Vale, te lo confirmo en un rato.', 'vale'],
  ['Qué guay que te haya gustado!', 'guay'],
  ['Si vosotros preferís, lo mandamos mañana.', 'vosotros'],
  ['Os apetece algo dulce?', 'vosotros'],
  ['Te va a flipar el relleno.', 'flipar'],
  ['Un zumo de naranja natural.', 'zumo'],
  ['Podés coger el pedido a las 19.', 'coger'],
];

/** Lo que NO se puede prender, porque está bien dicho. */
const NO_DEBE = [
  'El Brownie con nueces vale $4.700 y la Cookie $5.100.',
  'Cuánto vale el desayuno más grande?',
  'Ese no vale la pena, te recomiendo el otro.',
  'Pasá a recoger el pedido cuando quieras.',
  'Vamos a escoger los mejores para tu caja.',
  'Cuando venga el cadete te aviso.',
  'Dale, vale decirlo así.',
  'La tarta de frutillas es la más pedida 🍓',
  'Te mando la ubicación así lo ubicás.',
];

let mal = 0;

console.log('\n  Casos armados a mano\n');
for (const [texto, esperado] of DEBE) {
  const r = suenaAEspana(texto);
  const ok = r.includes(esperado);
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${esperado.padEnd(9)} ${texto.slice(0, 52)}`);
}
for (const texto of NO_DEBE) {
  const r = suenaAEspana(texto);
  const ok = r.length === 0;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${'(limpio)'.padEnd(9)} ${texto.slice(0, 52)}${ok ? '' : ` → prendió ${r.join(', ')}`}`);
}

/*
  Y contra el corpus entero. Acá no hay respuesta esperada: lo que se busca es
  cuántas veces se prende sobre miles de mensajes que ya salieron y que el local
  dio por buenos. Cada aparición se imprime para poder mirarla a ojo.
*/
openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const msgs = await q<{ text: string }>(
  `select text from messages
   where direction='out' and author='bot' and text is not null
     and created_at >= now() - interval '7 days'`,
);
console.log(`\n  Corpus real: ${msgs.length} mensajes del bot de los últimos 7 días\n`);
let prendio = 0;
for (const m of msgs) {
  const r = suenaAEspana(m.text);
  if (r.length) {
    prendio++;
    console.log(`  [${r.join(', ')}] ${m.text.replace(/\s+/g, ' ').slice(0, 110)}`);
  }
}
console.log(
  `\n  Se prendió en ${prendio} de ${msgs.length} (${((prendio / msgs.length) * 100).toFixed(2)}%)`,
);
console.log(mal ? `\n  ${mal} casos armados fallaron.\n` : '\n  Los casos armados pasan todos.\n');
await closeDb();
process.exit(mal ? 1 : 0);
