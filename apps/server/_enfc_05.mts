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
  const out: Array<{ id: string; qty: number; price: number; pos: number }> = [];
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
        out.push({ id: p.id, qty, price: p.price, pos: i });
      }
      i = t.indexOf(p.n, i + 1);
    }
  }
  return out.sort((a, b) => a.pos - b.pos);
}

/** Todos los montos que el texto nombra, para buscar el total. */
function montos(texto: string): number[] {
  const out: number[] = [];
  for (const m of norm(texto).matchAll(/\$\s?(\d[\d.]*)/g)) {
    const v = Number(m[1].replace(/\./g, ''));
    if (Number.isFinite(v) && v >= 1000) out.push(v);
  }
  return out;
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
  order by a.created_at desc
`);
console.log(`ground truth: ${casos.length} charlas (alias del bot + pedido cargado por el bot)\n`);

let conBorrador = 0, borradorExacto = 0, borradorSetOk = 0, borradorMal = 0, sinBorrador = 0;
const ejemplosMal: string[] = [];
const ejemplosBien: string[] = [];

for (const c of casos) {
  const prev = await q<any>(
    `select text, created_at from messages where conversation_id=$1 and direction='out'
       and content_kind='text' and created_at <= $2 order by created_at desc limit 15`,
    [c.conversation_id, c.alias_at],
  );

  /*
    Se recorre para atras y se elige el PRIMER mensaje del bot cuyo conjunto de
    items cierra contra un total que el mismo mensaje nombra. Esa es la unica
    señal de "esto es la cuenta y no la carta".
  */
  let elegido: { items: any[]; total: number; texto: string } | null = null;
  for (const m of prev) {
    const its = itemsDe(m.text);
    if (!its.length) continue;
    const agr = new Map<string, number>();
    for (const i of its) agr.set(i.id, (agr.get(i.id) ?? 0) + i.qty);
    const suma = [...agr].reduce((s, [k, v]) => s + v * (byId.get(k)!.price), 0);
    if (montos(m.text).includes(suma)) {
      elegido = { items: [...agr].map(([id, qty]) => ({ id, qty })), total: suma, texto: m.text };
      break;
    }
  }

  const real = new Map<string, number>();
  let aMedida = false;
  for (const i of c.items as any[]) {
    if (i.productId) real.set(i.productId, (real.get(i.productId) ?? 0) + i.quantity);
    else aMedida = true;
  }

  if (!elegido) { sinBorrador++; continue; }
  conBorrador++;
  const ag = new Map(elegido.items.map((i) => [i.id, i.qty]));
  const setOk = !aMedida && ag.size === real.size && [...real.keys()].every((k) => ag.has(k));
  const exacto = setOk && [...real].every(([k, v]) => ag.get(k) === v) && elegido.total === Number(c.total);
  if (exacto) { borradorExacto++; if (ejemplosBien.length < 4) ejemplosBien.push(`#${c.number} $${c.total} ← "${String(elegido.texto).replace(/\n/g, ' ⏎ ').slice(0, 150)}"`); }
  else if (setOk) borradorSetOk++;
  else {
    borradorMal++;
    if (ejemplosMal.length < 8) {
      ejemplosMal.push(
        `#${c.number} REAL $${c.total}: ${(c.items as any[]).map((i) => `${i.quantity}x ${i.description}`).join(' | ')}\n` +
        `      BORRADOR $${elegido.total}: ${elegido.items.map((i) => `${i.qty}x ${byId.get(i.id)!.name}`).join(' | ')}\n` +
        `      texto: "${String(elegido.texto).replace(/\n/g, ' ⏎ ').slice(0, 200)}"`,
      );
    }
  }
}

const pct = (n: number) => `${Math.round((100 * n) / casos.length)}%`;
console.log(`ARMA BORRADOR (la cuenta cierra contra un total dicho): ${conBorrador}  (${pct(conBorrador)})`);
console.log(`   exacto (items + cantidades + total): ${borradorExacto}  (${pct(borradorExacto)})`);
console.log(`   set ok pero cantidades/total mal   : ${borradorSetOk}`);
console.log(`   MAL (items distintos)              : ${borradorMal}`);
console.log(`NO ARMA NADA                          : ${sinBorrador}  (${pct(sinBorrador)})`);
console.log(`\nprecision del borrador cuando lo arma: ${Math.round((100 * borradorExacto) / Math.max(1, conBorrador))}%`);
console.log('\n--- aciertos ---');
for (const e of ejemplosBien) console.log('  ' + e);
console.log('\n--- errores ---');
for (const e of ejemplosMal) console.log('  ' + e);
await closeDb();
