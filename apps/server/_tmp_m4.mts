import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const s = await q<any>(`select value from settings where key='bot'`);
const v = s[0].value;
const o = typeof v === 'string' ? JSON.parse(v) : v;
for (const k of Object.keys(o)) {
  const val = typeof o[k] === 'string' ? o[k].slice(0,80) : JSON.stringify(o[k]).slice(0,80);
  console.log(k, '=', val);
}
await closeDb();
