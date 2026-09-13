import { openDb, q, closeDb, TIMEZONE } from './src/core/store/db.js';
import fs from 'node:fs';

openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });

const hits: any[] = JSON.parse(fs.readFileSync('./zz-hits.json', 'utf8'));

let conHumanoAntes = 0;
const filas: any[] = [];
for (const h of hits) {
  // hubo una persona del local escribiendo ANTES de este mensaje?
  const previos = await q<any>(
    `select count(*)::int n from messages
      where conversation_id=$1 and direction='out' and author='human' and created_at < $2`,
    [h.conversation_id, h.created_at],
  );
  const humanoAntes = previos[0].n > 0;
  if (humanoAntes) conHumanoAntes++;
  // modo de la conversacion
  const conv = await q<any>(`select mode, needs_attention from conversations where id=$1`, [h.conversation_id]);
  filas.push({
    cuando: h.cuando,
    conv: h.conversation_id.slice(0, 18),
    prods: h.prods.join(', '),
    humanoAntes,
    modo: conv[0]?.mode,
  });
}
console.table(filas);
console.log(`\nhits en charlas donde YA habia hablado una persona del local: ${conHumanoAntes} de ${hits.length}`);

console.log('\n=================== TEXTOS COMPLETOS ===================');
for (const h of hits) {
  console.log(`\n--- [${h.cuando}] ${h.conversation_id} :: ${h.prods.join(', ')}`);
  console.log(h.text);
}
await closeDb();
