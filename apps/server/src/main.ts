/** Punto de entrada: cablea las piezas y arranca. */

import { assertConfig, config } from './config.js';
import { closeDb, migrate, openDb } from './core/store/db.js';
import { createRepositories } from './core/store/repositories.js';
import { seed } from './core/store/seed.js';
import { Pipeline } from './core/pipeline/index.js';
import { iniciarAvisos } from './core/notify/push.js';
import { bus, log } from './core/events/bus.js';
import { ChannelRegistry } from './channels/registry.js';
import { buildServer } from './api/server.js';

async function main(): Promise<void> {
  assertConfig();

  openDb({
    connectionString: config.database.url,
    password: config.database.password,
    max: config.database.poolMax,
    ssl: config.database.ssl,
  });

  const applied = await migrate();
  if (applied.length) log('info', `Migraciones aplicadas: ${applied.join(', ')}`);

  const repos = createRepositories();

  // Idempotente: carga catálogo y mensajes rápidos si faltan, sin pisar la
  // disponibilidad que el local haya marcado hoy.
  await seed();

  const channels = new ChannelRegistry();
  // Inversión de dependencia: el pipeline no conoce el registro, solo resuelve.
  const pipeline = new Pipeline(repos, (channel) => channels.get(channel));

  const app = await buildServer({ repos, pipeline, channels });
  await app.listen({ port: config.port, host: config.host });

  await channels.startAll((message) => pipeline.handleInbound(message));

  /*
    Los avisos al celular. Se enganchan al bus, así que basta con arrancarlos una
    vez: no hay que tocarlos desde ningún otro lado.
  */
  await iniciarAvisos(repos);

  /*
    Los adjuntos que mandan los clientes vencen. Se limpia al arrancar y una vez
    por día: sin esto, cada comprobante que entra se queda para siempre en una
    base que es chica, y el problema recién se ve el día que no entra nada más.

    `unref()` para que un timer de veinticuatro horas no le impida al proceso
    terminar cuando systemd le manda la señal de apagado.
  */
  void pipeline.purgarAdjuntosViejos();
  setInterval(() => void pipeline.purgarAdjuntosViejos(), 24 * 60 * 60 * 1000).unref();

  const health = await channels.healthAll();
  for (const entry of health) {
    bus.emit({ type: 'channel-status', channel: entry.channel, ok: entry.ok, detail: entry.detail });
  }

  const settings = await repos.settings.read();
  log('info', `Servidor escuchando en http://${config.host}:${config.port}`);
  log('info', `Base de datos: ${describeDatabase(config.database.url)}`);
  log('info', `Panel permitido desde: ${config.dashboardOrigins.join(', ')}`);
  log('info', `Modelo: ${settings.model} (esfuerzo ${settings.effort})`);
  for (const entry of health) {
    log(
      entry.ok ? 'info' : 'warn',
      `Canal ${entry.channel}: ${entry.ok ? 'ok' : 'inactivo'} — ${entry.detail ?? ''}`,
    );
  }
  if (!config.openrouter.apiKey) {
    log('warn', 'Sin OPENROUTER_API_KEY: el bot responde en modo prueba. Configurala en .env');
  }
  if (!config.adminToken) {
    log('warn', 'Sin ADMIN_TOKEN: la API de gestión está abierta. No dejes esto así en producción.');
  }

  const shutdown = async (signal: string) => {
    log('info', `Recibí ${signal}, cerrando…`);
    await channels.stopAll();
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

/** Muestra host y base sin filtrar la contraseña al log. */
function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return '(cadena de conexión inválida)';
  }
}

main().catch((err) => {
  console.error('No pude arrancar:', err instanceof Error ? err.message : err);
  process.exit(1);
});
