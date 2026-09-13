import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
console.table(await q<any>(`select column_name, data_type from information_schema.columns where table_name='orders' order by ordinal_position`));
console.table(await q<any>(`select status, count(*) from orders group by 1`));
await closeDb();
