import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const s = await q<any>(`select key, value from settings limit 20`).catch(async () => q<any>(`select * from settings limit 5`));
console.log(JSON.stringify(s, null, 1).slice(0, 3000));
await closeDb();
