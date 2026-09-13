import { openDb, q, closeDb, TIMEZONE } from './src/core/store/db.js';

// ---- Tablas propuestas, copiadas TAL CUAL de la propuesta ----------------

const JERGA_INTERNA_ARREGLADA: Array<[string, RegExp, string]> = [
  ['J1 catalogo', /\s+en (?:el|nuestro|mi) cat[áa]logo\b/gi, ''],
  ['J2 sistema', /\s+en (?:el|nuestro|mi) sistema\b/gi, ''],
  ['J3 base', /\s+en (?:la|nuestra|mi) base(?: de datos)?\b/gi, ''],
  ['J4 lista disp', /\s+en (?:nuestra|mi|la) lista de disponibles\b/gi, ' disponible'],
  ['J5 panel', /\s+del panel\b/gi, ''],
  ['J6 no tengo cargado', /\bno (?:lo |la |los |las )?tengo cargad[oa]s?\b/gi, 'no tenemos'],
];

const CON_QUIEN_SE_CONSULTA: Array<[string, RegExp, string]> = [
  ['C1 con el local/encargada/cocina', /\s+con\s+(?:el\s+local|la\s+encargada|cocina)\b(?!\s+y\s+con\b)/gi, ''],
  ['C2 a la encargada', /\s+a\s+la\s+encargada\b/gi, ''],
  ['C3 a/con alguien del local', /\s+(?:a|con)\s+(?:alguien|una\s+persona)\s+del\s+local\b/gi, ''],
  ['C4 al equipo del local', /\s+al\s+equipo\s+del\s+local\b/gi, ''],
  [
    'C5 verbo ... en el local',
    /(?<!\bte\s(?:lo|la|los|las)\s)\b((?:cheque|confirm|consult|revis|averigu)\w*(?:\s+[^\s.,;:!?¡¿]+){0,3}?)\s+en\s+el\s+local\b/gi,
    '$1',
  ],
  ['C6 en el local + verbo', /\ben\s+el\s+local\s+(?=(?:cheque|confirm|consult|revis|averigu)\w*\b)/gi, ''],
  [
    'C7 verbo ... cocina',
    /\b((?:cheque|confirm|consult|revis|averigu)\w*(?:\s+[^\s.,;:!?¡¿]+){0,3}?)\s+(?:en|de|desde|a)\s+cocina\b/gi,
    '$1',
  ],
  ['C8 de/desde cocina', /\s+(?:de|desde)\s+cocina\b/gi, ''],
];

const TODAS = [...JERGA_INTERNA_ARREGLADA, ...CON_QUIEN_SE_CONSULTA];

type Hit = { pat: string; antes: string; despues: string; frag: string };

function aplicar(texto: string): { out: string; hits: Hit[] } {
  let out = texto;
  const hits: Hit[] = [];
  for (const [nombre, re, to] of TODAS) {
    re.lastIndex = 0;
    const matches = [...out.matchAll(re)];
    const limpio = out.replace(re, to);
    if (limpio !== out) {
      for (const m of matches) {
        const ini = Math.max(0, (m.index ?? 0) - 60);
        const fin = Math.min(out.length, (m.index ?? 0) + m[0].length + 60);
        hits.push({
          pat: nombre,
          antes: out.slice(ini, fin).replace(/\n/g, ' ⏎ '),
          despues: '',
          frag: m[0],
        });
      }
      out = limpio;
    }
  }
  return { out, hits };
}

openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });

const DIAS = 14;

const msgs = await q<any>(
  `select id, conversation_id, author, direction, text,
          (created_at at time zone $1)::date as dia
     from messages
    where text is not null and text <> ''
      and created_at >= now() - interval '${DIAS} days'
    order by created_at`,
  [TIMEZONE],
);

const bot = msgs.filter((m: any) => m.direction === 'out' && m.author === 'bot');
const hum = msgs.filter((m: any) => m.direction === 'out' && m.author === 'human');
const ent = msgs.filter((m: any) => m.direction === 'in');

console.log(`=== CORPUS ${DIAS} dias ===`);
console.log('bot out:', bot.length, '| humano out:', hum.length, '| entrantes:', ent.length);
const dias = new Set(bot.map((m: any) => String(m.dia)));
console.log('dias distintos con mensajes del bot:', dias.size);

// ---- 1) Conteo por patron sobre mensajes del BOT ------------------------
const porPatron: Record<string, Hit[]> = {};
const msgsTocados = new Set<string>();
for (const m of bot) {
  const { hits } = aplicar(m.text);
  if (hits.length) msgsTocados.add(m.id);
  for (const h of hits) {
    (porPatron[h.pat] ||= []).push({ ...h, despues: m.conversation_id });
  }
}

console.log(`\n=== HITS POR PATRON (mensajes del bot, ${DIAS} dias) ===`);
let total = 0;
for (const [, re] of [] as any) void re;
for (const [nombre] of TODAS) {
  const n = (porPatron[nombre] ?? []).length;
  total += n;
  console.log(`  ${String(n).padStart(4)}  ${(n / dias.size).toFixed(1)}/dia   ${nombre}`);
}
console.log(`  ---- total coincidencias: ${total}`);
console.log(`  ---- mensajes tocados: ${msgsTocados.size} = ${(msgsTocados.size / dias.size).toFixed(1)}/dia`);

// ---- 2) TODOS los hits, patron por patron, con contexto -----------------
for (const [nombre] of TODAS) {
  const hs = porPatron[nombre] ?? [];
  if (!hs.length) continue;
  console.log(`\n\n########## ${nombre} — ${hs.length} coincidencias ##########`);
  for (const h of hs) {
    console.log(`  · [${h.frag.trim()}] …${h.antes}…`);
  }
}

await closeDb();
