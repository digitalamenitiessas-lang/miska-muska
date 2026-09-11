/**
 * Sonnet contra Haiku, con los mismos números.
 *
 * Compara la franja horaria EQUIVALENTE de dos días, no el día entero: el bot
 * atiende distinto a las nueve de la mañana que a las ocho de la tarde, y
 * comparar un día completo contra medio día da cualquier cosa.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/comparar-modelo.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

/** Hasta qué hora de Tucumán hay datos hoy: la franja se corta ahí. */
const hasta = await q<{ h: number }>(
  `select coalesce(max(extract(hour from created_at at time zone $1)), 0)::int h
   from model_turns where (created_at at time zone $1)::date = (now() at time zone $1)::date`,
  [TIMEZONE],
);
const corte = hasta[0].h;

const franja = async (fecha: string) =>
  (
    await q<{
      modelo: string; n: number; v: number; usd: number; lat: number;
      callados: number; inp: number; out: number;
    }>(
      `select coalesce(model,'?') modelo, count(*)::int n,
              coalesce(avg(rounds),0)::float v,
              coalesce(sum(cost_usd),0)::float usd,
              coalesce(avg(latency_ms),0)::float lat,
              count(*) filter (where resultado='callado')::int callados,
              coalesce(avg(input_tokens),0)::float inp,
              coalesce(avg(output_tokens),0)::float out
       from model_turns
       where (created_at at time zone $1)::date = $2::date
         and extract(hour from created_at at time zone $1) <= $3
       group by model order by 2 desc`,
      [TIMEZONE, fecha, corte],
    )
  )[0];

const hoy = await franja(new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }));
const ayer = await franja(
  new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: TIMEZONE }),
);

console.log(`\n  === misma franja horaria, hasta las ${corte}:59 ===\n`);
if (!hoy || !ayer) {
  console.log('  Falta uno de los dos días.');
  await closeDb();
  process.exit(0);
}

const fila = (etiqueta: string, a: number, b: number, fmt: (n: number) => string) => {
  const dif = a > 0 ? Math.round(((b - a) / a) * 100) : 0;
  const signo = dif > 0 ? '+' : '';
  console.log(`  ${etiqueta.padEnd(22)} ${fmt(a).padStart(10)}  ${fmt(b).padStart(10)}   ${(signo + dif + '%').padStart(6)}`);
};
const n2 = (n: number) => n.toFixed(2);
const usd = (n: number) => '$' + n.toFixed(2);
const ent = (n: number) => String(Math.round(n));

console.log(`  ${''.padEnd(22)} ${ayer.modelo.replace('anthropic/claude-', '').padStart(10)}  ${hoy.modelo.replace('anthropic/claude-', '').padStart(10)}`);
console.log(`  ${'-'.repeat(54)}`);
fila('turnos', ayer.n, hoy.n, ent);
fila('gasto', ayer.usd, hoy.usd, usd);
fila('costo por turno', ayer.usd / ayer.n, hoy.usd / hoy.n, (n) => '$' + n.toFixed(4));
fila('vueltas por turno', ayer.v, hoy.v, n2);
fila('latencia (s)', ayer.lat / 1000, hoy.lat / 1000, n2);
fila('callados (%)', (ayer.callados / ayer.n) * 100, (hoy.callados / hoy.n) * 100, ent);
fila('tokens de salida', ayer.out, hoy.out, ent);

console.log(`\n  === proyección a un mes, al ritmo de cada uno ===\n`);
const dia = (f: typeof hoy) => (f.usd / f.n) * 950;
console.log(`  ${ayer.modelo.replace('anthropic/claude-', '')}: ${usd(dia(ayer))}/día · ${usd(dia(ayer) * 30)}/mes`);
console.log(`  ${hoy.modelo.replace('anthropic/claude-', '')}: ${usd(dia(hoy))}/día · ${usd(dia(hoy) * 30)}/mes`);
console.log(`  (a 950 turnos por día, que es lo que viene dando)`);

await closeDb();
