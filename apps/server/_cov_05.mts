import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const TZ = 'America/Argentina/Tucuman';
const k = await q<any>(`select content_kind, direction, count(*) n from messages where created_at > now() - interval '7 days' group by 1,2 order by 3 desc limit 20`);
console.table(k);
const ord = await q<any>(`select (created_at at time zone '${TZ}')::date dia, created_by, count(*) n from orders group by 1,2 order by 1 desc limit 20`);
console.table(ord);
await closeDb();
