/**
 * Configura la conexión a Supabase de punta a punta, en un comando.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx npm run setup:supabase
 *
 * Qué hace:
 *   1. lista tus proyectos con la Management API y elige el de Miska Muska
 *   2. arma la cadena del pooler probando los hosts candidatos, y se queda con
 *      el que autentica de verdad (no adivina el formato: lo verifica)
 *   3. escribe DATABASE_URL en el .env sin tocar el resto del archivo
 *   4. aplica las migraciones y carga el catálogo
 *
 * El token se lee del entorno y nunca se escribe a disco ni se imprime.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { closeDb, migrate, openDb } from '../src/core/store/db.js';
import { seed } from '../src/core/store/seed.js';

const ENV_PATH = resolve(import.meta.dirname, '../../../.env');
const API = process.env.SUPABASE_API_URL?.trim() || 'https://api.supabase.com/v1';

interface Project {
  id: string;
  name: string;
  region: string;
  status: string;
}

/**
 * Error de configuración, ya explicado al usuario. Se lanza en vez de llamar a
 * `process.exit()` para no cortar el proceso con peticiones en vuelo (libuv se
 * queja con una aserción fea si se sale en medio de un fetch).
 */
class SetupError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

function fail(message: string, hint?: string): never {
  throw new SetupError(message, hint);
}

// ---------------------------------------------------------------------------
// Piezas puras, testeables por separado
// ---------------------------------------------------------------------------

/**
 * Los hosts del pooler siguen dos formatos según cuándo se creó el proyecto.
 * En vez de adivinar, se prueban los dos con una conexión real.
 */
export function candidateHosts(region: string): string[] {
  return [`aws-0-${region}.pooler.supabase.com`, `aws-1-${region}.pooler.supabase.com`];
}

/** Reemplaza (o agrega) una clave del .env sin tocar comentarios ni el resto. */
export function upsertEnv(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  // Reemplazo por función: si el valor trae `$&` o `$'`, la forma con string los
  // interpretaría como referencias del regex y corrompería el archivo.
  if (pattern.test(content)) return content.replace(pattern, () => line);
  return `${content.trimEnd()}\n${line}\n`;
}

/** Devuelve null si conecta, o el mensaje de error si no. */
export async function probeConnection(opts: {
  host: string;
  user: string;
  password: string;
  ssl: boolean;
}): Promise<string | null> {
  const client = new Client({
    host: opts.host.split(':')[0],
    port: Number(opts.host.split(':')[1] ?? 5432),
    user: opts.user,
    database: 'postgres',
    password: opts.password,
    ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    await client.query('select 1');
    return null;
  } catch (err) {
    return (err as Error).message;
  } finally {
    await client.end().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------

async function listProjects(token: string): Promise<Project[]> {
  let res: Response;
  try {
    res = await fetch(`${API}/projects`, { headers: { authorization: `Bearer ${token}` } });
  } catch (err) {
    return fail(`No pude alcanzar la API de Supabase: ${(err as Error).message}`);
  }
  if (res.status === 401) {
    fail(
      'El token no es válido o está vencido.',
      'Generá uno nuevo en supabase.com/dashboard/account/tokens',
    );
  }
  if (!res.ok) fail(`La API de Supabase respondió ${res.status}: ${await res.text()}`);
  return (await res.json()) as Project[];
}

async function main(): Promise<void> {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) {
    fail(
      'Falta SUPABASE_ACCESS_TOKEN.',
      'bash / cmd:   SUPABASE_ACCESS_TOKEN=sbp_xxx npm run setup:supabase\n' +
        '  PowerShell:   $env:SUPABASE_ACCESS_TOKEN="sbp_xxx"; npm run setup:supabase',
    );
  }

  if (!existsSync(ENV_PATH)) fail(`No encuentro el .env en ${ENV_PATH}`);
  let envContent = readFileSync(ENV_PATH, 'utf8');

  const password = /^DATABASE_PASSWORD=(.*)$/m.exec(envContent)?.[1]?.trim();
  if (!password) {
    fail(
      'Falta DATABASE_PASSWORD en el .env.',
      'Es la contraseña de la base, la que definiste al crear el proyecto.\n' +
        '  Si no la recordás: Project Settings → Database → Reset database password.',
    );
  }

  console.log('→ Consultando tus proyectos…');
  const projects = await listProjects(token);
  if (!projects.length) fail('Tu cuenta no tiene proyectos.');

  const wanted = process.argv[2]?.toLowerCase();
  const matches = wanted
    ? projects.filter((p) => p.name.toLowerCase().includes(wanted))
    : projects.filter((p) => /miska/i.test(p.name));

  if (!matches.length) {
    console.log('\n  Proyectos encontrados:');
    for (const p of projects) console.log(`    ${p.name}  (ref ${p.id}, ${p.region}, ${p.status})`);
    fail(
      'No encontré ninguno que se llame como "miska".',
      'Pasá el nombre como argumento:  npm run setup:supabase -- nombre-del-proyecto',
    );
  }
  if (matches.length > 1) {
    console.log('\n  Coinciden varios:');
    for (const p of matches) console.log(`    ${p.name}  (ref ${p.id}, ${p.region})`);
    fail('Es ambiguo.', 'Pasá un nombre más específico como argumento.');
  }

  const project = matches[0];
  console.log(
    `  ${project.name} — ref ${project.id}, región ${project.region}, estado ${project.status}`,
  );
  if (project.status !== 'ACTIVE_HEALTHY') {
    console.log(`  ⚠ Estado ${project.status}. Si recién lo creaste, esperá un minuto y reintentá.`);
  }

  console.log('\n→ Probando los hosts del pooler…');
  let host: string | null = null;
  for (const candidate of candidateHosts(project.region)) {
    process.stdout.write(`  ${candidate} … `);
    const error = await probeConnection({
      host: candidate,
      user: `postgres.${project.id}`,
      password,
      ssl: true,
    });
    if (!error) {
      console.log('✔');
      host = candidate;
      break;
    }
    console.log(`✗ ${error.split('\n')[0]}`);
    if (/password authentication failed/i.test(error)) {
      fail(
        'El host es correcto pero la contraseña no.',
        'Revisá DATABASE_PASSWORD en el .env, o reseteala en\n' +
          '  Project Settings → Database → Reset database password.',
      );
    }
  }
  if (!host) {
    fail(
      'Ningún host del pooler aceptó la conexión.',
      'Copiá la cadena de Project Settings → Database → Connection string →\n' +
        '  Session pooler, y pegá el host a mano en DATABASE_URL.',
    );
  }

  const url = `postgresql://postgres.${project.id}@${host}:5432/postgres`;
  envContent = upsertEnv(envContent, 'DATABASE_URL', url);
  writeFileSync(ENV_PATH, envContent, 'utf8');
  console.log(`\n→ .env actualizado:\n  DATABASE_URL=${url}`);

  console.log('\n→ Aplicando migraciones…');
  openDb({ connectionString: url, password, ssl: true });
  const applied = await migrate();
  console.log(applied.length ? `  aplicadas: ${applied.join(', ')}` : '  ya estaba al día');

  console.log('\n→ Cargando catálogo y mensajes rápidos…');
  await seed();

  console.log('\n✓ Listo. Arrancá con:  npm run dev');
  console.log('  Para ver conversaciones de ejemplo:  npm run demo');
}

// Solo corre cuando se ejecuta como script, no al importarlo: así las piezas de
// arriba se pueden probar por separado sin disparar la configuración entera.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (err) {
    if (err instanceof SetupError) {
      console.error(`\n✗ ${err.message}`);
      if (err.hint) console.error(`\n  ${err.hint}`);
    } else {
      console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exitCode = 1;
  } finally {
    await closeDb().catch(() => undefined);
  }
}
