/**
 * Aplica las migraciones pendientes y sale.
 *
 * El servidor ya las corre al arrancar, así que esto es para dos casos:
 *  - probar la conexión a Supabase sin levantar todo el bot
 *  - aplicar el esquema desde CI antes de un deploy
 */

import { closeDb, migrate, openDb } from '../src/core/store/db.js';
import { assertConfig, config } from '../src/config.js';

assertConfig();

openDb({
  connectionString: config.database.url,
  password: config.database.password,
  ssl: config.database.ssl,
});

try {
  const applied = await migrate();
  const host = new URL(config.database.url).host;
  if (applied.length) console.log(`Migraciones aplicadas en ${host}: ${applied.join(', ')}`);
  else console.log(`Sin migraciones pendientes en ${host}: el esquema ya está al día.`);
} catch (err) {
  console.error('Falló la migración:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
