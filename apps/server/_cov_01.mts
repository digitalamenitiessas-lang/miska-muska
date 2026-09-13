import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const cols = await q<any>(`select table_name, column_name, data_type from information_schema.columns where table_schema='public' and table_name in ('settings','messages','orders','conversations','model_turns') order by table_name, ordinal_position`);
const byT: Record<string,string[]> = {};
for (const c of cols) (byT[c.table_name] ??= []).push(`${c.column_name}:${c.data_type}`);
for (const t of Object.keys(byT)) console.log(t, '=>', byT[t].join(', '));
const st = await q<any>(`select * from settings limit 3`);
console.log('SETTINGS SAMPLE:', JSON.stringify(st).slice(0, 2000));
await closeDb();
