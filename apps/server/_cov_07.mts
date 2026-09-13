import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const TZ = 'America/Argentina/Tucuman';
const r = await q<any>(`
with alias as (
  select m.id, m.conversation_id cid, m.created_at ts, m.text,
         (m.created_at at time zone '${TZ}')::date dia
  from messages m
  where m.direction='out' and m.author='bot' and m.text ilike '%miskapedidos%'
    and (m.created_at at time zone '${TZ}')::date in ('2026-09-11','2026-09-12')
), c as (
select a.*,
  not exists (select 1 from orders o where o.conversation_id=a.cid and o.created_at < a.ts
      and o.status<>'cancelado'
      and (o.status<>'entregado' or (o.created_at at time zone '${TZ}')::date=(a.ts at time zone '${TZ}')::date)) as dispara,
  (select o.created_by from orders o where o.conversation_id=a.cid and o.created_at >= a.ts - interval '2 minutes'
      and o.created_at < a.ts + interval '6 hours' order by o.created_at limit 1) as cargo_despues
from alias a)
select cid, dia, to_char(ts at time zone '${TZ}','HH24:MI') hora, left(replace(text,E'\n',' | '),260) txt
from c where dispara=false and cargo_despues is null order by ts`);
for (const x of r) {
  console.log('---', x.dia?.toISOString?.().slice(0,10), x.hora, x.cid);
  console.log('   ', x.txt);
  const o = await q<any>(`select number,total,paid,status,created_by,created_at,items from orders where conversation_id=$1 order by created_at`, [x.cid]);
  for (const y of o) console.log('    PEDIDO #'+y.number, '$'+y.total, 'pagado', y.paid, y.status, y.created_by, new Date(y.created_at).toISOString(), JSON.stringify(y.items).slice(0,150));
}
await closeDb();
