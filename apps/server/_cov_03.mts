import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const TZ = 'America/Argentina/Tucuman';
// 1. mensajes salientes con el alias de pedidos, por dia y por autor
const a = await q<any>(`
  select (created_at at time zone '${TZ}')::date dia, author, direction, count(*) n
  from messages
  where text ilike '%miskapedidos%'
  group by 1,2,3 order by 1 desc, 2`);
console.table(a);
await closeDb();
