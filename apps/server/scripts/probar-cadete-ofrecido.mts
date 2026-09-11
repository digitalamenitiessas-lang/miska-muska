/**
 * El termómetro del cadete ofrecido de más, contra los mensajes de verdad.
 *
 * Solo anota, así que un falso positivo cuesta una línea de log y nada más. Lo
 * que sí importa es que ENCUENTRE los casos que el local marcó: si no los
 * encuentra, no sirve para saber si la regla nueva alcanzó.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-cadete-ofrecido.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { ofreceCadeteDeMas } from '../src/core/policies/cadete.js';

/** Los que el local marcó el viernes. Reales, copiados de la base. */
const DEBE: string[] = [
  'Claro! Tenemos dos opciones: **Nuestro cadete:** lo llevamos nosotros al domicilio. El costo depende de la zona, así que lo chequeo y te confirmo.',
  'Sí, hacemos envíos! 🚗 Tenemos dos opciones: · **Nuestro cadete** lo lleva — el costo depende de la zona.',
  'Te anoto: 🐄 1 docena ternera y queso — $13.000 **Total: $38.000** Cómo lo querés? Que lo lleve nuestro cadete o mandás un Uber?',
];

/** Los que NO se tienen que anotar. */
const NO_DEBE: string[] = [
  // Un desayuno: el cadete corresponde.
  'Los desayunos los llevamos nosotros con nuestro cadete 🚗 Necesito la dirección.',
  'Sí, los desayunos los llevamos a domicilio! Nuestro cadete lo entrega en la franja que coordinemos.',
  'Dale 🙌🏼 Desayuno Miska Muska a $40.000. Cómo preferís recibirlo — retirás, te lo mandamos nosotros, o mandás un Uber?',
  // Lo está negando, que es la respuesta que pidió el local.
  'Por el momento estamos sin cadete disponible por la alta demanda 🙈 lo que sí podés hacer es mandar un Uber Moto.',
  'Con cookies y muffins no manejamos envío con nuestro cadete 🙈 lo que sí podés hacer es mandar un Uber Moto a retirarlo.',
  // Nada que ver.
  'Te recomiendo mandar un Uber Moto a retirarlo, que te llega más rápido. La dirección es Marcos Paz 473.',
  'Hoy tenemos cookies Kinder, Dubai y Ferrero, todas a $5.000. Cuál te late?',
];

let mal = 0;
console.log('\n  Casos reales\n');
for (const t of DEBE) {
  const r = ofreceCadeteDeMas(t);
  const ok = r !== null;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} anota   ${t.slice(0, 76)}`);
}
for (const t of NO_DEBE) {
  const r = ofreceCadeteDeMas(t);
  const ok = r === null;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} limpio  ${t.slice(0, 76)}${ok ? '' : ` → anotó "${r}"`}`);
}

/*
  Y sobre el corpus: cuántas veces se prendería por día. El número sirve como
  línea de base — si la regla nueva funciona, mañana tiene que bajar.
*/
openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const msgs = await q<{ d: string; text: string; c: string }>(
  `select to_char(created_at at time zone $1,'DD/MM') d, text, conversation_id c
   from messages
   where direction='out' and author='bot' and text is not null
     and created_at > now() - interval '7 days'
   order by created_at asc`,
  [TIMEZONE],
);

const porDia = new Map<string, number>();
const ejemplos: string[] = [];
for (const m of msgs) {
  const r = ofreceCadeteDeMas(m.text);
  if (!r) continue;
  porDia.set(m.d, (porDia.get(m.d) ?? 0) + 1);
  if (ejemplos.length < 8) ejemplos.push(`  ${m.d} [${r}]  ${m.text.replace(/\s+/g, ' ').slice(0, 130)}`);
}

console.log(`\n  Corpus: ${msgs.length} mensajes del bot, 7 días\n`);
for (const [d, n] of porDia) console.log(`  ${d}: ${n}`);
console.log('\n  Una muestra:\n');
console.log(ejemplos.join('\n'));
console.log(mal ? `\n  ${mal} casos fallaron.\n` : '\n  Los casos pasan todos.\n');

await closeDb();
process.exit(mal ? 1 : 0);
