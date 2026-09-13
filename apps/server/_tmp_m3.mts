import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const s = await q<any>(`select key, left(value::text, 200) v from settings order by key`);
console.log(JSON.stringify(s, null, 1).slice(0, 3000));
await closeDb();
