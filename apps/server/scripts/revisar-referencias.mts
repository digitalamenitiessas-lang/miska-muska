/**
 * Que ninguna regla del prompt apunte a otra que no existe.
 *
 * POLICY_PROSE tiene treinta y pico de bloques con TÍTULO EN MAYÚSCULAS, y las
 * reglas se mandan entre sí con "Ver TAL COSA". Si a un bloque se le cambia el
 * título —pasó con el de las tortas— las referencias quedan colgadas apuntando
 * a algo que ya no está, y el modelo se queda con media instrucción.
 *
 * Nadie se entera de eso leyendo el diff.
 *
 * Se leen los FUENTES y no solo POLICY_PROSE porque las referencias también
 * viven en el contexto del día y en las descripciones de las herramientas.
 *
 *   npx tsx scripts/revisar-referencias.mts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { POLICY_PROSE } from '../src/core/policies/rules.js';

const RAIZ = resolve(import.meta.dirname, '..');
const FUENTES = [
  'src/core/policies/rules.ts',
  'src/core/agent/persona.ts',
  'src/core/agent/tools.ts',
];

/** Los títulos de bloque: una línea entera en mayúsculas. */
const titulos = POLICY_PROSE.split('\n')
  .map((l) => l.trim())
  .filter((l) => l.length > 5 && l === l.toUpperCase() && /^[A-ZÁÉÍÓÚÑ]/.test(l));

console.log(titulos.length + ' bloques con título en POLICY_PROSE\n');

let colgadas = 0;
let total = 0;

for (const rel of FUENTES) {
  const fuente = readFileSync(resolve(RAIZ, rel), 'utf8');
  /*
    La referencia puede venir cortada por un salto de línea y por las comillas
    de la concatenación, así que se aplana todo lo que separe palabras antes de
    comparar.
  */
  const plano = fuente.replace(/['"`+\n\s]+/g, ' ');
  const refs = [...plano.matchAll(/\bVer ([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ,:;—-]{5,})/g)]
    .map((m) => m[1].replace(/[.,;:\s]+$/, '').trim())
    .filter((r) => r.split(' ').length >= 2);

  if (!refs.length) continue;
  console.log('— ' + rel);
  for (const ref of refs) {
    total++;
    const aplanado = (t: string) => t.replace(/[\s,:;—-]+/g, ' ').trim();
    const existe = titulos.some(
      (t) => aplanado(t).startsWith(aplanado(ref)) || aplanado(ref).startsWith(aplanado(t)),
    );
    console.log(`  ${existe ? 'ok     ' : 'COLGADA'} Ver ${ref}`);
    if (!existe) colgadas++;
  }
}

console.log(
  colgadas ? `\n${colgadas} referencia(s) colgada(s) de ${total}` : `\nTodo bien: ${total} referencias.`,
);
process.exit(colgadas ? 1 : 0);
