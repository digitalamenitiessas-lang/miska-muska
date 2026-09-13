import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });

console.log('--- claves que aparecen en messages.payload (salientes) ---');
const k = await q<any>(`select distinct jsonb_object_keys(payload) k from messages
  where direction='out' and payload is not null`);
console.log('  ' + k.map((r: any) => r.k).join(', '));
console.log('--- claves en payload (entrantes) ---');
const k2 = await q<any>(`select distinct jsonb_object_keys(payload) k from messages
  where direction='in' and payload is not null`);
console.log('  ' + k2.map((r: any) => r.k).join(', '));

console.log('\n--- messages.intent de salientes del bot (ultimos 7 dias) ---');
const i = await q<any>(`select intent, count(*) n from messages where direction='out' and author='bot'
  and created_at > now() - interval '7 days' group by 1 order by 2 desc`);
for (const r of i) console.log(`  ${String(r.intent ?? 'null').padEnd(26)} ${r.n}`);

console.log('\n--- model_turns.intent (ultimos 7 dias) ---');
const t = await q<any>(`select intent, count(*) n from model_turns
  where created_at > now() - interval '7 days' group by 1 order by 2 desc`);
for (const r of t) console.log(`  ${String(r.intent ?? 'null').padEnd(26)} ${r.n}`);

console.log('\n--- columnas de model_turns ---');
const c = await q<any>(`select column_name from information_schema.columns
  where table_name='model_turns' order by ordinal_position`);
console.log('  ' + c.map((r: any) => r.column_name).join(', '));

console.log('\n--- un payload saliente de ejemplo ---');
const ej = await q<any>(`select payload from messages where direction='out' and author='bot'
  and payload is not null order by created_at desc limit 3`);
for (const r of ej) console.log('  ' + JSON.stringify(r.payload).slice(0, 220));
await closeDb();
