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
select ep.id, ep.conversation_id, ep.created_at from ep
where (select count(*) from orders o where o.conversation_id=ep.conversation_id
        and o.created_at < ep.created_at and o.created_at > ep.created_at - interval '24 hours' and o.status <> 'cancelado')=0
  and not exists (select 1 from orders o where o.conversation_id=ep.conversation_id
        and o.created_at >= ep.created_at and o.created_at < ep.created_at + interval '24 hours')
  and exists (select 1 from messages m2 where m2.conversation_id=ep.conversation_id and m2.direction='in'
        and m2.payload->>'kind' in ('image','document')
        and m2.created_at > ep.created_at and m2.created_at < ep.created_at + interval '24 hours')
order by ep.created_at`);
const prods = await q<any>(`select name, category from products`);
const norm = (s:string)=>s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
let necesitaFecha=0, retiroSinHora=0, retiro=0, cadete=0, uber=0, ningunProducto=0, curso=0;
const detalle:string[]=[];
for (const e of eps) {
  const ms = await q<any>(`select direction, text from messages where conversation_id=$1 and created_at <= $2
     and created_at > $2::timestamptz - interval '12 hours' order by created_at`, [e.conversation_id, e.created_at]);
  const txt = norm(ms.map(m=>m.text).join('\n'));
  const cats = new Set<string>();
  for (const p of prods) if (txt.includes(norm(p.name))) cats.add(p.category);
  const fecha = cats.has('tortas') || cats.has('desayunos');
  const esCurso = /curso|taller|inscrip/.test(txt);
  const esRetiro = /\bretir|paso a busc|lo busco|retiro\b/.test(txt);
  const esUber = /uber|cabify|didi|moto/.test(txt);
  const esCadete = /cadete|nuestro envio|envio nuestro|se lo llevamos/.test(txt);
  // hora explicita mencionada
  const tieneHora = /\b\d{1,2}\s*(?:[:.]\d{2})?\s*(?:hs|horas|hrs)\b|\ba las \d{1,2}|\bentre las? \d{1,2}|\d{1,2}\s*(?:a|y)\s*\d{1,2}\s*(?:hs|horas)?/.test(txt);
  if (fecha) necesitaFecha++;
  if (esCurso) curso++;
  if (esRetiro && !esUber && !esCadete) { retiro++; if (!tieneHora) retiroSinHora++; }
  if (esCadete && !esUber) cadete++;
  if (esUber) uber++;
  if (!cats.size) ningunProducto++;
  detalle.push(`${String(e.created_at).slice(4,21)} cats=[${[...cats].join(',')}] fecha?=${fecha} retiro=${esRetiro} uber=${esUber} cadete=${esCadete} hora=${tieneHora} curso=${esCurso}`);
}
console.log('total perdidas con comprobante:', eps.length);
console.log('necesitan FECHA obligatoria (torta/desayuno en la charla):', necesitaFecha);
console.log('sin ningun producto del catalogo nombrado:', ningunProducto);
console.log('curso/inscripcion:', curso);
console.log('retiro puro:', retiro, ' de esos SIN hora en la charla:', retiroSinHora);
console.log('cadete:', cadete, ' uber:', uber);
console.log('---');
for (const d of detalle) console.log(d);
await closeDb();
