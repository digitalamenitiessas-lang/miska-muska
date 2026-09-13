import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const TZ = "America/Argentina/Tucuman";
const rows = await q<any>(`
with alias as (
  select m.id, m.conversation_id, m.created_at, m.author, m.text,
         lag(m.created_at) over (partition by m.conversation_id order by m.created_at) as prev_alias
  from messages m
  where m.direction='out'
    and (lower(m.text) like '%miskapedidos%' or lower(m.text) like '%miskamuskacursos%')
),
ep as (
  select * from alias
  where (prev_alias is null or created_at - prev_alias > interval '12 hours')
    and (created_at at time zone '${TZ}')::date between date '2026-09-06' and date '2026-09-12'
)
select (created_at at time zone '${TZ}')::date as dia, count(*) n, count(*) filter (where author='human') humano
from ep group by 1 order by 1`);
let tot=0, hum=0;
for (const r of rows) { console.log(String(r.dia).slice(0,10), 'episodios', r.n, ' dichos por persona', r.humano); tot+=Number(r.n); hum+=Number(r.humano); }
console.log('TOTAL', tot, 'prom/dia', (tot/7).toFixed(1), 'por humano', hum);
await closeDb();
