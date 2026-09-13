import { openDb, q, closeDb, TIMEZONE } from './src/core/store/db.js';

function plano(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
const DICE_QUE_NO_HAY_NUEVO =
  /\b(no (nos |los |las |lo |la |te |me )*(hay|queda|quedan|quedo|quedaron|tenemos|tengo)|no (esta|estan) disponible|(esta|estan|figura|figuran) (sin stock|agotad)|se (nos )?(agoto|agotaron|termino|terminaron)|agotad[oa]s?|sin stock|nos quedamos sin|ya no (hay|queda|tenemos)|todavia no (esta|hay)|vuelve a haber|apenas (vuelva|tengamos)|queda (afuera|fuera))\b/;
const MARCA = String.fromCharCode(0);
function oraciones(t: string): string[] {
  return t.replace(/(\d)\.(\d)/g, '$1' + MARCA + '$2').split(/[.!?\n]+/).map((o) => o.split(MARCA).join('.')).filter((o) => o.trim());
}
const RELLENO = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'y', 'en', 'por', 'para', 'un', 'una']);
function clavesDe(n: string): string[] {
  return plano(n).split(' ').filter((p) => p.length >= 3 && !RELLENO.has(p));
}
const PIDE_LA_PLATA = /\b(alias|transferi|transferencia|comprobante|senia|sena)\b/;
const NOMBRA_UN_DESAYUNO = /\b(desayuno|desayunos|box|boxes)\b/;
type Prod = { id: string; name: string };
function ofrece(texto: string, apagados: Prod[]) {
  if (!texto.trim() || !apagados.length) return [] as any[];
  const out: any[] = []; const vistos = new Set<string>();
  for (const o of oraciones(texto)) {
    const p = plano(o);
    if (DICE_QUE_NO_HAY_NUEVO.test(p)) continue;
    for (const prod of apagados) {
      if (vistos.has(prod.id)) continue;
      const cl = clavesDe(prod.name);
      if (cl.length && cl.every((c) => p.includes(c))) { vistos.add(prod.id); out.push({ ...prod, oracion: o.trim() }); }
    }
  }
  return out;
}
function cobra(texto: string, apagados: Prod[]) {
  if (!PIDE_LA_PLATA.test(plano(texto))) return [] as any[];
  const of = ofrece(texto, apagados);
  if (!of.length) return [] as any[];
  if (NOMBRA_UN_DESAYUNO.test(plano(texto))) return of.filter((o: any) => !/mini\s*torta/i.test(o.name));
  return of;
}

openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const prods = await q<any>('select id, name, category, available_today from products');
const ANTICIPA = new Set(['tortas', 'desayunos']);
const mostrador = prods.filter((p: any) => !ANTICIPA.has(String(p.category).toLowerCase()));
const offHoy: Prod[] = mostrador.filter((p: any) => !p.available_today).map((p: any) => ({ id: p.id, name: p.name }));
const byName = (n: string) => { const p = mostrador.find((x: any) => x.name === n); return { id: p.id, name: p.name }; };

const msgs = await q<any>(
  `select m.id, m.conversation_id, m.text, (m.created_at at time zone $1) as local
     from messages m
    where m.direction='out' and m.author='bot' and m.text is not null
      and m.created_at >= now() - interval '14 days' order by m.created_at`, [TIMEZONE]);

function tasa(off: Prod[], dias = 14) {
  let n = 0;
  for (const m of msgs) if (cobra(m.text, off).length) n++;
  return { n, dia: +(n / dias).toFixed(1) };
}
console.log('ESCENARIOS (14 dias, 11.580 mensajes del bot):');
console.log(' apagados de HOY (25 de mostrador) ..........', JSON.stringify(tasa(offHoy)));
const masCookies = offHoy.concat(['Cookie nutella', 'Cookie ferrero', 'Cookie dubai'].map(byName));
console.log(' + se acaban nutella/ferrero/dubai ..........', JSON.stringify(tasa(masCookies)));
const masChipa = offHoy.concat([byName('Chipa x3'), byName('Chipá (por unidad)')]);
console.log(' + se acaban los chipa ......................', JSON.stringify(tasa(masChipa)));
const todoOff: Prod[] = mostrador.map((p: any) => ({ id: p.id, name: p.name }));
console.log(' TODO el mostrador apagado (techo) ..........', JSON.stringify(tasa(todoOff)));

// ---- LOS TRES FALSOS POSITIVOS ESTRUCTURALES, uno por uno ----
function probar(titulo: string, texto: string, off: string[]) {
  const r = cobra(texto, off.map(byName));
  console.log('\n### ' + titulo);
  console.log('  apagado(s) simulado(s): ' + off.join(', '));
  console.log('  BLOQUEA: ' + (r.length ? 'SI -> ' + r.map((x: any) => x.name + ' <= "' + x.oracion + '"').join(' | ') : 'no'));
}
const fp1 = 'Perfecto, la Cookie nutella y oreo está a $5.000.\n\nTe paso el alias para que hagas la transferencia: miskapedidos (Mathias Exequiel Lovey).';
probar('FP1 vende "Cookie nutella y oreo" (disponible) y se apago la "Cookie nutella"', fp1, ['Cookie nutella']);
const fp2a = 'Entonces el total con el sanguchito en pan de chipá queda en $25.300.\n\nTe paso el alias: miskapedidos.';
probar('FP2a vende el sanguchito en pan de chipa y se apago "Chipa x3"', fp2a, ['Chipa x3']);
const fp2b = 'El total sería $11.200 (chipá + cookie de nutella + brownie clásico).\n\nPara confirmar el pedido te paso el alias: miskapedidos.';
probar('FP2b vende "Chipa (por unidad)" y se apago "Chipa x3"', fp2b, ['Chipa x3']);
const fp3 = 'Desayuno "buen día" (mini torta tres leches, cookie kinder, taza con el diseño que elegiste) — $46.000.\n\nPara confirmarlo te paso el alias: miskapedidos.';
probar('FP3 vende un DESAYUNO y describe lo que trae; la cookie kinder esta apagada HOY', fp3, ['Cookie kinder', 'Mini torta Tres leches']);
const fp4 = 'Genial! Entonces son 2 cookies (red velvet y nutella y oreo) + 1 mini torta Kinder, total $25.300.\n\nTe paso el alias: miskapedidos.';
probar('FP4 vende "Mini torta Kinder" (disponible) y "Cookie nutella y oreo"; se apago la "Cookie nutella"', fp4, ['Cookie nutella']);

await closeDb();
