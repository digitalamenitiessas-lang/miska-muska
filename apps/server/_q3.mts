import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const s = await q<any>(`select value from settings where key='bot'`);
const v = s[0]?.value ?? {};
for (const [k, val] of Object.entries(v)) {
  const str = typeof val === 'string' ? val : JSON.stringify(val);
  if (/alias|pedidos|hora|espera|model/i.test(k)) console.log(k, '=', String(str).slice(0,120));
}
await closeDb();
