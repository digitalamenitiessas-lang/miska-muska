/**
 * Una torta o un desayuno no los confirma el bot.
 *
 * Lo que se mide con más cuidado es lo que NO se bloquea. Esta guarda reemplaza
 * el mensaje y se lleva la charla a una persona, así que un falso positivo no es
 * ruido: es una venta que se frena y alguien del equipo que tiene que entrar al
 * pedo. Por eso las mini tortas y los box están explícitamente afuera.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-encargos.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { comprometeEncargo } from '../src/core/policies/encargos.js';

/**
 * Tiene que frenar. Todos reales, de la base.
 *
 * El segundo elemento es el CONTEXTO: de que se venia hablando en la charla.
 * Hace falta porque el mensaje que pide la plata muchas veces no nombra la
 * torta —"el monto de la seña es de $17.400"— y ese es justo el que importa.
 */
const FRENA: Array<[string, string]> = [
  ['Recibido! Ya queda anotada tu Torta Red Velvet de 20 porciones para el domingo a las 19:00 🎂', ''],
  ['Listo Lucrecia, quedó anotada tu torta María Luisa para el viernes 04/09 a las 18 🥰', ''],
  ['Perfecto, entonces te lo confirmo: Torta kinder de 20 porciones — $50.000, para retirar el viernes', ''],
  ['Torta chajá de 20 porciones para retirar el sábado a las 18 hs 🥰 El total es $48.500. Para confirmar te paso el alias: miskapedidos', ''],
  // Este no nombra la torta: la venía nombrando la charla.
  ['El monto de la seña es de $17.400 (30% de los $58.000). El alias es miskapedidos',
   'Quiero una chocotorta con decoración para el sábado. El número 9 va de una y el drip blanco también.'],
  ['Perfecto Yesica, entonces te resumo: Desayuno Miska Muska para retirar mañana 3/9 a las 14:30. Total $39.500. Para confirmarlo te paso el alias', ''],
];

/** NO tiene que frenar. */
const SIGUE: string[] = [
  // Preguntar y mostrar la carta es el paso 1, y es suyo.
  'Hola! Para cuándo sería la torta y cuál te gustaría? Tenemos Matilda, Chocotorta, Red Velvet y Kinder 🍰',
  'Las tortas de 10 porciones salen $45.000 y las de 20, $58.000. Para cuándo la necesitás?',
  // La frase que la propia guarda pone.
  'Perfecto! Ya chequeo en la agenda si tenemos disponibilidad y te respondo a la brevedad 🙌🏼',
  // Mini tortas: stock del día, se venden solas.
  'Listo! Te anoto una mini Chocotorta para hoy a las 21:00. El total es $10.800. Para confirmarlo te paso el alias',
  'Nuestras mini tortas disponibles hoy son: Matilda, Oreo y Kinder, a $10.800. Te gustaría encargar alguna?',
  // Box: el bot los toma solo y el local nunca lo objetó.
  'Listo 🙌🏼 Tu pedido: Box Requete Feliz — $23.000. Para confirmarlo te paso el alias: miskapedidos',
  // Nada que ver.
  'Hoy tenemos cookies Kinder, Dubai y Ferrero, todas a $5.000. Cuál te late?',
  'Recibido 🙌🏼 Ya nos ponemos a armar tu pedido, puede demorar unos minutos. Apenas esté listo te avisamos 🩷',
];

let mal = 0;
console.log('\n  Tiene que frenar\n');
for (const [t, contexto] of FRENA) {
  const r = comprometeEncargo(t, false, contexto);
  const ok = r !== null;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${r ? `[${r.motivo}]` : '[no frenó]'} ${t.slice(0, 62)}`);
}
console.log('\n  Tiene que seguir\n');
for (const t of SIGUE) {
  const r = comprometeEncargo(t, false);
  const ok = r === null;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${t.slice(0, 68)}${ok ? '' : ` → frenó por "${r!.motivo}"`}`);
}

/*
  Y la otra mitad: si una PERSONA del local ya habló en la charla, la torta está
  autorizada y la guarda se apaga. Es la lección del domingo de los envíos —
  discutirle a una empleada es peor que no tener guarda.
*/
const conHumano = comprometeEncargo(FRENA[0][0], true, FRENA[0][1]);
const okHumano = conHumano === null;
if (!okHumano) mal++;
console.log(`\n  ${okHumano ? '✓' : '✗'} con una persona ya en la charla, no frena`);

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const msgs = await q<{ d: string; text: string; c: string; created_at: string }>(
  `select to_char(created_at at time zone $1,'DD/MM') d, text, conversation_id c, created_at
   from messages
   where direction='out' and author='bot' and text is not null
     and created_at > now() - interval '10 days'
   order by created_at asc`,
  [TIMEZONE],
);
const humanos = await q<{ c: string; t: string }>(
  `select conversation_id c, min(created_at) t from messages
   where direction='out' and author='human' and created_at > now() - interval '10 days'
   group by 1`,
);
const primero = new Map(humanos.map((h) => [h.c, new Date(h.t).getTime()]));

const porDia = new Map<string, number>();
/* Los ultimos DOS de cada charla, igual que en produccion. */
const previos = new Map<string, string[]>();
for (const m of msgs) {
  const t0 = primero.get(m.c);
  const hayHumano = t0 !== undefined && t0 < new Date(m.created_at).getTime();
  const contexto = (previos.get(m.c) ?? []).slice(-2).join(' ');
  if (comprometeEncargo(m.text, hayHumano, contexto)) porDia.set(m.d, (porDia.get(m.d) ?? 0) + 1);
  previos.set(m.c, [...(previos.get(m.c) ?? []), m.text].slice(-6));
}
const total = [...porDia.values()].reduce((a, b) => a + b, 0);

console.log(`\n  Corpus: ${msgs.length} mensajes del bot, 10 días. Frenaría:\n`);
for (const [d, n] of [...porDia].sort()) console.log(`    ${d}   ${n}`);
console.log(`\n  ${total} en 10 días · ${(total / 10).toFixed(1)} por día`);
console.log(mal ? `\n  ${mal} casos fallaron.\n` : '\n  Los casos pasan todos.\n');

await closeDb();
process.exit(mal ? 1 : 0);
