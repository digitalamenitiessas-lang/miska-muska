import { openDb, q, closeDb, TIMEZONE } from './src/core/store/db.js';
import { seEncargaConAnticipacion } from './src/core/policies/rules.js';

openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });

function plano(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
const MARCA = String.fromCharCode(0);
const oraciones = (t: string) => t.replace(/(\d)\.(\d)/g, `$1${MARCA}$2`).split(/[.!?\n]+/)
  .map((o) => o.split(MARCA).join('.')).filter((o) => o.trim());
const RELLENO = new Set(['de','del','la','el','los','las','con','y','en','por','para','un','una']);
const clavesDe = (n: string) => plano(n).split(' ').filter((p) => p.length >= 3 && !RELLENO.has(p));
const DICE_NUEVO = /\b(no (nos |los |las |lo |la |te |me )*(hay|queda|quedan|quedo|quedaron|tenemos|tengo)|no (esta|estan) disponible|(esta|estan|figura|figuran) (sin stock|agotad)|se (nos )?(agoto|agotaron|termino|terminaron)|agotad[oa]s?|sin stock|nos quedamos sin|ya no (hay|queda|tenemos)|todavia no (esta|hay)|vuelve a haber|apenas (vuelva|tengamos)|queda (afuera|fuera))\b/;
const PIDE_LA_PLATA = /\b(alias|transferi|transferencia|comprobante|senia|sena)\b/;
const NOMBRA_UN_DESAYUNO = /\b(desayuno|desayunos|box|boxes)\b/;

interface P { id: string; name: string }
function cobra(texto: string, apagados: P[]) {
  if (!PIDE_LA_PLATA.test(plano(texto))) return [] as P[];
  const out: P[] = []; const vistos = new Set<string>();
  for (const o of oraciones(texto)) {
    const p = plano(o);
    if (DICE_NUEVO.test(p)) continue;
    for (const prod of apagados) {
      if (vistos.has(prod.id)) continue;
      const cl = clavesDe(prod.name);
      if (cl.length && cl.every((c) => p.includes(c))) { vistos.add(prod.id); out.push(prod); }
    }
  }
  if (!out.length) return [];
  if (NOMBRA_UN_DESAYUNO.test(plano(texto))) return out.filter((x) => !/mini\s*torta/i.test(x.name));
  return out;
}

const prods = await q<any>(`select id, name, category, available_today from products`);
const apagados: P[] = prods.filter((p: any) => !p.available_today && !seEncargaConAnticipacion(p.category))
  .map((p: any) => ({ id: p.id, name: p.name }));

const msgs = await q<any>(
  `select m.id, m.conversation_id, m.text, m.created_at, to_char(m.created_at at time zone $1,'DD/MM HH24:MI') cuando
   from messages m
   where m.direction='out' and m.author='bot' and m.content_kind='text' and m.text is not null
     and (m.created_at at time zone $1)::date >= (now() at time zone $1)::date - 6
   order by m.created_at`, [TIMEZONE]);

let conVentaBuena = 0, conVentaEntregada = 0, sinVenta = 0, total = 0;
const det: string[] = [];
for (const m of msgs) {
  const c = cobra(m.text, apagados);
  if (!c.length) continue;
  total++;
  const ords = await q<any>(
    `select number, status, paid, total, created_by, items,
            to_char(created_at at time zone $3,'DD/MM HH24:MI') cuando
       from orders where conversation_id=$1 and created_at >= $2 and created_at < $2 + interval '12 hours'
       order by created_at`, [m.conversation_id, m.created_at, TIMEZONE]);
  const conProd = ords.filter((o: any) =>
    (o.items ?? []).some((i: any) => c.some((p) => p.id === i.productId)));
  if (conProd.length) {
    conVentaBuena++;
    const entregado = conProd.some((o: any) => o.status === 'entregado');
    if (entregado) conVentaEntregada++;
    det.push(`  [${m.cuando}] ${c.map((x) => x.name).join(', ')} -> pedido ${conProd.map((o: any) => `${o.number} ${o.status} $${o.total} pagado=${o.paid} por=${o.created_by}`).join(' | ')}`);
  } else sinVenta++;
}
console.log(`hits=${total}`);
console.log(`  el pedido SI se cargo despues con el producto adentro : ${conVentaBuena}`);
console.log(`  y de esos, terminaron ENTREGADOS                      : ${conVentaEntregada}`);
console.log(`  no hubo pedido con ese producto despues              : ${sinVenta}`);
console.log(det.join('\n'));
await closeDb();
