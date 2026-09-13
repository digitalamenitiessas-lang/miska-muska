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

const soloEsta = process.argv[2];

const msgs = await q<any>(
  `select id, text from messages
   where direction='out' and author='bot' and content_kind='text'
     and created_at >= now() - interval '14 days' and text is not null
   order by created_at`,
  [],
);

function recorte(t: string, i: number, len: number): string {
  const a = Math.max(0, i - 70);
  const b = Math.min(t.length, i + len + 70);
  return (a ? '…' : '') + t.slice(a, b).replace(/\n/g, ' ⏎ ') + (b < t.length ? '…' : '');
}

const vistos = new Map<string, number>();
let n = 0;
for (const m of msgs) {
  for (const [re, to, et] of CON_QUIEN) {
    if (soloEsta && et !== soloEsta) continue;
    re.lastIndex = 0;
    const matches = [...m.text.matchAll(re)];
    if (!matches.length) continue;
    for (const mm of matches) {
      const frag = mm[0];
      const ctx = m.text.slice(Math.max(0, mm.index! - 30), mm.index! + frag.length);
      const clave = et + '|' + ctx.toLowerCase().replace(/\s+/g, ' ').trim();
      vistos.set(clave, (vistos.get(clave) ?? 0) + 1);
      if ((vistos.get(clave) ?? 0) > 1) continue; // 1 ejemplo por contexto
      n++;
      const antes = recorte(m.text, mm.index!, frag.length);
      const despues = recorte(
        m.text.slice(0, mm.index!) + frag.replace(re, to) + m.text.slice(mm.index! + frag.length),
        mm.index!,
        frag.replace(re, to).length,
      );
      console.log(`\n[${et}] ANTES : ${antes}`);
      console.log(`      DESPUES: ${despues}`);
    }
  }
}
console.log('\n--- formas distintas por patron ---');
const porPat = new Map<string, number>();
for (const [k, c] of vistos) {
  const et = k.split('|')[0];
  porPat.set(et, (porPat.get(et) ?? 0) + c);
}
for (const [k, c] of [...porPat].sort()) console.log(` ${k}: ${c} ocurrencias`);

await closeDb();
