/**
 * "Sigo esperando" cuando no hay nada esperando.
 *
 * La guarda tiene dos mitades y acá se prueba la del TEXTO. La otra —si hay o
 * no una consulta abierta— no se prueba porque no hace falta: es una fila en la
 * base, no una interpretación.
 *
 * Lo que importa es no frenar el ARRANQUE de una consulta. "Dejame que lo
 * chequeo" está bien dicho y es el primer paso; lo que está mal es seguir
 * diciéndolo cuando ya contestaron.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-sigue-esperando.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { diceQueSigueEsperando } from '../src/core/policies/consultas.js';

/** Dice que sigue esperando. Reales. */
const ESPERA: string[] = [
  'Estoy en contacto con cocina, dame un momentito más 🙈',
  'Todavía estoy chequeando! Dame un minuto más que ya tengo respuesta 🙈',
  'Todavía estoy esperando la confirmación de cocina 🙈 dame unos segunditos más!',
  'Esperame un poquito más que estoy viendo con cocina 🙊',
  'Sigo consultando con el local, en un ratito te confirmo',
];

/** El arranque de una consulta, que está bien y no se toca. */
const ARRANCA: string[] = [
  'Dale, dejame que lo chequeo! 🙌🏼',
  'Ahora lo chequeo y en un ratito te confirmo si llega para el domingo 🙌🏼',
  'Ahora te confirman desde cocina si podemos hacértela. Esperame un segundo!',
  'Perfecto! Ya chequeo en la agenda si tenemos disponibilidad y te respondo a la brevedad 🙌🏼',
  'Hoy tenemos cookies Kinder, Dubai y Ferrero, todas a $5.000. Cuál te late?',
  'Recibido 🙌🏼 Ya nos ponemos a armar tu pedido, puede demorar unos minutos. Apenas esté listo te avisamos 🩷',
];

let mal = 0;
console.log('\n  Dice que sigue esperando\n');
for (const t of ESPERA) {
  const ok = diceQueSigueEsperando(t);
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${t.slice(0, 70)}`);
}
console.log('\n  Está arrancando la consulta: no se toca\n');
for (const t of ARRANCA) {
  const ok = !diceQueSigueEsperando(t);
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${t.slice(0, 70)}`);
}

/*
  Y sobre el corpus, para dimensionar. El número de verdad es más chico que
  este: acá no se puede saber si en ese momento había una consulta abierta, así
  que esto es el techo.
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
const n = msgs.filter((m) => diceQueSigueEsperando(m.text)).length;
console.log(`\n  Corpus: ${msgs.length} mensajes del bot, 10 días.`);
console.log(`  Dicen que siguen esperando: ${n} (${(n / 10).toFixed(1)} por día).`);
console.log('  De esos, solo se tocan los que además no tienen consulta abierta.');
console.log(mal ? `\n  ${mal} casos fallaron.\n` : '\n  Los casos pasan todos.\n');

await closeDb();
process.exit(mal ? 1 : 0);
