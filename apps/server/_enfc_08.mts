import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });

const norm = (s: string) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9$.\s]/g, ' ').replace(/\s+/g, ' ').trim();
const products = await q<any>(`select id, name, price from products`);
type P = { id: string; name: string; price: number; n: string };
const cat: P[] = products.map((p: any) => ({ id: p.id, name: p.name, price: Number(p.price), n: norm(p.name) }))
  .filter((p: P) => p.n.length >= 4).sort((a: P, b: P) => b.n.length - a.n.length);
const byId = new Map(cat.map((p) => [p.id, p]));
const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, doce: 12 };
function itemsDe(texto: string) {
  const t = norm(texto); const ocup = new Array(t.length).fill(false);
  const out: Array<{ id: string; qty: number }> = [];
  for (const p of cat) {
    let i = t.indexOf(p.n);
    while (i >= 0) {
      let libre = true;
      for (let k = i; k < i + p.n.length; k++) if (ocup[k]) { libre = false; break; }
      if (libre) {
        for (let k = i; k < i + p.n.length; k++) ocup[k] = true;
        const antes = t.slice(Math.max(0, i - 14), i);
        let qty = 1;
        const mN = antes.match(/(\d{1,2})\s*(x|unidades?)?\s*$/);
        if (mN) qty = Number(mN[1]);
        else { const mP = antes.match(/\b([a-z]+)\s*$/); if (mP && NUM[mP[1]]) qty = NUM[mP[1]]; }
        if (!(qty >= 1 && qty <= 30)) qty = 1;
        out.push({ id: p.id, qty });
      }
      i = t.indexOf(p.n, i + 1);
    }
  }
  return out;
}
function totalesDichos(texto: string): number[] {
  const t = norm(texto); const out: number[] = [];
  for (const m of t.matchAll(/total[^0-9$]{0,20}\$\s?(\d[\d.]*)/g)) out.push(Number(m[1].replace(/\./g, '')));
  for (const m of t.matchAll(/\$\s?(\d[\d.]*)[^0-9$]{0,12}en total/g)) out.push(Number(m[1].replace(/\./g, '')));
  return out.filter((v) => Number.isFinite(v) && v >= 1000);
}
async function borrador(convId: string, aliasAt: string) {
  const prev = await q<any>(
    `select text from messages where conversation_id=$1 and direction='out' and content_kind='text'
       and created_at <= $2 order by created_at desc limit 15`, [convId, aliasAt]);
  for (const m of prev) {
    const tot = totalesDichos(m.text); if (!tot.length) continue;
    const its = itemsDe(m.text); if (!its.length) continue;
    const ag = new Map<string, number>();
    for (const i of its) ag.set(i.id, (ag.get(i.id) ?? 0) + i.qty);
    const suma = [...ag].reduce((s, [k, v]) => s + v * byId.get(k)!.price, 0);
    if (tot.includes(suma)) return { ag, total: suma, texto: m.text as string };
  }
  return null;
}

async function evaluar(titulo: string, sql: string) {
  const casos = await q<any>(sql);
  let arma = 0, totalOk = 0, totalMal = 0, nada = 0;
  const malos: string[] = [];
  for (const c of casos) {
    const b = await borrador(c.conversation_id, c.alias_at);
    if (!b) { nada++; continue; }
    arma++;
    if (b.total === Number(c.total)) totalOk++;
    else {
      totalMal++;
      if (malos.length < 8) malos.push(
        `#${c.number}: REAL $${c.total} (${(c.items as any[]).map((i) => `${i.quantity}x ${i.description}`).join(' | ')})` +
        ` → BORRADOR $${b.total} (${[...b.ag].map(([k, v]) => `${v}x ${byId.get(k)!.name}`).join(' | ')})`);
    }
  }
  console.log(`\n=== ${titulo} — ${casos.length} charlas`);
  console.log(`  arma borrador : ${arma} (${Math.round(100 * arma / Math.max(1, casos.length))}%)`);
  console.log(`  total CORRECTO: ${totalOk}`);
  console.log(`  total ERRADO  : ${totalMal}   <-- plata mal cobrada si nadie mira`);
  console.log(`  no arma nada  : ${nada} (${Math.round(100 * nada / Math.max(1, casos.length))}%)`);
  console.log(`  precision (por total) cuando arma: ${Math.round(100 * totalOk / Math.max(1, arma))}%`);
  for (const m of malos) console.log('    ' + m);
}

const ALIAS = `
  with alias as (
    select m.conversation_id, m.created_at,
           row_number() over (partition by m.conversation_id,
             (m.created_at at time zone 'America/Argentina/Tucuman')::date order by m.created_at) rn
    from messages m
    where m.direction='out' and lower(m.text) like '%miskapedidos%')`;

await evaluar('A. el bot SI cargo (ground truth del propio bot)', `${ALIAS}
  select a.conversation_id, a.created_at as alias_at, o.number, o.items, o.total from alias a
  join lateral (select * from orders o2 where o2.conversation_id=a.conversation_id and o2.created_by='bot'
    and abs(extract(epoch from (o2.created_at-a.created_at)))<3600
    order by abs(extract(epoch from (o2.created_at-a.created_at))) limit 1) o on true
  where a.rn=1 and a.created_at > now() - interval '20 days'`);

await evaluar('B. el bot NO cargo, lo cargo una PERSONA (la poblacion a cubrir)', `${ALIAS}
  select a.conversation_id, a.created_at as alias_at, o.number, o.items, o.total from alias a
  join lateral (select * from orders o2 where o2.conversation_id=a.conversation_id and o2.created_by='human'
    and o2.created_at between a.created_at - interval '2 hours' and a.created_at + interval '6 hours'
    order by abs(extract(epoch from (o2.created_at-a.created_at))) limit 1) o on true
  where a.rn=1 and not exists (select 1 from orders ob where ob.conversation_id=a.conversation_id
    and ob.created_by='bot' and abs(extract(epoch from (ob.created_at-a.created_at)))<3600)`);

/* C. ni el bot ni nadie: no hay ground truth, solo se mide si dispararia. */
const huerfanas = await q<any>(`${ALIAS}
  select a.conversation_id, a.created_at as alias_at,
    (a.created_at at time zone 'America/Argentina/Tucuman')::date dia from alias a
  where a.rn=1 and not exists (select 1 from orders o where o.conversation_id=a.conversation_id
    and o.created_at between a.created_at - interval '2 hours' and a.created_at + interval '6 hours')
  order by a.created_at desc`);
let armaH = 0;
for (const c of huerfanas) if (await borrador(c.conversation_id, c.alias_at)) armaH++;
console.log(`\n=== C. alias y NINGUN pedido en ningun lado — ${huerfanas.length} charlas (plata sin registrar)`);
console.log(`  arma borrador: ${armaH} (${Math.round(100 * armaH / Math.max(1, huerfanas.length))}%) — sin verdad contra que comparar`);

/* Cuantas veces por dia se dispara el mecanismo entero (todo mensaje con alias). */
const porDia = await q<any>(`${ALIAS}
  select (a.created_at at time zone 'America/Argentina/Tucuman')::date dia, count(*) n
  from alias a where a.rn=1 group by 1 order by 1 desc limit 10`);
console.log('\n=== disparos por dia (primer alias por charla y dia)');
for (const d of porDia) console.log(`  ${String(d.dia).slice(0, 15)} : ${d.n}`);
await closeDb();
