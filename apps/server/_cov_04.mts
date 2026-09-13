import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const TZ = 'America/Argentina/Tucuman';
/*
  Disparo simulado: mensaje saliente del bot con el alias de pedidos, en cuya
  charla NO hay ninguna fila de orders anterior al mensaje que estuviera VIGENTE
  en ese momento. Vigente ~ (no entregado/cancelado) OR creado el mismo dia local
  que el mensaje. (aprox: el status es el ACTUAL, no el historico)
*/
const r = await q<any>(`
with alias as (
  select m.id, m.conversation_id cid, m.created_at ts, m.text,
         (m.created_at at time zone '${TZ}')::date dia
  from messages m
  where m.direction='out' and m.author='bot' and m.text ilike '%miskapedidos%'
)
select a.dia,
       count(*) total,
       count(*) filter (where not exists (
          select 1 from orders o
          where o.conversation_id=a.cid and o.created_at < a.ts
            and o.status <> 'cancelado'
            and (o.status <> 'entregado'
                 or (o.created_at at time zone '${TZ}')::date = (a.ts at time zone '${TZ}')::date)
       )) disparos
from alias a group by 1 order by 1 desc`);
console.table(r);
const tot = r.reduce((s:any,x:any)=>s+Number(x.disparos),0);
console.log('disparos totales', tot, 'en', r.length, 'dias');
console.log('ult 7 dias', r.slice(0,7).map((x:any)=>x.disparos).join('+'), '=', r.slice(0,7).reduce((s:any,x:any)=>s+Number(x.disparos),0));
await closeDb();
