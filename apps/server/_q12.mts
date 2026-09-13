import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const TZ = "America/Argentina/Tucuman";
const eps = await q<any>(`
with alias as (
  select m.id, m.conversation_id, m.created_at,
         lag(m.created_at) over (partition by m.conversation_id order by m.created_at) as prev_alias
  from messages m
  where m.direction='out' and (lower(m.text) like '%miskapedidos%' or lower(m.text) like '%miskamuskacursos%')
),
ep as (select id, conversation_id, created_at from alias
  where (prev_alias is null or created_at - prev_alias > interval '12 hours')
    and (created_at at time zone '${TZ}')::date between date '2026-09-06' and date '2026-09-12')
select ep.id, ep.conversation_id, ep.created_at from ep
where (select count(*) from orders o where o.conversation_id=ep.conversation_id
        and o.created_at < ep.created_at and o.created_at > ep.created_at - interval '24 hours' and o.status <> 'cancelado')=0
  and not exists (select 1 from orders o where o.conversation_id=ep.conversation_id
        and o.created_at >= ep.created_at and o.created_at < ep.created_at + interval '24 hours')
  and exists (select 1 from messages m2 where m2.conversation_id=ep.conversation_id and m2.direction='in'
        and m2.payload->>'kind' in ('image','document')
        and m2.created_at > ep.created_at and m2.created_at < ep.created_at + interval '24 hours')
order by ep.created_at`);
const prods = await q<any>(`select name from products`);
const norm = (s:string)=>s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
const objetivo = ['Sep 06 2026 15:44','Sep 06 2026 19:04','Sep 08 2026 09:14','Sep 08 2026 10:59','Sep 09 2026 18:01','Sep 10 2026 22:51','Sep 11 2026 08:48','Sep 12 2026 10:11','Sep 12 2026 12:56','Sep 11 2026 17:38'];
for (const e of eps) {
  const key = String(e.created_at).slice(4,21);
  const ms = await q<any>(`select direction, author, text from messages where conversation_id=$1 and created_at <= $2
     and created_at > $2::timestamptz - interval '12 hours' order by created_at`, [e.conversation_id, e.created_at]);
  const txt = norm(ms.map(m=>m.text).join('\n'));
  if (prods.some(p=>txt.includes(norm(p.name)))) continue;
  console.log('##### ', key, e.conversation_id);
  console.log(ms.slice(-12).map(m=>`${m.direction==='in'?'C':(m.author==='human'?'H':'B')}: ${String(m.text).slice(0,300)}`).join('\n'));
  console.log('');
}
await closeDb();
