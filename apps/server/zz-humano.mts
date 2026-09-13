import { openDb, q, closeDb, TIMEZONE } from './src/core/store/db.js';
import fs from 'node:fs';

openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const hits: any[] = JSON.parse(fs.readFileSync('./zz-hits.json', 'utf8'));

const out: string[] = [];
let en40 = 0;
let en2h = 0;
for (const h of hits) {
  // la MISMA ventana que ve el pipeline: ultimos 40 mensajes de la charla antes de este
  const ventana = await q<any>(
    `select author, direction, text, created_at,
        to_char(created_at at time zone $3,'DD/MM HH24:MI') cuando
       from (select * from messages where conversation_id=$1 and created_at < $2
             order by created_at desc limit 40) t order by created_at asc`,
    [h.conversation_id, h.created_at, TIMEZONE],
  );
  const humanos = ventana.filter((m: any) => m.direction === 'out' && m.author === 'human');
  const hayHumano = humanos.length > 0;
  if (hayHumano) en40++;
  const ultimo = humanos[humanos.length - 1];
  const minutos = ultimo
    ? Math.round((new Date(h.created_at).getTime() - new Date(ultimo.created_at).getTime()) / 60000)
    : null;
  if (minutos !== null && minutos <= 120) en2h++;
  out.push(
    `[${h.conversation_id}] hayHumano(40)=${hayHumano} ultimoHumano=${minutos === null ? '-' : minutos + ' min antes'}` +
      (ultimo ? `\n   PERSONA DIJO: ${String(ultimo.text).slice(0, 180).replace(/\n/g, ' ')}` : ''),
  );
}
fs.writeFileSync('./zz-humano.txt', out.join('\n'));
console.log(`hits=${hits.length}  con humano en la ventana de 40 = ${en40}  con humano en las ultimas 2h = ${en2h}`);

// frecuencia del template de la carta de cookies con "transferencia"
const carta = await q<any>(
  `select count(*)::int n from messages
    where direction='out' and author='bot' and content_kind='text'
      and lower(text) like '%disponibles hoy son%'
      and (created_at at time zone $1)::date >= (now() at time zone $1)::date - 6`,
  [TIMEZONE],
);
const carta2 = await q<any>(
  `select count(*)::int n from messages
    where direction='out' and author='bot' and content_kind='text'
      and lower(text) like '%disponibles hoy son%'
      and (lower(text) like '%transferencia%' or lower(text) like '%alias%')
      and (created_at at time zone $1)::date >= (now() at time zone $1)::date - 6`,
  [TIMEZONE],
);
console.log(`carta "disponibles hoy son" en 7 dias: ${carta[0].n}  (de esas, con transferencia/alias: ${carta2[0].n})`);

// quick replies que contengan alias/transferencia
const qr = await q<any>(`select clave, texto from quick_replies`);
for (const r of qr) {
  if (/transferencia|alias|comprobante/i.test(r.texto)) {
    console.log(`\nQUICK REPLY [${r.clave}]: ${String(r.texto).slice(0, 220).replace(/\n/g, ' | ')}`);
  }
}
await closeDb();
