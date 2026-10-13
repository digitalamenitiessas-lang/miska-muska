/*
  La guarda de "ya está listo", contra los mensajes que escribe el local.

  Es la que evita que el bot le diga "ya nos ponemos a armar tu pedido" a
  alguien a quien una persona ya le dijo que pase a retirar. El 13 de octubre
  no agarró este, que es clarísimo:

    "que se acerque al local *con tu nombre y apellido* a retirar el pedido"

  Lo que se mide es si agregar esa forma marca algo que NO sea un aviso de
  listo. Cada falso positivo acá le tapa la boca al bot en una charla que
  todavía estaba abierta.
*/
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { diceQueEstaListo } from '../src/core/policies/listo.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const plano = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/* Las dos formas candidatas, sacadas del caso real. */
const SE_ACERQUE = /\bse acerque\b[^.?!]{0,40}\b(a )?(retirar|buscar|retirarlo|buscarlo)\b/;
const PEDIR_UBER = /\bpedi(r|s)?\b[^.?!]{0,20}\buber\b/;

/* Las mismas exclusiones que ya usa la guarda. */
const NO_ES = [
  /\?\s*$/, /\bmanana\b|\bpasado manana\b/, /\b(despues|antes) de\b/,
  /\bcuando (este|lo tengamos|salga|llegue)\b/, /\bapenas\b/,
  /\bno (esta|estan|lo tenemos)\b/, /\bte aviso\b/,
];

const msgs = await q<any>(
  `SELECT to_char(created_at AT TIME ZONE $1,'DD/MM HH24:MI') h, text, conversation_id c
     FROM messages
    WHERE direction='out' AND author='human' AND text IS NOT NULL
      AND created_at > now() - interval '20 days'
    ORDER BY created_at ASC`,
  [TIMEZONE],
);

let yaAgarra = 0;
const nuevosAcerque: any[] = [];
const nuevosUber: any[] = [];

for (const m of msgs) {
  if (diceQueEstaListo(m.text)) {
    yaAgarra++;
    continue;
  }
  const p = plano(m.text);
  if (NO_ES.some((r) => r.test(p))) continue;
  if (SE_ACERQUE.test(p)) nuevosAcerque.push(m);
  else if (PEDIR_UBER.test(p)) nuevosUber.push(m);
}

console.log(`\n  ${msgs.length} mensajes escritos por el local en 20 días.`);
console.log(`  La guarda ya agarra ${yaAgarra} (${((yaAgarra / msgs.length) * 100).toFixed(1)}%).\n`);
console.log(`  "se acerque … a retirar" sumaría ${nuevosAcerque.length}`);
console.log(`  "pedir el uber" sumaría ${nuevosUber.length}\n`);

console.log('  LOS QUE SUMA "SE ACERQUE … A RETIRAR":\n');
for (const m of nuevosAcerque.slice(0, 12)) {
  console.log(`    ${m.h}  ${m.text.replace(/\s+/g, ' ').slice(0, 170)}`);
}
console.log(`\n  LOS QUE SUMA "PEDIR EL UBER" (acá puede haber instrucciones previas):\n`);
for (const m of nuevosUber.slice(0, 12)) {
  console.log(`    ${m.h}  ${m.text.replace(/\s+/g, ' ').slice(0, 170)}`);
}
console.log();

await closeDb();
