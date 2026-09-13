import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const c = await q<any>(`select category, count(*) n from products group by 1 order by 2 desc`);
console.table(c);
await closeDb();
