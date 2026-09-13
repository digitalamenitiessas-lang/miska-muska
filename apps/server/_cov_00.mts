import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const s = await q<any>(`select key, value from settings`);
console.log(JSON.stringify(s.filter((r:any)=>/alias/i.test(r.key)), null, 1));
const d = await q<any>(`select (created_at at time zone 'America/Argentina/Tucuman')::date as dia, count(*) n from messages group by 1 order by 1 desc limit 12`);
console.table(d);
await closeDb();
