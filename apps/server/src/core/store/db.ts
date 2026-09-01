/**
 * Acceso a Postgres (Supabase en producción, un contenedor local en desarrollo).
 *
 * Un único pool para todo el proceso. El bot corre en una sola instancia, así
 * que un pool chico alcanza y sobra: lo que importa es no abrir una conexión por
 * consulta, porque el pooler de Supabase las cuenta.
 */

import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { MIGRATIONS } from './migrations.js';

export const TIMEZONE = 'America/Argentina/Tucuman';

let pool: Pool | null = null;

export interface DbOptions {
  connectionString: string;
  /**
   * Contraseña por separado. Si viene, se ignora la que traiga la cadena.
   * Ver `buildConnection()` para el porqué.
   */
  password?: string;
  /** Máximo de conexiones. En un proceso único, 5 es holgado. */
  max?: number;
  /** Se desactiva solo para el Postgres local de desarrollo. */
  ssl?: boolean;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Arma la configuración de conexión.
 *
 * Con `DATABASE_PASSWORD` definido, la cadena se descompone en campos sueltos y
 * la contraseña se pasa cruda. Suena rebuscado, pero evita una clase entera de
 * fallas: dentro de una URL, la contraseña se interpreta como texto
 * percent-encoded, y las contraseñas que genera Supabase traen `%` seguido de
 * hexadecimal muy seguido. Qué pasa según el caso:
 *
 *   ...B%CFjn...  → `URIError: URI malformed` — el proceso ni arranca, y el
 *                    error no menciona contraseñas por ningún lado
 *   ...ab%41cd... → se decodifica en silencio a `abAcd` y falla la autenticación
 *
 * No alcanza con pasar `password` junto a `connectionString`: `pg` parsea la
 * cadena DESPUÉS y pisa la opción explícita (incluso con `undefined`). Por eso,
 * cuando hay contraseña aparte, la cadena no se usa como tal.
 */
function buildConnection(options: DbOptions): Record<string, unknown> {
  if (!options.password) return { connectionString: options.connectionString };

  const url = new URL(options.connectionString);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: safeDecode(url.username),
    database: url.pathname.replace(/^\//, '') || 'postgres',
    password: options.password,
  };
}

export function openDb(options: DbOptions): Pool {
  if (pool) return pool;

  const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal|postgres)[:/]/.test(
    options.connectionString,
  );
  const useSsl = options.ssl ?? !isLocal;

  pool = new Pool({
    ...buildConnection(options),
    max: options.max ?? 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Ninguna consulta de este sistema debería tardar más de 15 s. Si tarda, algo
    // está mal y es mejor fallar que dejar al cliente esperando en el chat.
    statement_timeout: 15_000,
    // Supabase termina la cadena TLS en su pooler; el certificado no valida
    // contra las CA del sistema, y por eso la verificación se relaja. Es lo que
    // documenta Supabase para conexiones desde servidores.
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

  pool.on('error', (err) => {
    // Una conexión ociosa que se corta no debe tumbar el proceso: el pool abre
    // otra en la próxima consulta.
    console.error('[pg] error en una conexión ociosa:', err.message);
  });

  return pool;
}

export function getPool(): Pool {
  if (!pool) throw new Error('La base no está abierta: llamá a openDb() primero.');
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

// ---------------------------------------------------------------------------
// Helpers de consulta
// ---------------------------------------------------------------------------

/** Filas de una consulta. */
export async function q<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params as never[]);
  return result.rows;
}

/** Primera fila, o null. */
export async function one<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

/** Cantidad de filas afectadas. */
export async function exec(sql: string, params: unknown[] = []): Promise<number> {
  const result = await getPool().query(sql, params as never[]);
  return result.rowCount ?? 0;
}

/** Transacción. Hace rollback si el callback lanza. */
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Migraciones
// ---------------------------------------------------------------------------

/** Clave arbitraria pero fija, para el lock de migraciones. */
const MIGRATION_LOCK = 728_913;

/**
 * Aplica las migraciones pendientes. Toma un advisory lock primero: si dos
 * instancias arrancan al mismo tiempo (un deploy con solapamiento, por ejemplo),
 * una espera y después ve que ya no hay nada que aplicar.
 */
export async function migrate(): Promise<number[]> {
  await exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         integer PRIMARY KEY,
      name       text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const client = await getPool().connect();
  const applied: number[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);

    const done = new Set(
      (await client.query<{ id: number }>('SELECT id FROM _migrations')).rows.map((r) => r.id),
    );

    for (const migration of MIGRATIONS) {
      if (done.has(migration.id)) continue;
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query('INSERT INTO _migrations (id, name) VALUES ($1, $2)', [
          migration.id,
          migration.name,
        ]);
        await client.query('COMMIT');
        applied.push(migration.id);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(
          `Falló la migración ${migration.id} (${migration.name}): ${(err as Error).message}`,
        );
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
  return applied;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const ALPHABET = '0123456789abcdefghijkmnpqrstvwxyz';

/** Id ordenable por tiempo (prefijo temporal + azar). Legible en la UI. */
export function newId(prefix = ''): string {
  let time = Date.now();
  let stamp = '';
  for (let i = 0; i < 8; i++) {
    stamp = ALPHABET[time % 32] + stamp;
    time = Math.floor(time / 32);
  }
  let rand = '';
  for (let i = 0; i < 8; i++) rand += ALPHABET[Math.floor(Math.random() * 32)];
  return `${prefix}${stamp}${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Fecha de hoy (AAAA-MM-DD) en el huso de Tucumán.
 *
 * `new Date().toISOString().slice(0,10)` daría UTC, y entre las 21:00 y la
 * medianoche de Argentina eso ya es el día siguiente: un pedido para esta noche
 * quedaba rechazado como "fecha pasada".
 */
export function localToday(at: Date = new Date()): string {
  // 'en-CA' formatea como AAAA-MM-DD, que es exactamente lo que necesitamos.
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(at);
}

/** Hora local (0-23) en Tucumán. */
/**
 * La hora local en minutos desde medianoche.
 *
 * Existe porque `localHour` redondea a la hora y el local cierra 21:30. Con
 * horas enteras había media hora en la que el bot tomaba pedidos que nadie iba
 * a preparar.
 */
export function localMinutes(at: Date = new Date()): number {
  const [h, m] = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(at)
    .split(':');
  return Number(h) * 60 + Number(m);
}

export function localHour(at: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIMEZONE,
      hour: '2-digit',
      hour12: false,
    }).format(at),
  );
}

/** `pg` devuelve Date para timestamptz; el dominio usa ISO string. */
export function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  return iso(value);
}

/** `date` viene como Date de pg; el dominio la quiere como AAAA-MM-DD. */
export function dateOnly(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    // Una columna `date` no tiene huso: se formatea en UTC para no correrla un día.
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}
