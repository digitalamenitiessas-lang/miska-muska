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
ep as (
  select id, conversation_id, created_at from alias
  where (prev_alias is null or created_at - prev_alias > interval '12 hours')
    and (created_at at time zone '${TZ}')::date between date '2026-09-06' and date '2026-09-12'
)
select ep.id, ep.conversation_id, ep.created_at
from ep
where (select count(*) from orders o where o.conversation_id=ep.conversation_id
        and o.created_at < ep.created_at and o.created_at > ep.created_at - interval '24 hours'
        and o.status <> 'cancelado')=0
  and not exists (select 1 from orders o where o.conversation_id=ep.conversation_id
        and o.created_at >= ep.created_at and o.created_at < ep.created_at + interval '24 hours')
  and exists (select 1 from messages m2 where m2.conversation_id=ep.conversation_id and m2.direction='in'
        and m2.payload->>'kind' in ('image','document')
        and m2.created_at > ep.created_at and m2.created_at < ep.created_at + interval '24 hours')
order by ep.created_at`);
console.log('perdidas con comprobante:', eps.length);
const out: any[] = [];
for (const e of eps) {
  const ms = await q<any>(`select direction, author, text, created_at, payload->>'kind' as kind from messages
    where conversation_id=$1 and created_at <= $2 and created_at > $2::timestamptz - interval '12 hours'
    order by created_at desc limit 14`, [e.conversation_id, e.created_at]);
  const texto = ms.map(m=>`${m.direction==='in'?'C':'L'}: ${m.text}`).reverse().join('\n');
  out.push({ id: e.id, conv: e.conversation_id, at: e.created_at, texto });
}
const t = (s:string)=>s.toLowerCase();
let torta=0, desayuno=0, curso=0, senia=0, retiro=0, uber=0, cadete=0;
for (const o of out) {
  const x = t(o.texto);
  if (/\btorta|tortas\b/.test(x)) torta++;
  if (/desayuno|box\b/.test(x)) desayuno++;
  if (/curso|taller/.test(x)) curso++;
  if (/seña|senia|reserva de mesa|cumplea/.test(x)) senia++;
  if (/retir|paso a busc|lo busco/.test(x)) retiro++;
  if (/uber|cabify|didi/.test(x)) uber++;
  if (/cadete|envi|delivery/.test(x)) cadete++;
}
console.log({torta, desayuno, curso, senia, retiro, uber, cadete});
console.log('--- MUESTRA (primeros 8) ---');
for (const o of out.slice(0,8)) {
  console.log('=== ', o.conv, String(o.at));
  console.log(o.texto.slice(-1400));
}
await closeDb();
