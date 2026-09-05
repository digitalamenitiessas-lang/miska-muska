import { openDb, q, closeDb } from '../src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const r = await q<{ t: string }>(
  `select text t from messages
   where direction='out' and author='human' and created_at > now() - interval '20 days'
     and length(text) between 3 and 160
   order by created_at desc limit 4000`, []);
const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const LISTO = [
  /\b(ya )?(esta|estan|quedo|quedaron) list[oa]s?\b/,
  /\bpodes (pasar|venir|retirar|buscarlo|mandar)\b/,
  /\b(ya )?(pod[ée]s|puede) (pasar|retirar|venir)\b/,
  /\blist[oa] para (retirar|buscar|que (pase|pases|lo retire))\b/,
  /\b(ya )?te (lo |la )?(espero|esperamos)\b/,
  /\bya (lo|la) (tenes|tiene|podes retirar)\b/,
  /\b(mandalo|manda|pedi|ped[ií])\b[^.?!]{0,18}\buber\b/,
  /\bya (sali[oó]|salio) (el|tu)\b/,
];
const hits = r.filter((m) => LISTO.some((re) => re.test(plano(m.t))));
console.log(`  sobre ${r.length} mensajes de personas del local\n  coinciden: ${hits.length}\n`);
for (const h of hits.slice(0, 30)) console.log(`    ${h.t.replace(/\n/g, ' / ').slice(0, 92)}`);
await closeDb();
