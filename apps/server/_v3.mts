import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const s = await q<any>(`select value->>'transferAlias' a, value->>'transferHolder' h from settings where key='bot'`);
console.log('ALIAS=' + s[0].a + ' HOLDER=' + s[0].h);
const qr = await q<any>(`select key from quick_replies where body like '%{{alias}}%'`).catch(e=>[{key:'ERR '+e.message}]);
console.log('QR con alias: ' + qr.map((x:any)=>x.key).join(' | '));
await closeDb();
