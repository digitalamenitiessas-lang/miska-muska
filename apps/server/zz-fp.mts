import { openDb, q, closeDb, TIMEZONE } from './src/core/store/db.js';

const CON_QUIEN_SE_CONSULTA: Array<[string, RegExp, string]> = [
  ['C1', /\s+con\s+(?:el\s+local|la\s+encargada|cocina)\b(?!\s+y\s+con\b)/gi, ''],
  ['C2', /\s+a\s+la\s+encargada\b/gi, ''],
  ['C3', /\s+(?:a|con)\s+(?:alguien|una\s+persona)\s+del\s+local\b/gi, ''],
  ['C4', /\s+al\s+equipo\s+del\s+local\b/gi, ''],
  [
    'C5',
    /(?<!\bte\s(?:lo|la|los|las)\s)\b((?:cheque|confirm|consult|revis|averigu)\w*(?:\s+[^\s.,;:!?¡¿]+){0,3}?)\s+en\s+el\s+local\b/gi,
    '$1',
  ],
  ['C6', /\ben\s+el\s+local\s+(?=(?:cheque|confirm|consult|revis|averigu)\w*\b)/gi, ''],
  [
    'C7',
    /\b((?:cheque|confirm|consult|revis|averigu)\w*(?:\s+[^\s.,;:!?¡¿]+){0,3}?)\s+(?:en|de|desde|a)\s+cocina\b/gi,
    '$1',
  ],
  ['C8', /\s+(?:de|desde)\s+cocina\b/gi, ''],
];

function aplicar(t: string): { out: string; pats: string[] } {
  let out = t;
  const pats: string[] = [];
  for (const [n, re, to] of CON_QUIEN_SE_CONSULTA) {
    re.lastIndex = 0;
    const limpio = out.replace(re, to);
    if (limpio !== out) {
      pats.push(n);
      out = limpio;
    }
  }
  return { out, pats };
}

openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });

// ============ A) OTRAS SUPERFICIES QUE PASAN POR normalizeWriting ============
console.log('==================== A) QUICK REPLIES (pasan por normalizeWriting) ====================');
const qr = await q<any>('select key, label, body from quick_replies');
console.log('total quick replies:', qr.length);
for (const r of qr) {
  const { out, pats } = aplicar(r.body);
  if (out !== r.body) {
    console.log(`\n  [${pats.join(',')}] key=${r.key}`);
    console.log('   ANTES : ' + r.body.replace(/\n/g, ' ⏎ '));
    console.log('   DESPUES: ' + out.replace(/\n/g, ' ⏎ '));
  }
}

console.log('\n==================== B) PRODUCTOS (name + notes) ====================');
const prods = await q<any>('select name, notes from products');
console.log('total productos:', prods.length);
for (const p of prods) {
  for (const campo of [p.name, p.notes]) {
    if (!campo) continue;
    const { out, pats } = aplicar(campo);
    if (out !== campo) console.log(`  [${pats.join(',')}] "${campo}" -> "${out}"`);
  }
}

console.log('\n==================== C) CURSOS (name + description) ====================');
try {
  const cur = await q<any>('select name, description, location from courses');
  console.log('total cursos:', cur.length);
  for (const c of cur) {
    for (const campo of [c.name, c.description, c.location]) {
      if (!campo) continue;
      const { out, pats } = aplicar(campo);
      if (out !== campo) console.log(`  [${pats.join(',')}] "${campo}" -> "${out}"`);
    }
  }
} catch (e: any) {
  console.log('  (sin tabla courses)', e.message);
}

console.log('\n==================== D) SETTINGS / FICHA ====================');
const st = await q<any>('select key, value from settings');
for (const s of st) {
  const txt = typeof s.value === 'string' ? s.value : JSON.stringify(s.value);
  const { out, pats } = aplicar(txt);
  if (out !== txt) {
    console.log(`\n  [${pats.join(',')}] key=${s.key}`);
    // mostrar solo el entorno del cambio
    for (const [n, re, to] of CON_QUIEN_SE_CONSULTA) {
      re.lastIndex = 0;
      for (const m of txt.matchAll(re)) {
        const i = m.index ?? 0;
        console.log(`    ${n} [${m[0].trim()}] …${txt.slice(Math.max(0, i - 90), i + m[0].length + 90).replace(/\\n/g, ' ⏎ ')}…`);
      }
      void to;
    }
  }
}

// ============ E) MENSAJES ESCRITOS POR EL LOCAL (oráculo de castellano legítimo) ============
console.log('\n==================== E) MENSAJES DEL EQUIPO (humanos) ====================');
const hum = await q<any>(
  `select text from messages
    where direction='out' and author='human' and text is not null and text <> ''
      and created_at >= now() - interval '60 days'`,
);
console.log('mensajes humanos 60d:', hum.length);
let nHum = 0;
const vistos = new Set<string>();
for (const m of hum) {
  const { out, pats } = aplicar(m.text);
  if (out !== m.text) {
    nHum++;
    const k = m.text.slice(0, 120);
    if (vistos.has(k)) continue;
    vistos.add(k);
    console.log(`\n  [${pats.join(',')}]`);
    console.log('   ANTES : ' + m.text.replace(/\n/g, ' ⏎ ').slice(0, 300));
    console.log('   DESPUES: ' + out.replace(/\n/g, ' ⏎ ').slice(0, 300));
  }
}
console.log(`\n  total mensajes humanos tocados: ${nHum} de ${hum.length}`);

// ============ F) MENSAJES ENTRANTES (cómo habla el cliente) ============
console.log('\n==================== F) MENSAJES ENTRANTES DE CLIENTES ====================');
const ent = await q<any>(
  `select text from messages
    where direction='in' and text is not null and text <> ''
      and created_at >= now() - interval '60 days'`,
);
console.log('entrantes 60d:', ent.length);
let nEnt = 0;
const vistos2 = new Set<string>();
for (const m of ent) {
  const { out, pats } = aplicar(m.text);
  if (out !== m.text) {
    nEnt++;
    const k = m.text.slice(0, 100);
    if (vistos2.has(k)) continue;
    vistos2.add(k);
    console.log(`  [${pats.join(',')}] "${m.text.replace(/\n/g, ' ⏎ ').slice(0, 160)}" -> "${out.replace(/\n/g, ' ⏎ ').slice(0, 160)}"`);
  }
}
console.log(`  total entrantes tocados: ${nEnt}`);

await closeDb();
void TIMEZONE;
