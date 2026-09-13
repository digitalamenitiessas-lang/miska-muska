import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const a = await q<any>(`select author, direction, count(*)::int n from messages where created_at>=now()-interval '16 days' group by 1,2 order by n desc`);
console.log(JSON.stringify(a));
const m = await q<any>(`select mode, count(*)::int n from conversations group by 1`);
console.log('modes', JSON.stringify(m));
const cb = await q<any>(`select created_by, status, count(*)::int n from orders where created_at>=now()-interval '16 days' group by 1,2 order by n desc`);
console.log('orders', JSON.stringify(cb));
await closeDb();
