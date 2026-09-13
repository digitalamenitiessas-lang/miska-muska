import { openDb, q, closeDb } from './src/core/store/db.js';
import { nombreDeWhatsApp } from './src/core/policies/rules.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const TZ='America/Argentina/Tucuman';
const r = await q<any>(`
with alias as (
  select m.id, m.conversation_id cid, m.created_at ts, m.text
  from messages m where m.direction='out' and m.author='bot' and m.text ilike '%miskapedidos%'
    and m.created_at > now() - interval '7 days'
)
select a.cid, a.ts, a.text, c.display_name, c.full_name,
   (select o.created_by from orders o where o.conversation_id=a.cid
      and o.created_at >= a.ts - interval '2 minutes' and o.created_at < a.ts + interval '6 hours'
      order by o.created_at limit 1) carga
from alias a join conversations v on v.id=a.cid join contacts c on c.id=v.contact_id
where not exists (select 1 from orders o where o.conversation_id=a.cid and o.created_at < a.ts
    and o.status<>'cancelado'
    and (o.status<>'entregado' or (o.created_at at time zone '${TZ}')::date=(a.ts at time zone '${TZ}')::date))`);
let waOk=0, sinWa=0;
let conTotal=0, cursos=0, senia=0;
for (const x of r) {
  const n = nombreDeWhatsApp(x.display_name);
  if (n?.pareceCompleto) waOk++; else sinWa++;
  const t = String(x.text);
  if (/total|abonar|transferir|seña|senia|saldo/i.test(t) && /\$\s?[\d.]+/.test(t)) conTotal++;
  if (/curso/i.test(t)) cursos++;
  if (/seña|senia|saldo/i.test(t)) senia++;
}
console.log('disparos 7d:', r.length);
console.log('perfil WA con 2+ palabras (pareceCompleto):', waOk, '=', Math.round(waOk/r.length*100)+'%');
console.log('sin nombre usable del perfil:', sinWa);
console.log('texto con total/monto:', conTotal, '=', Math.round(conTotal/r.length*100)+'%');
console.log('menciona curso:', cursos, '| menciona seña/saldo:', senia);
const porCarga: any = {};
for (const x of r) porCarga[x.carga ?? 'NADIE'] = (porCarga[x.carga ?? 'NADIE']??0)+1;
console.log('quien cargo despues:', porCarga);
await closeDb();
