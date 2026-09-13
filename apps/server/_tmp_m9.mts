import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const r = await q<any>(`select intent, count(*)::int n from model_turns where created_at>=now()-interval '14 days' group by 1 order by n desc limit 12`);
console.log('intents', JSON.stringify(r));
const dup = await q<any>(`
 with t as (select conversation_id, date_trunc('day', created_at) d, count(*)::int n
            from model_turns where intent='crear_pedido' and created_at>=now()-interval '14 days'
            group by 1,2)
 select n as llamadas_en_el_dia, count(*)::int charlas from t group by 1 order by 1`);
console.log('crear_pedido por charla/dia', JSON.stringify(dup));
const at = await q<any>(`select left(attention_reason,40) r, count(*)::int n from conversations where attention_reason is not null group by 1 order by n desc limit 12`);
console.log('attention_reason actual', JSON.stringify(at));
const cl = await q<any>(`select left(attention_cleared_reason,40) r, count(*)::int n from conversations where attention_cleared_reason is not null group by 1 order by n desc limit 12`);
console.log('cleared reason', JSON.stringify(cl));
await closeDb();
