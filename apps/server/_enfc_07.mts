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
  return out;
}
function totalesDichos(texto: string): number[] {
  const t = norm(texto);
  const out: number[] = [];
  for (const m of t.matchAll(/total[^0-9$]{0,20}\$\s?(\d[\d.]*)/g)) out.push(Number(m[1].replace(/\./g, '')));
  for (const m of t.matchAll(/\$\s?(\d[\d.]*)[^0-9$]{0,12}en total/g)) out.push(Number(m[1].replace(/\./g, '')));
  return out.filter((v) => Number.isFinite(v) && v >= 1000);
}
function montosTodos(texto: string): number[] {
  const out: number[] = [];
  for (const m of norm(texto).matchAll(/\$\s?(\d[\d.]*)/g)) {
    const v = Number(m[1].replace(/\./g, ''));
    if (Number.isFinite(v) && v >= 1000) out.push(v);
  }
  return out;
}

/* LA POBLACION QUE IMPORTA: alias del bot, el bot NO cargo, lo cargo una PERSONA. */
const casos = await q<any>(`
  with alias as (
    select m.conversation_id, m.created_at,
           row_number() over (partition by m.conversation_id,
             (m.created_at at time zone 'America/Argentina/Tucuman')::date order by m.created_at) rn
    from messages m
    where m.direction='out' and lower(m.text) like '%miskapedidos%'
  )
  select a.conversation_id, a.created_at as alias_at, o.number, o.items, o.total, o.created_by
  from alias a
  join lateral (
    select * from orders o2 where o2.conversation_id=a.conversation_id and o2.created_by='human'
      and o2.created_at between a.created_at - interval '2 hours' and a.created_at + interval '6 hours'
    order by abs(extract(epoch from (o2.created_at - a.created_at))) limit 1) o on true
  where a.rn=1
    and not exists (select 1 from orders ob where ob.conversation_id=a.conversation_id
                    and ob.created_by='bot'
                    and abs(extract(epoch from (ob.created_at - a.created_at))) < 3600)
  order by a.created_at desc
`);
console.log(`POBLACION OBJETIVO: ${casos.length} charlas con alias donde el bot NO cargo y una persona SI\n`);

for (const modo of ['estricto', 'flojo'] as const) {
  let arma = 0, exacto = 0, mal = 0, nada = 0;
  const malos: string[] = []; const bien: string[] = [];
  for (const c of casos) {
    const prev = await q<any>(
      `select text from messages where conversation_id=$1 and direction='out' and content_kind='text'
         and created_at <= $2 order by created_at desc limit 15`,
      [c.conversation_id, c.alias_at],
    );
    let el: { ag: Map<string, number>; total: number; texto: string } | null = null;
    for (const m of prev) {
      const tot = modo === 'estricto' ? totalesDichos(m.text) : montosTodos(m.text);
      if (!tot.length) continue;
      const its = itemsDe(m.text);
      if (!its.length) continue;
      const ag = new Map<string, number>();
      for (const i of its) ag.set(i.id, (ag.get(i.id) ?? 0) + i.qty);
      const suma = [...ag].reduce((s, [k, v]) => s + v * byId.get(k)!.price, 0);
      if (tot.includes(suma)) { el = { ag, total: suma, texto: m.text }; break; }
    }
    const real = new Map<string, number>();
    let aMedida = false;
    for (const i of c.items as any[]) {
      if (i.productId) real.set(i.productId, (real.get(i.productId) ?? 0) + i.quantity); else aMedida = true;
    }
    if (!el) { nada++; continue; }
    arma++;
    const ok = !aMedida && el.ag.size === real.size && [...real].every(([k, v]) => el!.ag.get(k) === v)
      && el.total === Number(c.total);
    if (ok) { exacto++; if (bien.length < 3) bien.push(`#${c.number} $${c.total}`); }
    else {
      mal++;
      if (malos.length < 6 && modo === 'estricto') malos.push(
        `#${c.number} REAL $${c.total}: ${(c.items as any[]).map((i) => `${i.quantity}x ${i.description}`).join(' | ')}\n` +
        `      BORRADOR $${el.total}: ${[...el.ag].map(([k, v]) => `${v}x ${byId.get(k)!.name}`).join(' | ')}`);
    }
  }
  console.log(`[${modo}] arma ${arma}/${casos.length} (${Math.round(100 * arma / casos.length)}%) · exacto ${exacto} · MAL ${mal} · no arma ${nada}`);
  console.log(`         precision cuando arma: ${Math.round(100 * exacto / Math.max(1, arma))}%`);
  if (modo === 'estricto') for (const m of malos) console.log('  ' + m);
}
await closeDb();
