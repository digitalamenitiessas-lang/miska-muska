import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const TZ='America/Argentina/Tucuman';
const r = await q<any>(`
with alias as (
  select m.id, m.conversation_id cid, m.created_at ts
  from messages m where m.direction='out' and m.author='bot' and m.text ilike '%miskapedidos%'
    and m.created_at > now() - interval '7 days'
), d as (
  select a.*, (select o.id from orders o where o.conversation_id=a.cid
      and o.created_at >= a.ts - interval '2 minutes' and o.created_at < a.ts + interval '6 hours'
      order by o.created_at limit 1) oid
  from alias a
  where not exists (select 1 from orders o where o.conversation_id=a.cid and o.created_at < a.ts
      and o.status<>'cancelado'
      and (o.status<>'entregado' or (o.created_at at time zone '${TZ}')::date=(a.ts at time zone '${TZ}')::date))
)
select o.created_by, o.delivery_mode,
  (o.customer_name is null or length(trim(o.customer_name))<3) sin_nombre,
  (o.delivery_time is null or o.delivery_time='') sin_hora,
  (o.address is null or o.address='') sin_dir,
  (o.recipient_name is null or o.recipient_name='') sin_recibe,
  count(*) n
from d join orders o on o.id=d.oid
group by 1,2,3,4,5,6 order by 7 desc`);
console.table(r);
const tot = await q<any>(`select count(*) n from (select 1) x`);
await closeDb();
