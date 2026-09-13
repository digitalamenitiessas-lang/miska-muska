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
  const t = norm(texto);
  const ocup = new Array(t.length).fill(false);
  const out: Array<{ id: string; qty: number; pos: number }> = [];
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
        out.push({ id: p.id, qty, pos: i });
      }
      i = t.indexOf(p.n, i + 1);
    }
  }
  return out.sort((a, b) => a.pos - b.pos);
}

/** Solo montos anunciados COMO total: "total: $X", "son $X en total", "el total es $X". */
function totalesDichos(texto: string): number[] {
  const t = norm(texto);
  const out: number[] = [];
  for (const m of t.matchAll(/total[^0-9$]{0,20}\$\s?(\d[\d.]*)/g)) out.push(Number(m[1].replace(/\./g, '')));
  for (const m of t.matchAll(/\$\s?(\d[\d.]*)[^0-9$]{0,12}en total/g)) out.push(Number(m[1].replace(/\./g, '')));
  return out.filter((v) => Number.isFinite(v) && v >= 1000);
}

const casos = await q<any>(`
  with alias as (
    select m.conversation_id, m.created_at,
           row_number() over (partition by m.conversation_id,
             (m.created_at at time zone 'America/Argentina/Tucuman')::date order by m.created_at) rn
    from messages m
    where m.direction='out' and m.author='bot' and lower(m.text) like '%miskapedidos%'
  )
  select a.conversation_id, a.created_at as alias_at, o.number, o.items, o.total
  from alias a
  join lateral (
    select * from orders o2 where o2.conversation_id=a.conversation_id and o2.created_by='bot'
      and abs(extract(epoch from (o2.created_at - a.created_at))) < 3600
    order by abs(extract(epoch from (o2.created_at - a.created_at))) limit 1) o on true
  where a.rn=1 and a.created_at > now() - interval '20 days'
`);

let arma = 0, exacto = 0, mal = 0, nada = 0;
const malos: string[] = [];
for (const c of casos) {
  const prev = await q<any>(
    `select text from messages where conversation_id=$1 and direction='out' and content_kind='text'
     order by created_at desc limit 15`.replace('order by', 'and created_at <= $2 order by'),
    [c.conversation_id, c.alias_at],
  );
  let elegido: { ag: Map<string, number>; total: number; texto: string } | null = null;
  for (const m of prev) {
    const tot = totalesDichos(m.text);
    if (!tot.length) continue;
    const its = itemsDe(m.text);
    if (!its.length) continue;
    const ag = new Map<string, number>();
    for (const i of its) ag.set(i.id, (ag.get(i.id) ?? 0) + i.qty);
    const suma = [...ag].reduce((s, [k, v]) => s + v * byId.get(k)!.price, 0);
    if (tot.includes(suma)) { elegido = { ag, total: suma, texto: m.text }; break; }
  }
  const real = new Map<string, number>();
  let aMedida = false;
  for (const i of c.items as any[]) {
    if (i.productId) real.set(i.productId, (real.get(i.productId) ?? 0) + i.quantity); else aMedida = true;
  }
  if (!elegido) { nada++; continue; }
  arma++;
  const ok = !aMedida && elegido.ag.size === real.size && [...real].every(([k, v]) => elegido!.ag.get(k) === v)
    && elegido.total === Number(c.total);
  if (ok) exacto++;
  else {
    mal++;
    if (malos.length < 6) malos.push(
      `#${c.number} REAL $${c.total}: ${(c.items as any[]).map((i) => `${i.quantity}x ${i.description}`).join(' | ')}\n` +
      `      BORRADOR $${elegido.total}: ${[...elegido.ag].map(([k, v]) => `${v}x ${byId.get(k)!.name}`).join(' | ')}\n` +
      `      texto: "${String(elegido.texto).replace(/\n/g, ' ⏎ ').slice(0, 190)}"`);
  }
}
console.log(`VARIANTE ESTRICTA (solo mensajes que anuncian un TOTAL y la cuenta cierra)`);
console.log(`  casos: ${casos.length}`);
console.log(`  arma borrador: ${arma} (${Math.round(100 * arma / casos.length)}%)`);
console.log(`  exacto       : ${exacto} (${Math.round(100 * exacto / casos.length)}% de todos)`);
console.log(`  MAL          : ${mal}`);
console.log(`  no arma nada : ${nada} (${Math.round(100 * nada / casos.length)}%)`);
console.log(`  precision cuando arma: ${Math.round(100 * exacto / Math.max(1, arma))}%`);
console.log('\n--- errores ---');
for (const m of malos) console.log('  ' + m);
await closeDb();
