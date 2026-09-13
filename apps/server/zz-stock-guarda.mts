import { openDb, q, closeDb, TIMEZONE } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const prods = await q<any>(`select id, name, category, available_today,
   to_char(updated_at at time zone $1,'YYYY-MM-DD HH24:MI') as upd from products order by updated_at desc`, [TIMEZONE]);
console.log('categorias:', [...new Set(prods.map((p:any)=>p.category))].join(' | '));
console.log('\nupdated_at de los 90 productos (mas reciente primero):');
for (const p of prods) console.log(`${p.upd}  ${p.available_today?'ON ':'OFF'}  ${p.category.padEnd(14)} ${p.name}`);
const existeLog = await q<any>(`select to_regclass('public.product_availability_log') as t`);
console.log('\nproduct_availability_log existe?', existeLog[0].t);
await closeDb();
