import { openDb, q, closeDb, TIMEZONE } from './src/core/store/db.js';
import { seEncargaConAnticipacion } from './src/core/policies/rules.js';

openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });

const prods = await q<any>(`select id, name, category, available_today, updated_at from products`);
const apagados = prods
  .filter((p: any) => !p.available_today && !seEncargaConAnticipacion(p.category))
  .map((p: any) => ({ id: p.id, name: p.name }));

console.log('=== pedidos de los ULTIMOS 7 DIAS con productos que HOY estan apagados (mostrador) ===');
const filas: any[] = [];
for (const p of apagados) {
  const r = await q<any>(
    `select count(*)::int pedidos,
            count(*) filter (where paid > 0)::int pagados,
            count(*) filter (where status='cancelado')::int cancelados, count(*) filter (where status='entregado')::int entregados,
            max(to_char(created_at at time zone $2,'DD/MM HH24:MI')) ultimo
       from orders
      where (created_at at time zone $2)::date >= (now() at time zone $2)::date - 6
        and items @> $1::jsonb`,
    [JSON.stringify([{ productId: p.id }]), TIMEZONE],
  );
  if (r[0].pedidos > 0) filas.push({ producto: p.name, ...r[0] });
}
console.table(filas);

console.log('\n=== los mismos productos, pedidos SOLO DE HOY (con el panel ya apagado) ===');
const hoy: any[] = [];
for (const p of apagados) {
  const r = await q<any>(
    `select count(*)::int pedidos, count(*) filter (where paid > 0)::int pagados, count(*) filter (where status='cancelado')::int cancelados, count(*) filter (where status='entregado')::int entregados
       from orders
      where (created_at at time zone $2)::date = (now() at time zone $2)::date
        and items @> $1::jsonb`,
    [JSON.stringify([{ productId: p.id }]), TIMEZONE],
  );
  if (r[0].pedidos > 0) hoy.push({ producto: p.name, ...r[0] });
}
console.table(hoy);

console.log('\n=== estado de la charla de la devolucion (12/09 18:13) ===');
const conv = await q<any>(
  `select id from conversations where id like 'conv_k1cke2kiqs8te%'`,
);
const cid = conv[0]?.id;
console.log('conversation:', cid);
const ords = await q<any>(
  `select number, created_by, paid, status, total, to_char(created_at at time zone $2,'DD/MM HH24:MI') cuando, items
     from orders where conversation_id=$1 order by created_at`,
  [cid, TIMEZONE],
);
console.log('pedidos en esa charla:', JSON.stringify(ords, null, 1).slice(0, 1200));

const tl = await q<any>(
  `select author, direction, to_char(created_at at time zone $2,'DD/MM HH24:MI') cuando, left(replace(text, chr(10), ' '),150) txt
     from messages where conversation_id=$1
       and created_at between (timestamp '2026-09-12 20:40' at time zone $2) and (timestamp '2026-09-13 01:00' at time zone $2)
     order by created_at`,
  [cid, TIMEZONE],
);
for (const m of tl) console.log(`${m.cuando} ${m.direction}/${m.author}: ${m.txt}`);
await closeDb();
