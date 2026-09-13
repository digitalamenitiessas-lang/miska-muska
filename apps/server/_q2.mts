import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const s = await q<any>(`select key, value from settings where key like '%lias%' or key like '%ransfer%'`);
console.log(JSON.stringify(s));
const all = await q<any>(`select key from settings order by key`);
console.log(all.map(r=>r.key).join(', '));
await closeDb();
