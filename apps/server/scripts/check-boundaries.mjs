#!/usr/bin/env node
/**
 * Verifica las fronteras de la arquitectura. El aislamiento del pipeline no es
 * una convención escrita en el README: es un chequeo que falla el build.
 *
 * Reglas:
 *   core/     no puede importar de channels/ ni de api/
 *   channels/ no puede importar de api/ ni de otro canal
 *   core/     no puede importar fastify (no conoce HTTP)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');

const RULES = [
  {
    layer: 'core',
    forbidden: [/(^|[/\\])channels[/\\]/, /(^|[/\\])api[/\\]/, /^fastify$/, /^@fastify\//],
    why: 'core/ es el dominio: no puede conocer canales, HTTP ni el framework web.',
  },
  {
    layer: 'channels',
    forbidden: [/(^|[/\\])api[/\\]/],
    why: 'channels/ es transporte: no puede depender de la capa HTTP de gestión.',
  },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

const violations = [];
for (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  const layer = rel.split(sep)[0];
  const rule = RULES.find((r) => r.layer === layer);
  if (!rule) continue;

  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (rule.forbidden.some((pattern) => pattern.test(spec))) {
      violations.push({ file: rel, spec, why: rule.why });
    }
  }

  // Un canal no puede importar de otro canal.
  if (layer === 'channels') {
    const own = rel.split(sep)[1];
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1];
      const other = /channels[/\\]([^/\\]+)/.exec(spec)?.[1];
      if (other && other !== own) {
        violations.push({
          file: rel,
          spec,
          why: `El canal ${own} no puede depender del canal ${other}.`,
        });
      }
    }
  }
}

if (violations.length) {
  console.error('\n✗ Se rompieron las fronteras de la arquitectura:\n');
  for (const v of violations) {
    console.error(`  ${v.file}\n    importa "${v.spec}"\n    ${v.why}\n`);
  }
  process.exit(1);
}

console.log('✓ Fronteras OK: core/ no conoce canales ni HTTP, y los canales no se conocen entre sí.');
