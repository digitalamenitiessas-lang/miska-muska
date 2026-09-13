import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const TZ='America/Argentina/Tucuman';
const r = await q<any>(`
with alias as (
  select m.id, m.conversation_id cid, m.created_at ts
  from messages m where m.direction='out' and m.author='bot' and m.text ilike '%miskapedidos%'
    and (m.created_at at time zone '${TZ}')::date in ('2026-09-11','2026-09-12')
), d as (
  select a.*, (select o.id from orders o where o.conversation_id=a.cid
      and o.created_at >= a.ts - interval '2 minutes' and o.created_at < a.ts + interval '6 hours'
      order by o.created_at limit 1) oid
  from alias a
  where not exists (select 1 from orders o where o.conversation_id=a.cid and o.created_at < a.ts
      and o.status<>'cancelado'
      and (o.status<>'entregado' or (o.created_at at time zone '${TZ}')::date=(a.ts at time zone '${TZ}')::date))
)
select d.cid, d.ts, o.number, o.delivery_mode, o.customer_name, o.delivery_time
from d join orders o on o.id=d.oid
where o.created_by='human' and o.delivery_mode='retira-local' and (o.delivery_time is null or o.delivery_time='')
order by d.ts limit 8`);
for (const x of r) {
  console.log('\n===== #'+x.number, x.delivery_mode, '|', x.customer_name, '| cid', x.cid);
  const ctx = await q<any>(`select direction,author,left(replace(text,E'\n',' / '),150) t from messages
     where conversation_id=$1 and created_at <= $2::timestamptz order by created_at desc limit 9`, [x.cid, x.ts]);
  for (const m of ctx.reverse()) console.log('  ', m.direction==='in'?'CLI':'BOT', '|', m.t);
}
await closeDb();
