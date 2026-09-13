import { openDb, q, closeDb } from './src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const SONDAS: Array<[string, RegExp, string]> = [
  ['J1 catalogo', /\s+en (?:el|nuestro|mi) cat[áa]logo\b/gi, ''],
  ['J2 sistema', /\s+en (?:el|nuestro|mi) sistema\b/gi, ''],
  ['J3 base', /\s+en (?:la|nuestra|mi) base(?: de datos)?\b/gi, ''],
  ['J4 lista disp', /\s+en (?:nuestra|mi|la) lista de disponibles\b/gi, ' disponible'],
  ['J5 panel', /\s+del panel\b/gi, ''],
  ['J6 tengo cargado', /\bno (?:lo |la |los |las )?tengo cargad[oa]s?\b/gi, 'no tenemos'],
];

// TODO el corpus, todos los autores y direcciones, sin ventana.
const msgs = await q<any>(
  `select direction, author, text from messages where content_kind='text' and text is not null`,
  [],
);
console.log('corpus completo (texto):', msgs.length);

for (const [nombre, re, to] of SONDAS) {
  const casos: string[] = [];
  let n = 0;
  for (const m of msgs) {
    re.lastIndex = 0;
    const hits = [...m.text.matchAll(re)];
    if (!hits.length) continue;
    n += hits.length;
    for (const h of hits) {
      const antes = m.text.slice(Math.max(0, h.index! - 70), h.index! + h[0].length + 60).replace(/\n/g, ' ⏎ ');
      const despues = (m.text.slice(0, h.index!) + to + m.text.slice(h.index! + h[0].length))
        .slice(Math.max(0, h.index! - 70), h.index! + to.length + 60)
        .replace(/\n/g, ' ⏎ ');
      if (casos.length < 12) casos.push(`      ${m.direction}/${m.author}\n        A: …${antes}…\n        D: …${despues}…`);
    }
  }
  console.log(`\n=== ${nombre}: ${n} ocurrencias en TODO el corpus ===`);
  for (const c of casos) console.log(c);
}

// "base" en sentido de reposteria, que J3 borraria si apareciera con preposicion
const base = await q<any>(
  `select direction, author, text from messages
   where content_kind='text' and text ~* '\\mbase\\M' limit 400`,
  [],
);
console.log(`\n=== la palabra "base" en el corpus: ${base.length} mensajes ===`);
let mostrados = 0;
for (const m of base) {
  const i = m.text.toLowerCase().search(/\bbase\b/);
  const frag = m.text.slice(Math.max(0, i - 60), i + 60).replace(/\n/g, ' ⏎ ');
  if (/base de datos/i.test(frag)) continue;
  if (mostrados++ < 18) console.log(`   ${m.direction}/${m.author}: …${frag}…`);
}
console.log(`   (no-"base de datos": ${mostrados})`);

await closeDb();
