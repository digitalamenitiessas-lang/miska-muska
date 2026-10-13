/**
 * Carga la hora de apertura de los domingos en los ajustes.
 *
 * El valor por defecto vive en `DEFAULT_SETTINGS` y solo aplica a una
 * instalación nueva: los ajustes guardados ya existen y no tienen el campo,
 * así que sin esto `openHourDomingo` queda undefined y vuelve a los 8 de
 * siempre. Ver `horaDeApertura` y el domingo 11 de octubre.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/poner-horario-domingo.mts
 *   npx tsx --env-file=../../.env.produccion scripts/poner-horario-domingo.mts 15
 */
import { openDb, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';
import { horaDeApertura, isOutsideBusinessHours } from '../src/core/policies/rules.js';

const hora = Number(process.argv[2] ?? 14);
if (!Number.isInteger(hora) || hora < 0 || hora > 23) {
  console.error(`\n  "${process.argv[2]}" no es una hora del día.\n`);
  process.exit(1);
}

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const repos = createRepositories();

const antes = await repos.settings.read();
console.log(`\n  antes   : domingo abre ${antes.openHourDomingo ?? '(sin cargar, usa ' + antes.openHour + ')'}`);

const despues = await repos.settings.write({ openHourDomingo: hora });
console.log(`  después : domingo abre ${despues.openHourDomingo}`);

/* La comprobación que importa: el caso real que falló. */
const domingoAlas10 = new Date('2026-10-11T13:10:00Z');
console.log(`\n  Domingo 10:10 → abre a las ${horaDeApertura(despues, domingoAlas10)}`);
console.log(`  ¿el bot lo ve cerrado? ${isOutsideBusinessHours(despues, domingoAlas10) ? 'SÍ' : 'NO'}`);
console.log('\n  El texto de horarios no se toca: sigue siendo el que lee el cliente.');
console.log(`    ${despues.scheduleText}\n`);

await closeDb();
