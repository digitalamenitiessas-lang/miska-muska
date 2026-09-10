/**
 * En qué se va la plata del modelo.
 *
 * Lee `model_turns`, que anota TODOS los turnos —los que contestan y los que
 * deciden callarse— con sus vueltas. Antes el costo viajaba pegado al mensaje
 * saliente, así que un turno sin mensaje era gratis para nuestras cuentas y
 * carísimo en la factura.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/costo.mts [dias]
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const dias = Number(process.argv[2] ?? 7);
const desde = `now() - interval '${dias} days'`;
const usd = (n: number) => '$' + n.toFixed(2);

const hay = await q<{ n: number }>(`select count(*)::int n from model_turns`, []);
if (!hay[0].n) {
  console.log('  Todavía no hay turnos registrados. La tabla se llena desde el próximo deploy.');
  await closeDb();
  process.exit(0);
}

console.log(`\n  === por día (${dias} días) ===\n`);
console.log('  día         turnos  vueltas   callados        USD   USD/turno');
for (const d of await q<{
  dia: string; t: number; v: number; callados: number; usd: number;
}>(
  `select to_char(created_at at time zone $1,'DD/MM Dy') dia, count(*)::int t,
          coalesce(avg(rounds),0)::float v,
          count(*) filter (where resultado <> 'respuesta')::int callados,
          coalesce(sum(cost_usd),0)::float usd
   from model_turns where created_at > ${desde}
   group by (created_at at time zone $1)::date, 1 order by min(created_at) desc`,
  [TIMEZONE],
)) {
  console.log(
    `  ${d.dia.padEnd(11)} ${String(d.t).padStart(5)}   ${d.v.toFixed(2).padStart(5)}   ` +
      `${String(d.callados).padStart(6)}  ${usd(d.usd).padStart(9)}   ${('$' + (d.usd / Math.max(d.t, 1)).toFixed(4)).padStart(8)}`,
  );
}

console.log(`\n  === lo que se paga sin mandar nada ===\n`);
const r = await q<{ res: string; n: number; usd: number; v: number }>(
  `select resultado res, count(*)::int n, coalesce(sum(cost_usd),0)::float usd,
          coalesce(avg(rounds),0)::float v
   from model_turns where created_at > ${desde} group by 1 order by 3 desc`,
  [],
);
const total = r.reduce((s, x) => s + x.usd, 0);
for (const x of r)
  console.log(
    `  ${x.res.padEnd(11)} ${String(x.n).padStart(5)} turnos · ${x.v.toFixed(2)} vueltas · ` +
      `${usd(x.usd).padStart(9)} (${Math.round((x.usd / total) * 100)}%)`,
  );

console.log(`\n  === por vueltas: donde se acumula ===\n`);
const v = await q<{ v: number; n: number; usd: number }>(
  `select least(rounds, 6) v, count(*)::int n, coalesce(sum(cost_usd),0)::float usd
   from model_turns where created_at > ${desde} group by 1 order by 1`,
  [],
);
const tv = v.reduce((s, x) => s + x.usd, 0);
const tn = v.reduce((s, x) => s + x.n, 0);
for (const x of v)
  console.log(
    `  ${x.v} vuelta(s)  ${String(x.n).padStart(5)} turnos (${String(Math.round((x.n / tn) * 100)).padStart(2)}%)  ` +
      `${usd(x.usd).padStart(9)} (${String(Math.round((x.usd / tv) * 100)).padStart(2)}%)`,
  );

console.log(`\n  === por intención ===\n`);
for (const x of await q<{ i: string; n: number; usd: number; v: number }>(
  `select coalesce(intent,'-') i, count(*)::int n, coalesce(sum(cost_usd),0)::float usd,
          coalesce(avg(rounds),0)::float v
   from model_turns where created_at > ${desde} group by 1 order by 3 desc limit 12`,
  [],
))
  console.log(
    `  ${x.i.padEnd(24)} ${String(x.n).padStart(5)} · ${x.v.toFixed(2)} vueltas · ${usd(x.usd).padStart(9)} (${Math.round((x.usd / total) * 100)}%)`,
  );

console.log(`\n  === lo que ve la contabilidad vieja, para comparar ===\n`);
const viejo = await q<{ usd: number; n: number }>(
  `select coalesce(sum(cost_usd),0)::float usd, count(*)::int n
   from messages where cost_usd is not null and created_at > ${desde}`,
  [],
);
console.log(`  mensajes con costo : ${viejo[0].n} · ${usd(viejo[0].usd)}`);
console.log(`  turnos de verdad   : ${tn} · ${usd(total)}`);
if (viejo[0].usd > 0)
  console.log(`  se estaba perdiendo: ${usd(total - viejo[0].usd)} (${Math.round((1 - viejo[0].usd / total) * 100)}%)`);

await closeDb();
