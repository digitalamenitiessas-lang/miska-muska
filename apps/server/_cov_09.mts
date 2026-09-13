import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const TZ = 'America/Argentina/Tucuman';
const r = await q<any>(`
with img as (
  select m.id, m.conversation_id cid, m.created_at ts
  from messages m where m.direction='in' and m.content_kind='image'
    and (m.created_at at time zone '${TZ}')::date in ('2026-09-11','2026-09-12')
), c as (
  select i.*,
   (select m2.author from messages m2 where m2.conversation_id=i.cid and m2.direction='out'
      and m2.text ilike '%miskapedidos%' and m2.created_at < i.ts order by m2.created_at desc limit 1) as quien,
   exists (select 1 from orders o where o.conversation_id=i.cid and o.status<>'cancelado'
      and o.created_at < i.ts + interval '6 hours'
      and (o.status<>'entregado' or (o.created_at at time zone '${TZ}')::date=(i.ts at time zone '${TZ}')::date)) as hay
  from img i)
select distinct on (cid) cid, ts, quien from c where hay=false and quien is null order by cid, ts`);
console.log('charlas SIN ALIAS y sin pedido:', r.length);
for (const x of r) {
  const ctx = await q<any>(`select direction,author,content_kind,left(replace(text,E'\n',' | '),140) t, created_at
     from messages where conversation_id=$1 and created_at between $2::timestamptz - interval '25 minutes' and $2::timestamptz + interval '25 minutes' order by created_at`, [x.cid, x.ts]);
  console.log('=== ', x.cid);
  for (const m of ctx) console.log('   ', m.direction, m.author, m.content_kind, '|', m.t);
}
await closeDb();
