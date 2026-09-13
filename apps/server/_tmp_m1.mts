import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const cols = await q<any>(`select table_name, column_name from information_schema.columns where table_name in ('messages','orders','conversations','model_turns','contacts','settings','products') order by table_name, ordinal_position`);
const byT: Record<string,string[]> = {};
for (const c of cols) (byT[c.table_name] ||= []).push(c.column_name);
for (const t of Object.keys(byT)) console.log(t, '::', byT[t].join(','));
const r = await q<any>(`select max(created_at) as maxc, min(created_at) as minc, count(*)::int as n from messages`);
console.log('messages', JSON.stringify(r));
await closeDb();
