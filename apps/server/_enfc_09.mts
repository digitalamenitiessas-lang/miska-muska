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

const huerfanas = await q<any>(`${ALIAS}
  select a.conversation_id, a.created_at as alias_at from alias a
  where a.rn=1 and not exists (select 1 from orders o where o.conversation_id=a.conversation_id
    and o.created_at between a.created_at - interval '2 hours' and a.created_at + interval '6 hours')
  order by a.created_at desc`);

/* TECHO del enfoque: cuantas de estas charlas siquiera NOMBRAN un producto del catalogo */
let conNombre = 0, conNombreYPrecio = 0, cerradasPorPersona = 0;
for (const c of huerfanas) {
  const prev = await q<any>(
    `select text, author from messages where conversation_id=$1 and direction='out' and content_kind='text'
       and created_at <= $2 order by created_at desc limit 15`, [c.conversation_id, c.alias_at]);
  const t = norm(prev.map((r: any) => r.text).join(' '));
  const hay = cat.filter((p: any) => t.includes(p.n));
  if (hay.length) conNombre++;
  if (hay.length && /\$\s?\d/.test(t)) conNombreYPrecio++;
  if (prev.some((r: any) => r.author === 'human')) cerradasPorPersona++;
}
console.log(`HUERFANAS (alias y ningun pedido): ${huerfanas.length}`);
console.log(`  nombran algun producto del catalogo en los 15 salientes previos: ${conNombre} (${Math.round(100 * conNombre / huerfanas.length)}%)`);
console.log(`  ...y ademas hay un $ en esos mensajes: ${conNombreYPrecio}`);
console.log(`  una PERSONA escribio en esos 15 mensajes: ${cerradasPorPersona} (${Math.round(100 * cerradasPorPersona / huerfanas.length)}%)`);

console.log('\n--- 6 huerfanas, texto crudo ---');
for (const c of huerfanas.slice(0, 6)) {
  const prev = await q<any>(
    `select direction, author, text from messages where conversation_id=$1 and content_kind='text'
       and created_at <= $2 order by created_at desc limit 7`, [c.conversation_id, c.alias_at]);
  console.log('\n  ===== charla ' + c.conversation_id.slice(-6));
  for (const m of prev.reverse()) {
    const quien = m.direction === 'in' ? 'CLIENTE' : m.author === 'human' ? 'PERSONA' : 'BOT    ';
    console.log(`    ${quien}: ${String(m.text).replace(/\n/g, ' ⏎ ').slice(0, 230)}`);
  }
}
await closeDb();
