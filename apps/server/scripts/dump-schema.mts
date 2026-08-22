/**
 * Escribe el esquema completo en `supabase/schema.sql`, y además cada migración
 * por separado en `supabase/migraciones/`.
 *
 * El servidor aplica las migraciones solo al arrancar, así que estos archivos no
 * son necesarios para que funcione. Existen para poder revisar el esquema en el
 * repo, versionarlo, y correrlo a mano desde el editor SQL de Supabase.
 *
 * Los archivos por migración son para el caso más común después del primer
 * deploy: la base ya existe y solo hay que aplicar las nuevas. Cada uno trae su
 * `INSERT INTO _migrations`, así que después de correrlo el servidor ya no lo ve
 * como pendiente.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MIGRATIONS, migrationSql, schemaSql } from '../src/core/store/migrations.js';

const raiz = resolve(import.meta.dirname, '../../..');

const esquema = resolve(raiz, 'supabase/schema.sql');
mkdirSync(dirname(esquema), { recursive: true });
writeFileSync(esquema, schemaSql(), 'utf8');
console.log(`Esquema escrito en ${esquema}`);

const carpeta = resolve(raiz, 'supabase/migraciones');
mkdirSync(carpeta, { recursive: true });
for (const migration of MIGRATIONS) {
  const nombre = `${String(migration.id).padStart(3, '0')}-${migration.name}.sql`;
  const destino = resolve(carpeta, nombre);
  const cabecera = [
    `-- Migración ${migration.id} de la base del bot de Miska Muska.`,
    '-- Generado con `npm run db:sql`. No editar a mano: editá migrations.ts.',
    '--',
    '-- Para correrla a mano en el editor SQL de Supabase: pegá todo, incluido el',
    '-- INSERT del final, que es lo que le dice al servidor que ya está aplicada.',
    '',
    'CREATE TABLE IF NOT EXISTS _migrations (',
    '  id         integer PRIMARY KEY,',
    '  name       text NOT NULL,',
    '  applied_at timestamptz NOT NULL DEFAULT now()',
    ');',
    '',
  ].join('\n');
  writeFileSync(destino, `${cabecera}\n${migrationSql(migration)}`, 'utf8');
  console.log(`  ${nombre}`);
}
