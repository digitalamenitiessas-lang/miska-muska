/**
 * La guarda de la suma, contra los mensajes de verdad.
 *
 * Lo que se mide NO es que encuentre el error —eso es lo fácil—. Es que no
 * toque ninguna de las cuentas que ya están bien. Esta es la única guarda que
 * reescribe un número, así que un falso positivo acá no es ruido en un log: es
 * un precio equivocado mandado a una clienta.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-totales.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { revisarCuenta, corregirTotal } from '../src/core/policies/totales.js';

/** El caso real, y los que se le parecen. */
const CASOS: Array<{ texto: string; suma: number | null; corrige: boolean; nota: string }> = [
  {
    nota: 'el error real del viernes: 2x4800 + 4100 + 4100',
    texto:
      'Listo! Entonces sería:\n🧁 2x Muffin pistacho — $4.800 c/u\n🧁 1x Muffin maracuyá — $4.100\n🧁 1x Muffin vainilla con chips — $4.100\n**Total:** $17.700',
    suma: 17800,
    corrige: true,
  },
  {
    nota: 'la misma forma, bien sumada: no se toca',
    texto:
      'Entonces va:\n🍰 3 Budín carrot $4.000 c/u\n🍪 1 Cookie dubai $5.000\n🍪 1 Cookie kinder $5.000\n**Total: $22.000**',
    suma: 22000,
    corrige: false,
  },
  {
    /*
      Los subtotales ya vienen multiplicados y no hay "c/u": la suma sale bien
      igual, porque sin "c/u" el renglón se toma tal cual. Pero queda marcado
      como no confiable, así que aunque no diera no se tocaría. Doble red.
    */
    nota: 'subtotales ya multiplicados, sin c/u: suma bien y no toca',
    texto:
      'Mirá el total:\n🍰 Desayuno Miska Muska — $40.000\n🍩 Alfajor de maicena sin TACC x3 — $12.900\n🍫 Brownie con nueces sin TACC x1 — $5.500\n🍪 Cookie con chips de chocolate sin TACC x2 — $10.200\n\n**TOTAL: $68.600**',
    suma: 68600,
    corrige: false,
  },
  {
    // El "$26.000" de la prosa queda afuera de la suma: el renglón empieza con letra.
    nota: 'un precio abierto en la prosa de arriba: no entra en la cuenta',
    texto:
      'Acerca de la cajita: nuestras cajas de regalo van a partir de $26.000.\n🍰 Mini torta — $10.800\n🍪 Cookie Ferrero — $5.000\n**TOTAL: $15.800**',
    suma: 15800,
    corrige: false,
  },
  {
    nota: 'el envío es un renglón más y entra en la suma',
    texto:
      '🍰 Mini torta Kinder — $10.800\n🥪 Sanguchito — $7.800\n+ Envío — $3.000\n**TOTAL: $21.600**',
    suma: 21600,
    corrige: false,
  },
  {
    nota: 'un solo renglón: no hay suma que revisar',
    texto: '🍰 Mini torta Kinder — $10.800\n**Total: $10.800**',
    suma: null,
    corrige: false,
  },
];

let mal = 0;
console.log('\n  Casos armados\n');
for (const c of CASOS) {
  const r = revisarCuenta(c.texto);
  const suma = r ? r.da : null;
  const corrige = Boolean(r && r.confiable && r.dijo !== r.da);
  const ok = suma === c.suma && corrige === c.corrige;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${c.nota}`);
  if (!ok) {
    console.log(
      `      esperaba suma ${c.suma === null ? '(ninguna)' : '$' + c.suma}` +
        ` y ${c.corrige ? 'que corrigiera' : 'que no tocara'};` +
        ` dio suma ${suma === null ? '(ninguna)' : '$' + suma}` +
        ` y ${corrige ? 'corrigió' : 'no tocó'}`,
    );
  }
}

/*
  Y ahora lo único que importa de verdad: sobre los mensajes que ya salieron y
  que el local dio por buenos, ¿cuántas veces querría corregir? Cada uno se
  imprime entero para poder mirarlo a ojo, porque cada uno sería un número
  reescrito en el chat de una clienta.
*/
openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const msgs = await q<{ t: string; text: string; c: string }>(
  `select to_char(created_at at time zone $1,'DD/MM HH24:MI') t, text, conversation_id c
   from messages
   where direction='out' and author='bot' and text is not null and text ~* 'total'
     and created_at > now() - interval '30 days'
   order by created_at asc`,
  [TIMEZONE],
);

let conCuenta = 0;
let tocaria = 0;
let dudosas = 0;

console.log(`\n  Corpus real: ${msgs.length} mensajes del bot con la palabra "total", 30 días\n`);
for (const m of msgs) {
  const r = revisarCuenta(m.text);
  if (!r) continue;
  conCuenta++;
  if (r.dijo === r.da) continue;
  if (!r.confiable) {
    dudosas++;
    continue;
  }
  tocaria++;
  const { texto } = corregirTotal(m.text);
  console.log(`  ${m.t}  dijo $${r.dijo.toLocaleString('es-AR')} → $${r.da.toLocaleString('es-AR')}   [${m.c}]`);
  console.log(`     ${m.text.replace(/\s+/g, ' ').slice(0, 210)}`);
  console.log(`     quedaría: ${texto.split('\n').filter((l) => /total/i.test(l)).join(' ').trim()}\n`);
}

console.log(`  ${conCuenta} mensajes traen una cuenta revisable.`);
console.log(`  ${tocaria} se corregirían.`);
console.log(`  ${dudosas} no dan pero son ambiguas: quedan como están y solo se anotan.`);
console.log(mal ? `\n  ${mal} casos armados fallaron.\n` : '\n  Los casos armados pasan todos.\n');

await closeDb();
process.exit(mal ? 1 : 0);
