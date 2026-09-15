/**
 * Deja el corte de facturación en los ajustes.
 *
 * Se usa una vez: el local pagó el consumo hasta cierto momento y a partir de
 * ahí empieza a contar lo que se factura después. De ahí en más el corte se
 * mueve desde Ajustes, o se borra y vuelve a ser mes calendario.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/poner-corte-de-cobro.mts 2026-09-15T15:35:09Z
 *   npx tsx --env-file=../../.env.produccion scripts/poner-corte-de-cobro.mts --borrar
 */
import { openDb, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

const arg = process.argv[2];
if (!arg) {
  console.error('  Falta la fecha ISO del corte, o --borrar.');
  process.exit(1);
}
const corte = arg === '--borrar' ? '' : new Date(arg).toISOString();
if (arg !== '--borrar' && Number.isNaN(Date.parse(arg))) {
  console.error(`  "${arg}" no es una fecha que pueda leer.`);
  process.exit(1);
}

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const repos = createRepositories();

const antes = await repos.settings.read();
console.log(`\n  corte anterior : ${antes.cobroDesde || '(ninguno, mes calendario)'}`);

const despues = await repos.settings.write({ cobroDesde: corte });
console.log(`  corte nuevo    : ${despues.cobroDesde || '(ninguno, mes calendario)'}`);

const cuenta = await repos.metrics.facturacion(despues.cobroDesde);
console.log(`\n  Para cobrar desde ${cuenta.desde}:`);
console.log(`    USD ${cuenta.costoUsd.toFixed(4)} · ${cuenta.turnos} turnos`);
console.log(`    ${cuenta.arrancoElMes ? 'es el mes calendario' : 'arranca en el corte'}\n`);

await closeDb();
