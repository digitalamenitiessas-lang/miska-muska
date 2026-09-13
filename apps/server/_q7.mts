import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const TZ = "America/Argentina/Tucuman";
const rows = await q<any>(`
with alias as (
  select m.id, m.conversation_id, m.created_at, m.author,
         lag(m.created_at) over (partition by m.conversation_id order by m.created_at) as prev_alias
  from messages m
  where m.direction='out'
    and (lower(m.text) like '%miskapedidos%' or lower(m.text) like '%miskamuskacursos%')
),
ep as (
  select id, conversation_id, created_at, author from alias
  where (prev_alias is null or created_at - prev_alias > interval '12 hours')
    and (created_at at time zone '${TZ}')::date between date '2026-09-06' and date '2026-09-12'
)
select ep.id, ep.conversation_id, ep.created_at, ep.author,
  -- pedido que ya existia (creado hasta 24h antes y no cancelado)
  (select count(*) from orders o where o.conversation_id=ep.conversation_id
     and o.created_at < ep.created_at and o.created_at > ep.created_at - interval '24 hours'
     and o.status <> 'cancelado') as pedido_antes,
  -- primer pedido despues del alias (hasta 24h)
  (select o.created_by from orders o where o.conversation_id=ep.conversation_id
     and o.created_at >= ep.created_at and o.created_at < ep.created_at + interval '24 hours'
     order by o.created_at limit 1) as quien_cargo,
  (select extract(epoch from (o.created_at - ep.created_at))/60 from orders o where o.conversation_id=ep.conversation_id
     and o.created_at >= ep.created_at and o.created_at < ep.created_at + interval '24 hours'
     order by o.created_at limit 1) as min_hasta_pedido,
  -- primer adjunto entrante despues del alias
  (select extract(epoch from (m2.created_at - ep.created_at))/60 from messages m2
     where m2.conversation_id=ep.conversation_id and m2.direction='in'
       and m2.payload->>'kind' in ('image','document')
       and m2.created_at > ep.created_at and m2.created_at < ep.created_at + interval '24 hours'
     order by m2.created_at limit 1) as min_hasta_adjunto
from ep order by ep.created_at`);
console.log('episodios', rows.length);
const f = (p:(r:any)=>boolean)=>rows.filter(p).length;
const conAntes = rows.filter(r=>Number(r.pedido_antes)>0);
const sinAntes = rows.filter(r=>Number(r.pedido_antes)===0);
console.log('con pedido YA cargado antes del alias:', conAntes.length, (conAntes.length/7).toFixed(1)+'/dia');
console.log('SIN pedido antes:', sinAntes.length, (sinAntes.length/7).toFixed(1)+'/dia');
const bot = sinAntes.filter(r=>r.quien_cargo==='bot');
const hum = sinAntes.filter(r=>r.quien_cargo && r.quien_cargo!=='bot');
const nadie = sinAntes.filter(r=>!r.quien_cargo);
console.log('  lo carga el bot despues:', bot.length, (bot.length/7).toFixed(1)+'/dia');
console.log('  lo carga una persona  :', hum.length, (hum.length/7).toFixed(1)+'/dia', 'created_by:', [...new Set(hum.map(r=>r.quien_cargo))].join(','));
console.log('  NO LO CARGA NADIE     :', nadie.length, (nadie.length/7).toFixed(1)+'/dia');
const nadieConAdj = nadie.filter(r=>r.min_hasta_adjunto!==null);
console.log('     de esos, con adjunto posterior:', nadieConAdj.length, (nadieConAdj.length/7).toFixed(1)+'/dia',
   '=', ((nadieConAdj.length/nadie.length)*100).toFixed(0)+'%');
console.log('     sin adjunto (no pagaron):', nadie.length-nadieConAdj.length);
// disparos totales del mecanismo: episodios sin pedido antes, con adjunto posterior
const dispara = sinAntes.filter(r=>r.min_hasta_adjunto!==null);
console.log('DISPAROS aprox (sin pedido previo + adjunto):', dispara.length, (dispara.length/7).toFixed(1)+'/dia');
console.log('  de esos, el bot lo iba a cargar igual:', dispara.filter(r=>r.quien_cargo==='bot').length);
console.log('  de esos, lo cargaba una persona      :', dispara.filter(r=>r.quien_cargo && r.quien_cargo!=='bot').length);
await closeDb();
