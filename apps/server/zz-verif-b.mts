import { openDb, q, closeDb, TIMEZONE } from './src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

// ---- tablas EXACTAS de la propuesta -----------------------------------------

const JERGA_ARREGLADA: Array<[RegExp, string, string]> = [
  [/\s+en (?:el|nuestro|mi) cat[áa]logo\b/gi, '', 'J1 catalogo'],
  [/\s+en (?:el|nuestro|mi) sistema\b/gi, '', 'J2 sistema'],
  [/\s+en (?:la|nuestra|mi) base(?: de datos)?\b/gi, '', 'J3 base'],
  [/\s+en (?:nuestra|mi|la) lista de disponibles\b/gi, ' disponible', 'J4 lista disp'],
  [/\s+del panel\b/gi, '', 'J5 panel'],
  [/\bno (?:lo |la |los |las )?tengo cargad[oa]s?\b/gi, 'no tenemos', 'J6 tengo cargado'],
];

const CON_QUIEN: Array<[RegExp, string, string]> = [
  [/\s+con\s+(?:el\s+local|la\s+encargada|cocina)\b(?!\s+y\s+con\b)/gi, '', 'C1 con el local/encargada/cocina'],
  [/\s+a\s+la\s+encargada\b/gi, '', 'C2 a la encargada'],
  [/\s+(?:a|con)\s+(?:alguien|una\s+persona)\s+del\s+local\b/gi, '', 'C3 a/con alguien del local'],
  [/\s+al\s+equipo\s+del\s+local\b/gi, '', 'C4 al equipo del local'],
  [
    /(?<!\bte\s(?:lo|la|los|las)\s)\b((?:cheque|confirm|consult|revis|averigu)\w*(?:\s+[^\s.,;:!?¡¿]+){0,3}?)\s+en\s+el\s+local\b/gi,
    '$1',
    'C5 verbo ... en el local',
  ],
  [/\ben\s+el\s+local\s+(?=(?:cheque|confirm|consult|revis|averigu)\w*\b)/gi, '', 'C6 en el local + verbo'],
  [
    /\b((?:cheque|confirm|consult|revis|averigu)\w*(?:\s+[^\s.,;:!?¡¿]+){0,3}?)\s+(?:en|de|desde|a)\s+cocina\b/gi,
    '$1',
    'C7 verbo ... cocina',
  ],
  [/\s+(?:de|desde)\s+cocina\b/gi, '', 'C8 de/desde cocina'],
];

const MARCADORES_INTERNOS: Array<[RegExp, string]> = [
  [/\[\s*operador del local\s*\]\s*/gi, ''],
  [/\bel operador del local\b/gi, 'el local'],
  [/\b(?:un|el) operador\b(?! del)/gi, 'el local'],
  [/\[\s*(?:hoy|ayer)\s*\]\s*/gi, ''],
  [/\[\s*el \d{1,2}\/\d{1,2}\/\d{4}\s*\]\s*/gi, ''],
];

type Hit = { etiqueta: string; antes: string; despues: string };

function correr(text: string): { out: string; hits: Hit[] } {
  let out = text;
  const hits: Hit[] = [];
  for (const [re, to] of MARCADORES_INTERNOS) out = out.replace(re, to);
  for (const [re, to, etiqueta] of JERGA_ARREGLADA) {
    const limpio = out.replace(re, to);
    if (limpio !== out) {
      hits.push({ etiqueta, antes: out, despues: limpio });
      out = limpio;
    }
  }
  for (const [re, to, etiqueta] of CON_QUIEN) {
    const limpio = out.replace(re, to);
    if (limpio !== out) {
      hits.push({ etiqueta, antes: out, despues: limpio });
      out = limpio;
    }
  }
  return { out, hits };
}

// ---- corpus ------------------------------------------------------------------

const msgs = await q<any>(
  `select id, conversation_id, text, (created_at at time zone $1)::date as dia
   from messages
   where direction='out' and author='bot' and content_kind='text'
     and created_at >= now() - interval '14 days'
     and text is not null
   order by created_at`,
  [TIMEZONE],
);
console.log('mensajes bot texto 14d:', msgs.length);

const porEtiqueta = new Map<string, Hit[]>();
let tocados = 0;
const tocadosPorDia = new Map<string, number>();
const noIdempotentes: any[] = [];

for (const m of msgs) {
  const { out, hits } = correr(m.text);
  if (!hits.length) continue;
  tocados++;
  const dia = m.dia.toISOString().slice(0, 10);
  tocadosPorDia.set(dia, (tocadosPorDia.get(dia) ?? 0) + 1);
  for (const h of hits) {
    if (!porEtiqueta.has(h.etiqueta)) porEtiqueta.set(h.etiqueta, []);
    porEtiqueta.get(h.etiqueta)!.push({ ...h, antes: m.text, despues: out });
  }
  // idempotencia
  const seg = correr(out).out;
  if (seg !== out) noIdempotentes.push({ uno: out, dos: seg });
  // higiene de texto
}

console.log('\n=== TOTAL ===');
console.log('mensajes tocados:', tocados, ' -> por dia:', (tocados / 14).toFixed(1));
console.log('\npor dia:');
for (const [d, n] of [...tocadosPorDia].sort()) console.log(`  ${d}  ${n}`);

console.log('\n=== POR PATRON (cuantos mensajes toca cada uno) ===');
const orden = [...porEtiqueta.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [et, hs] of orden) console.log(`  ${hs.length.toString().padStart(4)}  ${et}   (${(hs.length / 14).toFixed(1)}/dia)`);

console.log('\n=== HIGIENE: resultados con problemas evidentes ===');
let raros = 0;
for (const [, hs] of orden) {
  for (const h of hs) {
    const t = h.despues;
    if (/\s{2,}/.test(t) || /\s+[,.;:]/.test(t) || /\b(con|de|en|a|para|por|y)\s*[.,!?]/i.test(t)) {
      raros++;
      if (raros <= 15) console.log(`  [${h.etiqueta}] ${JSON.stringify(t.slice(0, 160))}`);
    }
  }
}
console.log('  total con espacio doble / preposicion colgada:', raros);
console.log('  no idempotentes:', noIdempotentes.length);

await closeDb();
