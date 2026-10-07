/**
 * Cierra el período que se va a facturar y arranca el contador de cero.
 *
 * POR QUÉ NO ALCANZA CON MOVER LA FECHA A MANO: entre leer cuánto hay para
 * cobrar y escribir el corte nuevo pasan segundos, y en esos segundos el bot
 * sigue contestando. Si el corte se pone en "ahora" después de haber leído el
 * total, esos turnos quedan afuera de las dos cuentas y no se cobran nunca.
 * Al revés —leer después de cortar— se cobrarían dos veces.
 *
 * Acá se elige UN instante, se calcula el total hasta ese instante y se deja
 * el contador nuevo arrancando exactamente ahí. Lo que entra después es del
 * período que viene.
 *
 * Es la misma lección del 1 de octubre, cuando lo que no se había cobrado
 * desapareció al cambiar el mes: la plata que no se cobró no se evapora, hay
 * que saber siempre de qué período es cada peso.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/cortar-para-facturar.mts
 *   npx tsx --env-file=../../.env.produccion scripts/cortar-para-facturar.mts --en-serio
 */
import { openDb, q, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

const enSerio = process.argv.includes('--en-serio');

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const repos = createRepositories();

const antes = await repos.settings.read();
const desde = antes.cobroDesde;
if (!desde) {
  console.error('\n  No hay corte anterior cargado. Revisalo en Ajustes antes de seguir.\n');
  await closeDb();
  process.exit(1);
}

/* El instante del corte. Uno solo, y se usa para las dos puntas. */
const corte = new Date().toISOString();

const [cuenta] = await q<any>(
  `SELECT COALESCE(SUM(cost_usd), 0) AS costo, COUNT(*) AS turnos,
          MIN(created_at) AS primero, MAX(created_at) AS ultimo
     FROM model_turns
    WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz`,
  [desde, corte],
);

const dias = (Date.parse(corte) - Date.parse(desde)) / 86_400_000;
const fmt = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Tucuman',
    /*
      hour12 FALSE a mano. Sin esto, Node formatea es-AR en doce horas Y se
      come el a.m./p.m.: el corte de las 14:25 se imprimio "02:25:44". En una
      fecha que va a una factura, doce horas de error no es un detalle.
    */
    hour12: false,
  });

console.log('\n  ╔══ PERÍODO QUE SE CIERRA ═══════════════════════════════');
console.log(`  ║  desde   ${fmt(desde)}`);
console.log(`  ║  hasta   ${fmt(corte)}`);
console.log(`  ║  son     ${dias.toFixed(1)} días`);
console.log('  ║');
console.log(`  ║  TURNOS  ${Number(cuenta.turnos).toLocaleString('es-AR')}`);
console.log(`  ║  A COBRAR  USD ${Number(cuenta.costo).toFixed(2)}`);
console.log('  ╚════════════════════════════════════════════════════════\n');

if (!enSerio) {
  console.log('  Esto fue solo la cuenta: NO se tocó nada.');
  console.log('  Para cerrarlo de verdad, volvé a correrlo con --en-serio\n');
  await closeDb();
  process.exit(0);
}

const despues = await repos.settings.write({ cobroDesde: corte });
const nuevo = await repos.metrics.facturacion(despues.cobroDesde);

console.log(`  Corte guardado: ${fmt(despues.cobroDesde)}`);
console.log(`  El contador arranca de nuevo en USD ${nuevo.costoUsd.toFixed(4)} (${nuevo.turnos} turnos).`);
console.log('  No hace falta deploy: el panel lee los ajustes en cada consulta.\n');

await closeDb();
