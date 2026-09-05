import { openDb, q, closeDb } from '../src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const r = await q<{ t: string }>(
  `select text t from messages
   where direction='out' and author='human' and created_at > now() - interval '20 days'
     and length(text) between 3 and 200
   order by created_at desc limit 4000`, []);
const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const ESTA_LISTO = [
  /\b(ya |yaa )?(esta|estan|quedo|quedaron)\b[^.?!]{0,20}\blist[oa]s?\b/,
  /\blist[oa]s?\b[^.?!]{0,24}\bpara (retirar|buscar|que (pase|pases|lo retire|la retire))\b/,
  /\bya (lo|la|los|las) (podes|puede|pueden) (retirar|buscar|pasar a buscar)\b/,
  /\bya (te )?(lo|la|los|las) (entregamos|entregue|entregaron|dimos)\b/,
  /\b(pedi|pedi|manda|mandalo|mandale|puede venir el|que venga el)\b[^.?!]{0,20}\buber\b/,
  /\bpodes (pasar|venir)\b[^.?!]{0,20}\b(a )?(retirar|buscar|buscarlo|retirarlo)\b/,
];
const NO_ES = [
  /\?\s*$/,                       // una pregunta no confirma nada
  /\bmanana\b|\bpasado manana\b/, // para otro dia, no ahora
  /\bcuando (este|lo tengamos|salga)\b/,
  /\bapenas\b/,
  /\bno (esta|estan)\b/,
  /\bte aviso\b/,
];
const listo = (t: string) => { const p = plano(t); return !NO_ES.some((x) => x.test(p)) && ESTA_LISTO.some((x) => x.test(p)); };

const hits = r.filter((m) => listo(m.t));
console.log(`  sobre ${r.length} mensajes de personas del local`);
console.log(`  coinciden: ${hits.length} (${(hits.length / r.length * 100).toFixed(1)}%)\n`);
for (const h of hits) console.log(`    ${h.t.replace(/\n/g, ' / ').slice(0, 88)}`);

console.log('\n  === el caso que lo motivo ===');
for (const t of ['listo sofi para retirar!', 'ya esta listo tu pedido', 'pedi otro uber y le entregamos',
                 'me podes pasar tu direccion y nombre y apellido porfa', 'te esperamos mañana marilin',
                 'o en cuanto podes pasar?', 'te esperamos!', 'apenas este listo te aviso'])
  console.log(`    ${listo(t) ? 'LISTO ' : '  no  '} ${t}`);
await closeDb();
