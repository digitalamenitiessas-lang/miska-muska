import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const s = await q<any>(`select key, value from settings`);
for (const r of s) {
  const v = JSON.stringify(r.value);
  if (/alias|transfer|curso/i.test(v)) console.log(r.key, v.slice(0, 700));
}
const qr = await q<any>(`select key, auto_send, left(body, 200) as body from quick_replies where body ilike '%{{alias}}%'`);
console.log('--- quick replies con alias ---');
console.table(qr);
const rango = await q<any>(`select min(created_at) as desde, max(created_at) as hasta, count(*) from messages`);
console.log(rango);
await closeDb();
