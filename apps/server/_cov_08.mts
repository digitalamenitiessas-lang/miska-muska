import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const TZ = 'America/Argentina/Tucuman';
/* Comprobantes: imagen entrante precedida (dentro de la charla, antes) por un
   saliente con alias de pedidos. Se separa por QUIEN mando ese alias. */
const r = await q<any>(`
with img as (
  select m.id, m.conversation_id cid, m.created_at ts, (m.created_at at time zone '${TZ}')::date dia
  from messages m where m.direction='in' and m.content_kind='image'
    and (m.created_at at time zone '${TZ}')::date in ('2026-09-11','2026-09-12')
), c as (
  select i.*,
   (select m2.author from messages m2 where m2.conversation_id=i.cid and m2.direction='out'
      and m2.text ilike '%miskapedidos%' and m2.created_at < i.ts
      order by m2.created_at desc limit 1) as quien_alias,
   exists (select 1 from orders o where o.conversation_id=i.cid
      and o.created_at between i.ts - interval '12 hours' and i.ts + interval '6 hours'
      and o.status<>'cancelado') as hay_pedido,
   exists (select 1 from orders o where o.conversation_id=i.cid and o.status<>'cancelado'
      and o.created_at < i.ts + interval '6 hours'
      and (o.status<>'entregado' or (o.created_at at time zone '${TZ}')::date=(i.ts at time zone '${TZ}')::date)) as hay_vigente
  from img i
)
select dia, coalesce(quien_alias,'SIN ALIAS') quien_alias, hay_pedido, hay_vigente, count(*) n
from c group by 1,2,3,4 order by 1,2,3,4`);
console.table(r);
await closeDb();
