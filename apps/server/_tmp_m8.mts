import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const TZ='America/Argentina/Tucuman';
const d=(x:any)=>new Date(x).toLocaleDateString('en-CA',{timeZone:TZ});
const os = await q<any>(`select number, created_by, delivery_mode, delivery_date, created_at, total, items from orders where created_at>=now()-interval '14 days'`);
const dm:Record<string,number>={}; let futuro=0, hoy=0;
for(const o of os){dm[o.delivery_mode]=(dm[o.delivery_mode]??0)+1; if(d(o.delivery_date)!==d(o.created_at))futuro++; else hoy++;}
console.log('pedidos 14d:',os.length,'modalidades',JSON.stringify(dm));
console.log('delivery_date != dia de carga:',futuro,'(',(100*futuro/os.length).toFixed(0),'%)  mismo dia:',hoy);
const lat = await q<any>(`select percentile_disc(0.5) within group (order by latency_ms) p50,
 percentile_disc(0.9) within group (order by latency_ms) p90,
 percentile_disc(0.99) within group (order by latency_ms) p99, max(latency_ms) mx, count(*)::int n,
 avg(cost_usd)::numeric(10,5) costo
 from model_turns where created_at>=now()-interval '7 days'`);
console.log('latencia model_turns', JSON.stringify(lat));
const slow = await q<any>(`select count(*)::int n from model_turns where created_at>=now()-interval '7 days' and latency_ms>30000`);
console.log('turnos >30s en 7d:', JSON.stringify(slow));
const err = await q<any>(`select resultado, count(*)::int n from model_turns where created_at>=now()-interval '7 days' group by 1`);
console.log('resultados', JSON.stringify(err));
await closeDb();
