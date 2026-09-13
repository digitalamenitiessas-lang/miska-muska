import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });

const s = await q<any>(`select value from settings where key='bot'`);
const v = s[0].value;
for (const k of Object.keys(v)) {
  if (/alias|holder|pedido|transfer|cadete|envio/i.test(k)) console.log(k, '=', JSON.stringify(v[k]));
}
await closeDb();
