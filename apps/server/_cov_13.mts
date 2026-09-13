import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const TZ='America/Argentina/Tucuman';
const r = await q<any>(`
with alias as (
  select m.id, m.conversation_id cid, m.created_at ts
  from messages m where m.direction='out' and m.author='bot' and m.text ilike '%miskapedidos%'
    and (m.created_at at time zone '${TZ}')::date in ('2026-09-11','2026-09-12')
)
select a.cid, a.ts from alias a
where not exists (select 1 from orders o where o.conversation_id=a.cid and o.created_at < a.ts
    and o.status<>'cancelado'
    and (o.status<>'entregado' or (o.created_at at time zone '${TZ}')::date=(a.ts at time zone '${TZ}')::date))
  and not exists (select 1 from orders o where o.conversation_id=a.cid
    and o.created_at >= a.ts - interval '2 minutes' and o.created_at < a.ts + interval '6 hours')
order by a.ts`);
console.log('VENTAS PERDIDAS (disparo sin pedido nunca):', r.length);
for (const x of r) {
  const ct = await q<any>(`select display_name from contacts c join conversations v on v.contact_id=c.id where v.id=$1`,[x.cid]);
  console.log('\n##### cid', x.cid, '| perfil WA:', JSON.stringify(ct[0]?.display_name));
  const ctx = await q<any>(`select direction,author,content_kind,left(replace(text,E'\n',' / '),165) t from messages
     where conversation_id=$1 and created_at between $2::timestamptz - interval '40 minutes' and $2::timestamptz + interval '30 minutes' order by created_at`, [x.cid, x.ts]);
  for (const m of ctx) console.log('  ', m.direction==='in'?'CLI':(m.author==='bot'?'BOT':'LOC'), m.content_kind==='image'?'[IMG]':'', '|', m.t);
}
await closeDb();
