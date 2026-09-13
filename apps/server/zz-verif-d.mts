import { openDb, q, closeDb, TIMEZONE } from './src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const CON_QUIEN: Array<[RegExp, string, string]> = [
  [/\s+con\s+(?:el\s+local|la\s+encargada|cocina)\b(?!\s+y\s+con\b)/gi, '', 'C1'],
  [/\s+a\s+la\s+encargada\b/gi, '', 'C2'],
  [/\s+(?:a|con)\s+(?:alguien|una\s+persona)\s+del\s+local\b/gi, '', 'C3'],
  [/\s+al\s+equipo\s+del\s+local\b/gi, '', 'C4'],
  [
    /(?<!\bte\s(?:lo|la|los|las)\s)\b((?:cheque|confirm|consult|revis|averigu)\w*(?:\s+[^\s.,;:!?¡¿]+){0,3}?)\s+en\s+el\s+local\b/gi,
    '$1',
    'C5',
  ],
  [/\ben\s+el\s+local\s+(?=(?:cheque|confirm|consult|revis|averigu)\w*\b)/gi, '', 'C6'],
  [
    /\b((?:cheque|confirm|consult|revis|averigu)\w*(?:\s+[^\s.,;:!?¡¿]+){0,3}?)\s+(?:en|de|desde|a)\s+cocina\b/gi,
    '$1',
    'C7',
  ],
  [/\s+(?:de|desde)\s+cocina\b/gi, '', 'C8'],
];
const JERGA: Array<[RegExp, string, string]> = [
  [/\s+en (?:el|nuestro|mi) cat[áa]logo\b/gi, '', 'J1'],
  [/\s+en (?:el|nuestro|mi) sistema\b/gi, '', 'J2'],
  [/\s+en (?:la|nuestra|mi) base(?: de datos)?\b/gi, '', 'J3'],
  [/\s+en (?:nuestra|mi|la) lista de disponibles\b/gi, ' disponible', 'J4'],
  [/\s+del panel\b/gi, '', 'J5'],
  [/\bno (?:lo |la |los |las )?tengo cargad[oa]s?\b/gi, 'no tenemos', 'J6'],
];
const TODAS = [...JERGA, ...CON_QUIEN];

function correr(t: string) {
  let out = t;
  const et: string[] = [];
  for (const [re, to, e] of TODAS) {
    const l = out.replace(re, to);
    if (l !== out) {
      et.push(e);
      out = l;
    }
  }
  return { out, et };
}

console.log('################ 1. QUICK_REPLIES (texto del EQUIPO) ################');
const qr = await q<any>(`select key, label, body, auto_send from quick_replies order by label`, []);
console.log('total rapidos:', qr.length);
for (const r of qr) {
  const { out, et } = correr(r.body);
  if (et.length) {
    console.log(`\n  TOCADO [${et.join(',')}] key=${r.key} auto_send=${r.auto_send}`);
    console.log(`    ANTES  : ${r.body.replace(/\n/g, ' ⏎ ').slice(0, 300)}`);
    console.log(`    DESPUES: ${out.replace(/\n/g, ' ⏎ ').slice(0, 300)}`);
  }
}
const conRiesgo = qr.filter((r: any) => /local|cocina|encargad|sistema|cat[áa]logo|panel/i.test(r.body));
console.log('\n  rapidos que MENCIONAN local/cocina/encargada/sistema (tocados o no):', conRiesgo.length);
for (const r of conRiesgo) console.log(`    - ${r.key}: ${r.body.replace(/\n/g, ' ⏎ ').slice(0, 220)}`);

console.log('\n################ 2. PRODUCTOS (nombres y notas) ################');
const prods = await q<any>(`select id, name, category, notes from products`, []);
let tocadosProd = 0;
for (const p of prods) {
  for (const campo of [p.name, p.notes ?? '']) {
    if (!campo) continue;
    const { out, et } = correr(campo);
    if (et.length) {
      tocadosProd++;
      console.log(`  TOCADO [${et.join(',')}] ${p.name}: ${JSON.stringify(campo)} -> ${JSON.stringify(out)}`);
    }
  }
}
console.log(`  productos: ${prods.length}, campos tocados: ${tocadosProd}`);

console.log('\n################ 3. "alguien del local" COMO SUJETO (queda vivo) ################');
const suj = await q<any>(
  `select text from messages
   where direction='out' and author='bot' and content_kind='text'
     and created_at >= now() - interval '14 days'
     and text ~* '(alguien|una persona) del local'`,
  [],
);
let vivos = 0;
const ejemplosVivos: string[] = [];
for (const m of suj) {
  const { out } = correr(m.text);
  const re = /(alguien|una\s+persona)\s+del\s+local/gi;
  const quedan = [...out.matchAll(re)];
  vivos += quedan.length;
  for (const mm of quedan) {
    if (ejemplosVivos.length < 14) {
      ejemplosVivos.push(out.slice(Math.max(0, mm.index! - 60), mm.index! + 60).replace(/\n/g, ' ⏎ '));
    }
  }
}
console.log(`  mensajes con "alguien/una persona del local": ${suj.length}`);
console.log(`  ocurrencias que SOBREVIVEN a la tabla: ${vivos}  (${(vivos / 14).toFixed(1)}/dia)`);
for (const e of ejemplosVivos) console.log(`    · …${e}…`);

console.log('\n################ 4. "en el local" LEGITIMO (no se toca) ################');
const enLocal = await q<any>(
  `select text from messages
   where direction='out' and author='bot' and content_kind='text'
     and created_at >= now() - interval '14 days' and text ~* 'en el local'`,
  [],
);
let totalOcc = 0,
  borradas = 0;
for (const m of enLocal) {
  const antes = (m.text.match(/en\s+el\s+local/gi) ?? []).length;
  const { out } = correr(m.text);
  const desp = (out.match(/en\s+el\s+local/gi) ?? []).length;
  totalOcc += antes;
  borradas += antes - desp;
}
console.log(`  mensajes con "en el local": ${enLocal.length}; ocurrencias: ${totalOcc}; borradas: ${borradas}; intactas: ${totalOcc - borradas}`);

console.log('\n################ 5. MENSAJES DEL EQUIPO (out/human) que la tabla tocaria ################');
const hum = await q<any>(
  `select text from messages
   where direction='out' and author='human' and content_kind='text'
     and created_at >= now() - interval '14 days' and text is not null`,
  [],
);
let humTocados = 0;
const ejH: string[] = [];
for (const m of hum) {
  const { out, et } = correr(m.text);
  if (et.length) {
    humTocados++;
    if (ejH.length < 12) ejH.push(`[${et.join(',')}] ${m.text.replace(/\n/g, ' ⏎ ').slice(0, 130)}  ->  ${out.replace(/\n/g, ' ⏎ ').slice(0, 130)}`);
  }
}
console.log(`  mensajes del equipo: ${hum.length}; la tabla tocaria: ${humTocados} (${(humTocados / 14).toFixed(1)}/dia) SI pasaran por normalizeWriting`);
for (const e of ejH) console.log(`    · ${e}`);

await closeDb();
