import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const s = await q<any>(`select key, value from settings`);
for (const r of s) {
  const v = r.value;
  for (const k of Object.keys(v ?? {})) if (/alias|holder/i.test(k)) console.log(r.key, k, '=', JSON.stringify(v[k]));
}
const qr = await q<any>(`select key, body from quick_replies order by key`);
for (const r of qr) if (String(r.body).includes('{{alias}}')) console.log('\n>>>', r.key, '\n', r.body);
await closeDb();
