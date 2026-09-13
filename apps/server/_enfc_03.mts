import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });

const norm = (s: string) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9$.,\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const products = await q<any>(`select id, name, price, category from products`);
type P = { id: string; name: string; price: number; category: string; n: string };
const cat: P[] = products
  .map((p: any) => ({ id: p.id, name: p.name, price: Number(p.price), category: p.category, n: norm(p.name) }))
  .filter((p: P) => p.n.length >= 4)
  // los nombres largos primero: "cookie oreo con nutella" gana sobre "cookie oreo"
  .sort((a: P, b: P) => b.n.length - a.n.length);

console.log(`catalogo: ${cat.length} productos con nombre >=4`);
const cortos = products.filter((p: any) => norm(p.name).length < 4).map((p: any) => p.name);
if (cortos.length) console.log('  (fuera por nombre corto):', cortos.join(', '));

/* ---------- EXTRACTOR: de texto del bot a items ---------- */
const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, media: 6, doce: 12 };

function extraer(texto: string): Array<{ id: string; name: string; qty: number; price: number; pos: number }> {
  const t = norm(texto);
  const ocupado = new Array(t.length).fill(false);
  const out: Array<{ id: string; name: string; qty: number; price: number; pos: number }> = [];
  for (const p of cat) {
    let i = t.indexOf(p.n);
    while (i >= 0) {
      let libre = true;
      for (let k = i; k < i + p.n.length; k++) if (ocupado[k]) { libre = false; break; }
      if (libre) {
        for (let k = i; k < i + p.n.length; k++) ocupado[k] = true;
        // cantidad: hasta 12 caracteres antes
        const antes = t.slice(Math.max(0, i - 14), i);
        let qty = 1;
        const mNum = antes.match(/(\d{1,2})\s*(x|unidades?|u)?\s*$/);
        if (mNum) qty = Number(mNum[1]);
        else {
          const mPal = antes.match(/\b([a-z]+)\s*$/);
          if (mPal && NUM[mPal[1]]) qty = NUM[mPal[1]];
        }
        if (!(qty >= 1 && qty <= 30)) qty = 1;
        out.push({ id: p.id, name: p.name, qty, price: p.price, pos: i });
      }
      i = t.indexOf(p.n, i + 1);
    }
  }
  return out.sort((a, b) => a.pos - b.pos);
}

/* ---------- GROUND TRUTH: charlas donde el bot SI cargo el pedido ---------- */
const casos = await q<any>(`
  with alias as (
    select m.conversation_id, m.id as msg_id, m.created_at,
           row_number() over (partition by m.conversation_id,
             (m.created_at at time zone 'America/Argentina/Tucuman')::date
             order by m.created_at) rn
    from messages m
    where m.direction='out' and m.author='bot' and lower(m.text) like '%miskapedidos%'
  )
  select a.conversation_id, a.msg_id, a.created_at as alias_at,
         o.number, o.items, o.total, o.created_at as order_at, o.delivery_mode
  from alias a
  join lateral (
    select * from orders o2
    where o2.conversation_id = a.conversation_id and o2.created_by='bot'
      and abs(extract(epoch from (o2.created_at - a.created_at))) < 3600
    order by abs(extract(epoch from (o2.created_at - a.created_at))) limit 1
  ) o on true
  where a.rn=1 and a.created_at > now() - interval '20 days'
  order by a.created_at desc
`);
console.log(`\ncharlas con alias Y pedido del bot (ground truth): ${casos.length}`);

for (const K of [1, 2, 3, 5]) {
  let exactos = 0, setOk = 0, qtyMal = 0, deMas = 0, deMenos = 0, totalOk = 0;
  const sobrantes: Record<string, number> = {};
  for (const c of casos) {
    const prev = await q<any>(
      `select text from messages where conversation_id=$1 and direction='out' and created_at <= $2
       order by created_at desc limit $3`,
      [c.conversation_id, c.alias_at, K],
    );
    const texto = prev.map((r: any) => r.text).reverse().join('\n');
    const ext = extraer(texto);
    const agrup = new Map<string, number>();
    for (const e of ext) agrup.set(e.id, (agrup.get(e.id) ?? 0) + e.qty);
    const real = new Map<string, number>();
    for (const i of c.items as any[]) if (i.productId) real.set(i.productId, (real.get(i.productId) ?? 0) + i.quantity);

    const mismoSet = real.size > 0 && agrup.size === real.size && [...real.keys()].every((k) => agrup.has(k));
    const mismasQty = mismoSet && [...real].every(([k, v]) => agrup.get(k) === v);
    if (mismoSet) setOk++;
    if (mismasQty) exactos++;
    else if (mismoSet) qtyMal++;
    for (const k of agrup.keys()) if (!real.has(k)) { deMas++; sobrantes[k] = (sobrantes[k] ?? 0) + 1; break; }
    for (const k of real.keys()) if (!agrup.has(k)) { deMenos++; break; }
    const tot = [...agrup].reduce((s, [k, v]) => s + v * (cat.find((p) => p.id === k)?.price ?? 0), 0);
    if (tot === Number(c.total)) totalOk++;
  }
  console.log(
    `K=${K}: set exacto ${setOk}/${casos.length} (${Math.round((100 * setOk) / casos.length)}%) · ` +
      `set+cantidades ${exactos} (${Math.round((100 * exactos) / casos.length)}%) · ` +
      `total exacto ${totalOk} · items de mas en ${deMas} · items de menos en ${deMenos}`,
  );
}
await closeDb();
