/**
 * Que las guardas estén VIVAS.
 *
 * `JERGA_INTERNA` estuvo muerta desde el día que se escribió y nadie se enteró
 * en semanas, porque una guarda que no dispara no deja rastro en ningún lado:
 * no hay log, no hay error, el archivo se ve perfecto en el editor. Lo que había
 * guardado de verdad era esto, visto con `cat -A`:
 *
 *     [/s+en (?:el|nuestro|mi) cat[áa]logo^H/gi, '']
 *           ↑                            ↑
 *        falta la barra          un byte 0x08, no un \b
 *
 * El origen: escribir el archivo desde un heredoc de shell, que se come las
 * barras invertidas. Pasó más de una vez en este repo.
 *
 * Este script busca las dos cosas:
 *   1. El byte 0x08 en cualquier archivo de código.
 *   2. Que cada tabla dispare con el caso que su propio comentario dice que
 *      arregla. Una guarda que no reacciona a su caso fundador está rota,
 *      aunque el regex se vea bien.
 *
 *   npx tsx scripts/probar-guardas-vivas.mts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeWriting } from '../src/core/policies/writing.js';

let mal = 0;

/* ------------------------------------------------------------------ */
/* 1. El byte que no se ve.                                            */
/* ------------------------------------------------------------------ */
function todos(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) todos(p, out);
    else if (/\.(ts|mts)$/.test(f)) out.push(p);
  }
  return out;
}

console.log('\n  Bytes 0x08 en el código\n');
let sucios = 0;
for (const f of todos('src')) {
  const buf = readFileSync(f);
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x08) n++;
  if (!n) continue;
  sucios++;
  mal++;
  console.log(`  ✗ ${f}: ${n} backspace(s) literales donde debería ir \\b`);
}
if (!sucios) console.log('  ✓ ninguno');

/* ------------------------------------------------------------------ */
/* 2. Cada tabla contra el caso que le dio origen.                     */
/* ------------------------------------------------------------------ */
type Caso = { nombre: string; entra: string; sale: string };

const CASOS: Caso[] = [
  {
    nombre: 'jerga interna · el catálogo',
    entra: 'No tenemos salsa en el catálogo, así que no la vendemos.',
    sale: 'No tenemos salsa, así que no la vendemos.',
  },
  {
    nombre: 'jerga interna · el sistema',
    entra: 'Esa cookie no está en el sistema, dejame chequear.',
    sale: 'Esa cookie no está, dejame chequear.',
  },
  {
    nombre: 'jerga interna · la lista de disponibles',
    entra: 'La cookie nutella y oreo está en nuestra lista de disponibles.',
    sale: 'La cookie nutella y oreo está disponible.',
  },
  {
    nombre: 'marcador interno · el operador',
    entra: 'Si te cambia de idea, el operador del local te ofrece mandar un Uber.',
    sale: 'Si te cambia de idea, el local te ofrece mandar un Uber.',
  },
  {
    nombre: 'negrita · los asteriscos de WhatsApp',
    entra: '**Cookies:** vainilla, nutella, kinder — todas a $5.000',
    sale: 'Cookies: vainilla, nutella, kinder — todas a $5.000',
  },
  {
    nombre: 'lado del mostrador · la hora de cierre',
    entra: 'Hoy retiramos hasta las 21:30',
    sale: 'Hoy estamos hasta las 21:30',
  },
  {
    nombre: 'lado del mostrador · el Uber lo manda ella',
    entra: 'Lo retirás por el local o te lo mandamos con Uber?',
    sale: 'Lo retirás por el local o lo mandás a buscar con un Uber?',
  },
];

console.log('\n  Cada guarda contra su caso fundador\n');
for (const c of CASOS) {
  const sale = normalizeWriting(c.entra).text;
  const ok = sale === c.sale;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${c.nombre}`);
  if (!ok) console.log(`      esperaba: ${c.sale}\n      salió:    ${sale}`);
}

console.log(mal ? `\n  ${mal} problemas. Hay guardas muertas.\n` : '\n  Todas vivas.\n');
process.exit(mal ? 1 : 0);
