/*
  La guarda de encargos: vieja contra nueva, mensaje por mensaje.

  Es una guarda DURA —reemplaza el mensaje y escala— así que lo que hay que
  mirar no es cuántas frena sino CUÁLES deja de frenar. Cada una tiene que ser
  una venta de mostrador, y ni una sola una torta.
*/
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { comprometeEncargo } from '../src/core/policies/encargos.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

/* ── La guarda VIEJA, copiada tal cual era ──────────────────────────────── */
const plano = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const MINI = /\bmini\s+[a-záéíóúñ]+/g;
const ES_ENCARGO = /\b(torta|tortas|chocotorta|tarta|tartas|red velvet|desayuno|desayunos)\b/;
const SE_COMPROMETE = [
  /\b(queda|quedo|quedas) (anotad|reservad|confirmad|guardad)/,
  /\bya (te )?(la|lo) (tenemos|anotamos|reservamos|confirmamos)\b/,
  /\b(anotad|reservad|confirmad)[oa] (para|el|tu)\b/,
  /\bte (la|lo) (esperamos|tenemos) (para|el)\b/,
  /\bte (la|lo) confirmo\b(?!\s+(en|cuando|apenas|ni bien|mas tarde|despues|ahora|ya))/,
  /\bconfirmad[oa]\b[^.!?]{0,30}\b(para el|para la|para manana|para hoy)\b/,
  /\blisto[,!]? (ya )?(queda|te la|te lo)\b/,
];
const PIDE_PLATA = [
  /\bel alias es\b/,
  /\bte paso el alias\b/,
  /\balias:?\s*miska/,
  /\b(seña|senia|sena) (es|de|por)\b/,
  /\bmonto de la (seña|senia|sena)\b/,
];
function vieja(texto: string, contexto: string): string | null {
  const t = plano(texto).replace(MINI, ' ');
  const ctx = plano(contexto).replace(MINI, ' ');
  if (!ES_ENCARGO.test(t) && !ES_ENCARGO.test(ctx)) return null;
  if (SE_COMPROMETE.find((re) => re.test(t))) return 'lo dio por anotado';
  if (PIDE_PLATA.find((re) => re.test(t))) return 'pidió la transferencia';
  return null;
}

const msgs = await q<any>(
  `SELECT to_char(created_at AT TIME ZONE $1,'DD/MM HH24:MI') t, text, conversation_id c, created_at
     FROM messages
    WHERE direction='out' AND author='bot' AND text IS NOT NULL
      AND created_at > now() - interval '14 days'
    ORDER BY created_at ASC`,
  [TIMEZONE],
);

const contextos = new Map<string, string[]>();
const previos = await q<any>(
  `SELECT conversation_id c, coalesce(text,'') text FROM messages
    WHERE created_at > now() - interval '15 days' ORDER BY created_at ASC`,
);
for (const p of previos) {
  const l = contextos.get(p.c) ?? [];
  l.push(p.text);
  contextos.set(p.c, l);
}

let antes = 0;
let ahora = 0;
const dejaDeFrenar: any[] = [];
const empiezaAFrenar: any[] = [];

for (const m of msgs) {
  const lista = contextos.get(m.c) ?? [];
  const ctx = lista.slice(-2).join(' ');
  /* La ventana ancha, igual que la calcula el pipeline. */
  const hayCookies = /\bcookies?\b/i.test(lista.slice(-10).join(' ') + m.text);
  const v = vieja(m.text, ctx);
  const n = comprometeEncargo(m.text, false, ctx, hayCookies);
  if (v) antes++;
  if (n) ahora++;
  if (v && !n) dejaDeFrenar.push({ ...m, ctx, motivo: v });
  if (!v && n) empiezaAFrenar.push({ ...m, motivo: n.motivo });
}

console.log(`\n  ${msgs.length} mensajes del bot, 14 días.`);
console.log(`  Frenaba ${antes}. Ahora frena ${ahora}.\n`);
console.log(`  ═══ DEJA DE FRENAR ${dejaDeFrenar.length} ═══`);
console.log('  Cada una tiene que ser mostrador. Si hay una torta, el cambio está mal.\n');
for (const x of dejaDeFrenar) {
  /*
    Se descuenta el "mini" antes de marcar, igual que hace la guarda. Sin eso,
    una "Mini torta Kinder" —que se vende del stock del día como una cookie—
    aparece marcada como torta y la revisión arranca con un susto falso. Me
    pasó en la primera corrida de esto.
  */
  const hayTorta = /\b(torta|tarta|desayuno)/i.test(plano(x.text).replace(MINI, ' '));
  console.log(`  ${hayTorta ? '⚠ TORTA' : '  ok   '} ${x.t}  (${x.motivo})`);
  console.log(`     ${x.text.replace(/\s+/g, ' ').slice(0, 170)}`);
  console.log(`     ctx: ${String(x.ctx).replace(/\s+/g, ' ').slice(0, 150)}\n`);
}
console.log(`  ═══ EMPIEZA A FRENAR ${empiezaAFrenar.length} ═══\n`);
for (const x of empiezaAFrenar.slice(0, 5)) {
  console.log(`  ${x.t}  ${x.text.replace(/\s+/g, ' ').slice(0, 170)}\n`);
}

await closeDb();
