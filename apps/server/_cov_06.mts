import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const TZ = 'America/Argentina/Tucuman';
const r = await q<any>(`
with alias as (
  select m.id, m.conversation_id cid, m.created_at ts,
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
      and o.created_at < a.ts + interval '6 hours' order by o.created_at limit 1) as cargo_despues,
  exists (select 1 from messages i where i.conversation_id=a.cid and i.direction='in'
      and i.content_kind='image' and i.created_at between a.ts and a.ts + interval '6 hours') as hubo_foto
from alias a)
select dia, dispara, coalesce(cargo_despues,'NADIE') carga, hubo_foto, count(*) n
from c group by 1,2,3,4 order by 1,2,3,4`);
console.table(r);
await closeDb();
