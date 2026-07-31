/**
 * Escribe el esquema completo en `supabase/schema.sql`.
 *
 * El servidor aplica las migraciones solo al arrancar, así que este archivo no
 * es necesario para que funcione. Existe para poder revisar el esquema en el
 * repo, versionarlo, y correrlo a mano desde el editor SQL de Supabase cuando se
 * prefiere provisionar la base antes del primer deploy.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { schemaSql } from '../src/core/store/migrations.js';

const out = resolve(import.meta.dirname, '../../../supabase/schema.sql');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, schemaSql(), 'utf8');
console.log(`Esquema escrito en ${out}`);
