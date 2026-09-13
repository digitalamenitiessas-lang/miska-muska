import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const st = await q<any>(`select value->>'transferAlias' a, value->>'transferAliasCursos' c from settings where key='bot'`);
console.log('ALIAS:', JSON.stringify(st));
await closeDb();
