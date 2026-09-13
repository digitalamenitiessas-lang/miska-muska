import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const norm = (s: string) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9$.\s]/g, ' ').replace(/\s+/g, ' ').trim();
const products = await q<any>(`select id,name,price from products`);
const cat = products.map((p: any) => ({ id: p.id, name: p.name, price: Number(p.price), n: norm(p.name) }))
  .filter((p: any) => p.n.length >= 4).sort((a: any, b: any) => b.n.length - a.n.length);

const ALIAS = `with alias as (select m.conversation_id, m.created_at,
  row_number() over (partition by m.conversation_id,
   (m.created_at at time zone 'America/Argentina/Tucuman')::date order by m.created_at) rn
  from messages m where m.direction='out' and lower(m.text) like '%miskapedidos%')`;

async function techo(titulo: string, sql: string, K: number) {
  const casos = await q<any>(sql);
  let todosNombrados = 0, ruidoTotal = 0, sinRuido = 0, aMedidaN = 0;
  for (const c of casos) {
    const prev = await q<any>(
      `select text from messages where conversation_id=$1 and direction='out' and content_kind='text'
        and created_at <= $2 order by created_at desc limit $3`, [c.conversation_id, c.alias_at, K]);
    const t = norm(prev.map((r: any) => r.text).join(' '));
    // matching sin solapamiento, nombres largos primero
    const ocup = new Array(t.length).fill(false);
    const vistos = new Set<string>();
    for (const p of cat) {
      let i = t.indexOf(p.n);
      while (i >= 0) {
        let libre = true;
        for (let k2 = i; k2 < i + p.n.length; k2++) if (ocup[k2]) { libre = false; break; }
        if (libre) { for (let k2 = i; k2 < i + p.n.length; k2++) ocup[k2] = true; vistos.add(p.id); }
        i = t.indexOf(p.n, i + 1);
      }
    }
    const real = new Set<string>();
    let aMedida = false;
    for (const i of c.items as any[]) { if (i.productId) real.add(i.productId); else aMedida = true; }
    if (aMedida) aMedidaN++;
    const cubre = !aMedida && real.size > 0 && [...real].every((r) => vistos.has(r));
    if (cubre) todosNombrados++;
    const ruido = [...vistos].filter((v) => !real.has(v)).length;
    ruidoTotal += ruido;
    if (cubre && ruido === 0) sinRuido++;
  }
  console.log(`${titulo} (K=${K} salientes) — ${casos.length} charlas`);
  console.log(`  el texto NOMBRA todos los productos del pedido : ${todosNombrados} (${Math.round(100 * todosNombrados / casos.length)}%)  <- techo de recall`);
  console.log(`  ...y ademas sin ningun producto de mas         : ${sinRuido} (${Math.round(100 * sinRuido / casos.length)}%)  <- techo real`);
  console.log(`  productos DE MAS nombrados, promedio por charla: ${(ruidoTotal / casos.length).toFixed(1)}`);
  console.log(`  pedidos con items a medida (sin producto_id)   : ${aMedidaN}`);
}

const A = `${ALIAS}
  select a.conversation_id, a.created_at as alias_at, o.items, o.total from alias a
  join lateral (select * from orders o2 where o2.conversation_id=a.conversation_id and o2.created_by='bot'
    and abs(extract(epoch from (o2.created_at-a.created_at)))<3600
    order by abs(extract(epoch from (o2.created_at-a.created_at))) limit 1) o on true
  where a.rn=1 and a.created_at > now() - interval '20 days'`;
const B = `${ALIAS}
  select a.conversation_id, a.created_at as alias_at, o.items, o.total from alias a
  join lateral (select * from orders o2 where o2.conversation_id=a.conversation_id and o2.created_by='human'
    and o2.created_at between a.created_at - interval '2 hours' and a.created_at + interval '6 hours'
    order by abs(extract(epoch from (o2.created_at-a.created_at))) limit 1) o on true
  where a.rn=1 and not exists (select 1 from orders ob where ob.conversation_id=a.conversation_id
    and ob.created_by='bot' and abs(extract(epoch from (ob.created_at-a.created_at)))<3600)`;

console.log('=== A. el bot SI cargo');
for (const K of [3, 8, 15]) await techo('  ', A, K);
console.log('\n=== B. lo cargo una persona (la poblacion a cubrir)');
for (const K of [3, 8, 15]) await techo('  ', B, K);
await closeDb();
