import { openDb, q, closeDb, TIMEZONE } from './src/core/store/db.js';
import { seEncargaConAnticipacion } from './src/core/policies/rules.js';

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
const oraciones = (t: string) =>
  t
    .replace(/(\d)\.(\d)/g, `$1${MARCA}$2`)
    .split(/[.!?\n]+/)
    .map((o) => o.split(MARCA).join('.'))
    .filter((o) => o.trim());
const RELLENO = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'y', 'en', 'por', 'para', 'un', 'una']);
const clavesDe = (n: string) => plano(n).split(' ').filter((p) => p.length >= 3 && !RELLENO.has(p));

const DICE_NUEVO =
  /\b(no (nos |los |las |lo |la |te |me )*(hay|queda|quedan|quedo|quedaron|tenemos|tengo)|no (esta|estan) disponible|(esta|estan|figura|figuran) (sin stock|agotad)|se (nos )?(agoto|agotaron|termino|terminaron)|agotad[oa]s?|sin stock|nos quedamos sin|ya no (hay|queda|tenemos)|todavia no (esta|hay)|vuelve a haber|apenas (vuelva|tengamos)|queda (afuera|fuera))\b/;
const PIDE_LA_PLATA = /\b(alias|transferi|transferencia|comprobante|senia|sena)\b/;
const NOMBRA_UN_DESAYUNO = /\b(desayuno|desayunos|box|boxes)\b/;

interface P { id: string; name: string; updated: Date }
function ofreceCon(texto: string, apagados: P[]) {
  if (!texto.trim() || !apagados.length) return [] as P[];
  const out: P[] = [];
  const vistos = new Set<string>();
  for (const o of oraciones(texto)) {
    const p = plano(o);
    if (DICE_NUEVO.test(p)) continue;
    for (const prod of apagados) {
      if (vistos.has(prod.id)) continue;
      const cl = clavesDe(prod.name);
      if (cl.length && cl.every((c) => p.includes(c))) {
        vistos.add(prod.id);
        out.push(prod);
      }
    }
  }
  return out;
}
function cobra(texto: string, apagados: P[]) {
  if (!PIDE_LA_PLATA.test(plano(texto))) return [] as P[];
  const o = ofreceCon(texto, apagados);
  if (!o.length) return [] as P[];
  if (NOMBRA_UN_DESAYUNO.test(plano(texto))) return o.filter((x) => !/mini\s*torta/i.test(x.name));
  return o;
}

const prods = await q<any>(`select id, name, category, available_today, updated_at from products`);
const apagados: P[] = prods
  .filter((p: any) => !p.available_today && !seEncargaConAnticipacion(p.category))
  .map((p: any) => ({ id: p.id, name: p.name, updated: new Date(p.updated_at) }));

const msgs = await q<any>(
  `select m.id, m.conversation_id, m.text, m.created_at,
     to_char(m.created_at at time zone $1,'DD/MM HH24:MI') cuando
   from messages m
   where m.direction='out' and m.author='bot' and m.content_kind='text' and m.text is not null
     and (m.created_at at time zone $1)::date >= (now() at time zone $1)::date - 6
   order by m.created_at`,
  [TIMEZONE],
);

const hits: any[] = [];
let ciertos = 0;
for (const m of msgs) {
  const c = cobra(m.text, apagados);
  if (!c.length) continue;
  // "cierto": el producto no se toco DESPUES del mensaje, asi que el apagado de hoy ya regia
  const seguro = c.filter((p) => p.updated.getTime() <= new Date(m.created_at).getTime());
  if (seguro.length) ciertos++;
  hits.push({ ...m, prods: c.map((x) => x.name), seguro: seguro.map((x) => x.name) });
}
console.log(`mensajes=${msgs.length}  hits=${hits.length} (${(hits.length / 7).toFixed(1)}/dia)`);
console.log(`hits donde el apagado YA regia (updated_at <= mensaje) = ${ciertos} (${(ciertos / 7).toFixed(1)}/dia)`);

// hayHumano en la MISMA ventana que ve el pipeline
let en40 = 0;
let en2h = 0;
const lineas: string[] = [];
for (const h of hits) {
  const ventana = await q<any>(
    `select author, direction, text, created_at from
      (select * from messages where conversation_id=$1 and created_at < $2
       order by created_at desc limit 40) t order by created_at asc`,
    [h.conversation_id, h.created_at],
  );
  const humanos = ventana.filter((m: any) => m.direction === 'out' && m.author === 'human');
  if (humanos.length) {
    en40++;
    const u = humanos[humanos.length - 1];
    const min = Math.round((new Date(h.created_at).getTime() - new Date(u.created_at).getTime()) / 60000);
    if (min <= 120) en2h++;
    lineas.push(
      `  [${h.cuando}] ${h.prods.join(', ')} | persona hablo ${min} min antes: "${String(u.text ?? '').slice(0, 130).replace(/\n/g, ' ')}"`,
    );
  }
}
console.log(`\nhayHumano (ventana real de 40 msjs, como comprometeEncargo): ${en40} de ${hits.length}`);
console.log(`  de esos, la persona hablo hace menos de 2h: ${en2h}`);
console.log(lineas.join('\n'));
await closeDb();
