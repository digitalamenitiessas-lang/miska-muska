import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const r = await q<any>(`select created_by, delivery_mode, count(*) n, count(*) filter (where delivery_time is null) sin_hora
 from orders where created_at > '2026-09-01' group by 1,2 order by 1,2`);
for (const x of r) console.log(x.created_by, x.delivery_mode, 'n='+x.n, 'sin_hora='+x.sin_hora);
// categorias mas vendidas: cuantos pedidos llevan al menos un item de categoria tortas o desayunos
const c = await q<any>(`
 select count(*) n,
  count(*) filter (where exists (select 1 from jsonb_array_elements(o.items) it join products p on p.id = it->>'productId' where p.category ilike '%torta%' and p.category not ilike '%mini%')) con_torta,
  count(*) filter (where exists (select 1 from jsonb_array_elements(o.items) it join products p on p.id = it->>'productId' where p.category='desayunos')) con_desayuno
 from orders o where o.created_at > '2026-09-06' and o.created_at < '2026-09-13'`);
console.log('pedidos semana', JSON.stringify(c));
// contactos sin telefono
const t = await q<any>(`select count(*) n, count(*) filter (where phone is null or phone='') sin_tel from contacts`);
console.log('contactos', JSON.stringify(t));
await closeDb();
