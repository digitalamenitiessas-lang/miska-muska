import { openDb, q, closeDb, TIMEZONE } from './src/core/store/db.js';
import { ofreceLoQueNoHay as ofreceREPO } from './src/core/policies/stock.js';
import { seEncargaConAnticipacion } from './src/core/policies/rules.js';
import fs from 'node:fs';

openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });

function plano(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const MARCA = String.fromCharCode(0);
function oraciones(t: string): string[] {
  return t
    .replace(/(\d)\.(\d)/g, `$1${MARCA}$2`)
    .split(/[.!?\n]+/)
    .map((o) => o.split(MARCA).join('.'))
    .filter((o) => o.trim());
}
const RELLENO = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'y', 'en', 'por', 'para', 'un', 'una']);
const clavesDe = (n: string) => plano(n).split(' ').filter((p) => p.length >= 3 && !RELLENO.has(p));

const DICE_VIEJO =
  /\b(no (nos )?(hay|queda|quedan|tenemos|nos quedo|tengo)|se (nos )?(agoto|agotaron|termino|terminaron)|agotad[oa]s?|sin stock|nos quedamos sin|ya no (hay|queda|tenemos)|todavia no (esta|hay)|vuelve a haber|apenas (vuelva|tengamos))\b/;
const DICE_NUEVO =
  /\b(no (nos |los |las |lo |la |te |me )*(hay|queda|quedan|quedo|quedaron|tenemos|tengo)|no (esta|estan) disponible|(esta|estan|figura|figuran) (sin stock|agotad)|se (nos )?(agoto|agotaron|termino|terminaron)|agotad[oa]s?|sin stock|nos quedamos sin|ya no (hay|queda|tenemos)|todavia no (esta|hay)|vuelve a haber|apenas (vuelva|tengamos)|queda (afuera|fuera))\b/;
const PIDE_LA_PLATA = /\b(alias|transferi|transferencia|comprobante|senia|sena)\b/;
const NOMBRA_UN_DESAYUNO = /\b(desayuno|desayunos|box|boxes)\b/;
const VA_A_COBRAR =
  /\b(transferi|transferencia|alias|comprobante|senia|sena|te lo (anoto|reservo|encargo|guardo|separo)|quedo (anotado|reservado)|para confirmar|lo confirmamos)\b/;

interface P { id: string; name: string }
function ofreceCon(re: RegExp, texto: string, apagados: P[]) {
  if (!texto.trim() || !apagados.length) return [] as { id: string; name: string; oracion: string }[];
  const out: { id: string; name: string; oracion: string }[] = [];
  const vistos = new Set<string>();
  for (const o of oraciones(texto)) {
    const p = plano(o);
    if (re.test(p)) continue;
    for (const prod of apagados) {
      if (vistos.has(prod.id)) continue;
      const cl = clavesDe(prod.name);
      if (!cl.length) continue;
      if (cl.every((c) => p.includes(c))) {
        vistos.add(prod.id);
        out.push({ id: prod.id, name: prod.name, oracion: o.trim() });
      }
    }
  }
  return out;
}
function cobraLoQueNoHay(texto: string, apagadosDeMostrador: P[]) {
  if (!PIDE_LA_PLATA.test(plano(texto))) return [];
  const ofrecidos = ofreceCon(DICE_NUEVO, texto, apagadosDeMostrador);
  if (!ofrecidos.length) return [];
  if (NOMBRA_UN_DESAYUNO.test(plano(texto))) return ofrecidos.filter((o) => !/mini\s*torta/i.test(o.name));
  return ofrecidos;
}

const prods = await q<any>(`select id, name, category, available_today, updated_at from products`);
const apagadosTodos: P[] = prods.filter((p: any) => !p.available_today).map((p: any) => ({ id: p.id, name: p.name }));
const apagadosMostrador: P[] = prods
  .filter((p: any) => !p.available_today && !seEncargaConAnticipacion(p.category))
  .map((p: any) => ({ id: p.id, name: p.name }));
console.log(`apagados total=${apagadosTodos.length} mostrador=${apagadosMostrador.length}`);
console.log('mostrador apagados:', apagadosMostrador.map((p) => p.name).join(' | '));

const msgs = await q<any>(
  `select m.id, m.conversation_id, m.text, m.created_at,
     to_char(m.created_at at time zone $1, 'DD/MM HH24:MI') cuando,
     to_char(m.created_at at time zone $1, 'YYYY-MM-DD') dia
   from messages m
   where m.direction='out' and m.author='bot' and m.content_kind='text' and m.text is not null
     and (m.created_at at time zone $1)::date >= (now() at time zone $1)::date - 6
   order by m.created_at`,
  [TIMEZONE],
);
console.log(`mensajes bot 7 dias = ${msgs.length}`);

let anchoRepo = 0,
  anchoNuevo = 0,
  conPlataAncho = 0,
  mostrador = 0;
const hits: any[] = [];
const rescatados: any[] = [];
for (const m of msgs) {
  if (ofreceREPO(m.text, apagadosTodos).length) anchoRepo++;
  const an = ofreceCon(DICE_NUEVO, m.text, apagadosTodos);
  if (an.length) anchoNuevo++;
  if (an.length && VA_A_COBRAR.test(plano(m.text))) conPlataAncho++;
  const c = cobraLoQueNoHay(m.text, apagadosMostrador);
  if (c.length) {
    mostrador++;
    hits.push({ ...m, prods: c.map((x: any) => x.name) });
  }
  // los que el regex viejo marcaba de mas y el nuevo deja pasar
  const viejo = ofreceCon(DICE_VIEJO, m.text, apagadosTodos);
  if (viejo.length && !an.length) rescatados.push({ cuando: m.cuando, text: m.text.slice(0, 180) });
}
const dias = 7;
console.log(`\n--- por dia (${dias} dias) ---`);
console.log(`ofreceLoQueNoHay REPO (todos apagados)   ${anchoRepo}  = ${(anchoRepo / dias).toFixed(1)}/dia`);
console.log(`ofreceLoQueNoHay con DICE_NUEVO          ${anchoNuevo}  = ${(anchoNuevo / dias).toFixed(1)}/dia`);
console.log(`  + vaACobrar (ancho, todos)             ${conPlataAncho}  = ${(conPlataAncho / dias).toFixed(1)}/dia`);
console.log(`GUARDA PROPUESTA (plata + mostrador)     ${mostrador}  = ${(mostrador / dias).toFixed(1)}/dia`);
console.log(`\nregex viejo marcaba de mas (rescatados por DICE_NUEVO): ${rescatados.length}`);

const porDia: Record<string, number> = {};
for (const h of hits) porDia[h.dia] = (porDia[h.dia] ?? 0) + 1;
console.log('hits por dia:', JSON.stringify(porDia));

fs.writeFileSync('./zz-hits.json', JSON.stringify(hits, null, 1));
fs.writeFileSync('./zz-rescatados.json', JSON.stringify(rescatados, null, 1));
console.log(`guardados ${hits.length} hits`);
await closeDb();
