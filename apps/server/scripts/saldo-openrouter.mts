/**
 * Cuánta plata queda en la cuenta de OpenRouter.
 *
 * Existe porque la pregunta vuelve —"¿cuánto queda?"— y la respuesta vive en un
 * lugar al que no se entra desde el panel. Con el gasto diario que ya medimos,
 * de acá sale también para cuántos días alcanza.
 *
 * La clave NO se imprime ni se loguea: se lee del entorno, viaja en el header y
 * nada más. Lo único que sale por pantalla son números.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/saldo-openrouter.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error('\n  No hay OPENROUTER_API_KEY en el entorno.\n');
  process.exit(1);
}
const BASE = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

const pedir = async (ruta: string): Promise<Record<string, unknown> | null> => {
  const res = await fetch(`${BASE}${ruta}`, {
    headers: { authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) {
    console.error(`  ${ruta} → HTTP ${res.status}`);
    return null;
  }
  const json = (await res.json()) as { data?: Record<string, unknown> };
  return json.data ?? null;
};

const usd = (n: number) => '$' + n.toFixed(2);

const creditos = await pedir('/credits');
const clave = await pedir('/auth/key');

console.log('\n  ═══ LA CUENTA DE OPENROUTER ═══\n');

let saldo: number | null = null;

if (creditos) {
  const cargado = Number(creditos.total_credits ?? 0);
  const gastado = Number(creditos.total_usage ?? 0);
  saldo = cargado - gastado;
  console.log(`  cargado en total   ${usd(cargado).padStart(10)}`);
  console.log(`  gastado en total   ${usd(gastado).padStart(10)}`);
  console.log(`  ${''.padEnd(19)}${'──────────'.padStart(10)}`);
  console.log(`  QUEDA              ${usd(saldo).padStart(10)}`);
}

if (clave) {
  const limite = clave.limit === null || clave.limit === undefined ? null : Number(clave.limit);
  console.log(`\n  tope de esta clave : ${limite === null ? 'sin tope propio' : usd(limite)}`);
  if (limite !== null) {
    const usadoClave = Number(clave.usage ?? 0);
    console.log(`  usado por la clave : ${usd(usadoClave)}`);
    const restaClave = limite - usadoClave;
    // El tope de la clave manda si es más chico que el saldo de la cuenta.
    if (saldo === null || restaClave < saldo) saldo = restaClave;
  }
}

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

/*
  NUESTRO GASTO NO DEPENDE DE LA KEY, y por eso se muestra al lado.

  Lo de arriba lo dice OpenRouter, y OpenRouter solo conoce la cuenta de la key
  que está puesta HOY: cuando se rota, el gasto de la anterior deja de verse
  ahí. Lo de abajo sale de nuestras tablas, donde cada turno guarda su costo en
  el momento en que ocurre, así que sobrevive a cualquier cambio de clave.

  Son dos tablas porque el registro cambió en el camino: hasta el 09/09/2026 el
  costo viajaba pegado al mensaje saliente, y desde ahí lo lleva `model_turns`,
  que además cuenta los turnos en que el bot decide callarse —esos también se
  pagan y antes quedaban afuera—. El corte se hace por la fecha del primer
  `model_turns` para no sumar dos veces el solapamiento de septiembre.
*/
const [nuestro] = await q<{ viejo: string; nuevo: string; desde: string }>(
  `select round((select coalesce(sum(cost_usd),0) from messages
                  where created_at < (select min(created_at) from model_turns))::numeric, 2)::text viejo,
          round((select coalesce(sum(cost_usd),0) from model_turns)::numeric, 2)::text nuevo,
          to_char((select min(created_at) from model_turns) at time zone $1, 'DD/MM/YYYY') desde`,
  [TIMEZONE],
);
const viejo = Number(nuestro.viejo);
const nuevo = Number(nuestro.nuevo);

console.log('\n  ═══ NUESTRO REGISTRO (sobrevive a los cambios de clave) ═══\n');
console.log(`  hasta el ${nuestro.desde}   ${usd(viejo).padStart(10)}`);
console.log(`  desde el ${nuestro.desde}   ${usd(nuevo).padStart(10)}`);
console.log(`  ${''.padEnd(20)}${'──────────'.padStart(10)}`);
console.log(`  gastado en total    ${usd(viejo + nuevo).padStart(10)}`);

console.log('\n  por mes:');
for (const m of await q<{ mes: string; usd: string }>(
  `select to_char(created_at at time zone $1,'YYYY-MM') mes, sum(cost_usd)::text usd
     from model_turns group by 1 order by 1`,
  [TIMEZONE],
)) {
  console.log(`    ${m.mes}   ${usd(Number(m.usd)).padStart(10)}`);
}
const [gasto] = await q<{ usd: string; dias: string }>(
  `select coalesce(sum(cost_usd),0)::text usd,
          count(distinct (created_at at time zone 'America/Argentina/Tucuman')::date)::text dias
     from model_turns where created_at > now() - interval '7 days'`,
);
const porDia = Number(gasto.usd) / Math.max(Number(gasto.dias), 1);

console.log(`\n  ═══ PARA CUÁNTO ALCANZA ═══\n`);
console.log(`  gasto de los últimos ${gasto.dias} días : ${usd(Number(gasto.usd))}`);
console.log(`  promedio por día              : ${usd(porDia)}`);
if (saldo !== null && porDia > 0) {
  const dias = saldo / porDia;
  console.log(`  alcanza para                 : ${Math.floor(dias)} días`);
  const cuando = new Date(Date.now() + dias * 86_400_000);
  console.log(`  se quedaría sin saldo cerca del ${cuando.toLocaleDateString('es-AR')}`);
}
console.log('');

await closeDb();
