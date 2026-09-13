import { openDb, q, closeDb, TIMEZONE } from './src/core/store/db.js';
import { seEncargaConAnticipacion } from './src/core/policies/rules.js';

openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });

const prods = await q<any>(`select id, name, category, available_today, updated_at from products`);
const apagados = prods
  .filter((p: any) => !p.available_today && !seEncargaConAnticipacion(p.category))
  .map((p: any) => ({ id: p.id, name: p.name, updated: p.updated_at }));

/*
  LA PRUEBA LIMPIA: pedidos creados DESPUES de que el producto quedo apagado.
  updated_at es el momento en que el producto llego al estado que tiene hoy, asi
  que todo lo posterior ocurrio con el panel ya apagado. Sin ambiguedad.
*/
console.log('=== pedidos creados CON EL PANEL YA APAGADO (created_at > updated_at del producto) ===');
const filas: any[] = [];
for (const p of apagados) {
  const r = await q<any>(
    `select count(*)::int pedidos,
            count(*) filter (where status='entregado')::int entregados,
            count(*) filter (where status='cancelado')::int cancelados,
            count(*) filter (where paid > 0)::int pagados,
            sum(total) filter (where status='entregado')::int plata_entregada
       from orders
      where created_at > $2 and items @> $1::jsonb`,
    [JSON.stringify([{ productId: p.id }]), p.updated],
  );
  if (r[0].pedidos > 0)
    filas.push({
      producto: p.name,
      apagadoDesde: new Date(p.updated).toLocaleString('es-AR', { timeZone: TIMEZONE }),
      ...r[0],
    });
}
console.table(filas);
const tot = filas.reduce((a, f) => a + f.pedidos, 0);
const ent = filas.reduce((a, f) => a + f.entregados, 0);
const plata = filas.reduce((a, f) => a + (f.plata_entregada ?? 0), 0);
console.log(`TOTAL: ${tot} pedidos tomados con el panel apagado, ${ent} ENTREGADOS sin problema, $${plata}`);

console.log('\n=== detalle de esos pedidos ===');
for (const p of apagados) {
  const r = await q<any>(
    `select number, status, paid, total, created_by,
            to_char(created_at at time zone $3,'DD/MM HH24:MI') cuando
       from orders where created_at > $2 and items @> $1::jsonb order by created_at`,
    [JSON.stringify([{ productId: p.id }]), p.updated, TIMEZONE],
  );
  for (const o of r)
    console.log(
      `  ${p.name} (apagado ${new Date(p.updated).toLocaleString('es-AR', { timeZone: TIMEZONE })}) -> pedido ${o.number} ${o.cuando} ${o.status} pagado=${o.paid} por=${o.created_by}`,
    );
}
await closeDb();
