/**
 * El tip de las cookies: los casos armados y, sobre todo, el corpus real.
 *
 * Lo que hay que medir acá no es que el tip salga —eso es una línea de código—
 * sino DÓNDE saldría. Se pega al final de lo último que dice el bot después de
 * un comprobante, así que un falso positivo es un consejo sobre cookies colgado
 * de un mensaje que hablaba de otra cosa, en el chat de una clienta.
 *
 * Se reconstruye conversación por conversación: qué pedidos tenía abiertos, en
 * qué momento entró la foto y si alguien ya había dicho lo del microondas.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-tip-cookies.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import {
  elComprobanteEntroRecien,
  tipDeCookies,
  yaMandamosElTip,
  TIP_DE_LAS_COOKIES,
  TIP_DEL_BOX_LIMITADO,
  type MensajeParaElTip,
} from '../src/core/policies/cookies.js';

let mal = 0;
const chequear = (ok: boolean, nota: string, detalle = ''): void => {
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${nota}${ok || !detalle ? '' : `\n      ${detalle}`}`);
};

console.log('\n  Qué tip corresponde\n');

chequear(
  tipDeCookies([{ description: 'Cookie Dubai', productId: 'cookie-dubai' }]) ===
    TIP_DE_LAS_COOKIES,
  'una cookie suelta: el tip de los 10 segundos',
);
chequear(
  tipDeCookies([{ description: '3x Cookies surtidas', productId: null }]) === TIP_DE_LAS_COOKIES,
  'en plural también',
);
chequear(
  tipDeCookies([{ description: 'Box de Cookies Edición Limitada', productId: 'box-limitado' }]) ===
    TIP_DEL_BOX_LIMITADO,
  'el Box de Edición Limitada: solo la Volcán, 5 segundos',
);
chequear(
  tipDeCookies([
    { description: 'Cookie Kinder', productId: 'cookie-kinder' },
    { description: 'Box Edición Limitada', productId: 'box-ed-limitada' },
  ]) === TIP_DEL_BOX_LIMITADO,
  'si en el pedido está el box, manda el box: son las que llevan crema',
);
chequear(
  tipDeCookies([{ description: 'Torta Kinder', productId: 'torta-kinder' }]) === null,
  'una torta no lleva tip',
);
chequear(
  tipDeCookies([{ description: 'Alfajor de maicena', productId: 'cookie-chips' }]) ===
    TIP_DE_LAS_COOKIES,
  'el id alcanza aunque la descripción no lo diga',
);
chequear(tipDeCookies([]) === null, 'un pedido sin ítems no lleva tip');

/* --------------------------------------------------------------------- */

const entra = (contentKind: string): MensajeParaElTip => ({ direction: 'in', text: '', contentKind });
const sale = (text: string): MensajeParaElTip => ({ direction: 'out', text, contentKind: 'text' });
const dice = (text: string): MensajeParaElTip => ({ direction: 'in', text, contentKind: 'text' });

console.log('\n  Cuándo entró el comprobante\n');

chequear(
  elComprobanteEntroRecien([sale('Te paso el alias'), entra('image')]),
  'la foto es lo último que llegó',
);
chequear(
  elComprobanteEntroRecien([sale('alias'), entra('image'), dice('ya te lo mandé'), dice('a nombre de Ana')]),
  'la foto y después dos mensajes: sigue siendo el momento',
);
chequear(
  !elComprobanteEntroRecien([
    sale('alias'),
    entra('image'),
    ...Array.from({ length: 9 }, () => dice('...')),
  ]),
  'nueve mensajes después ya no: el tip quedaría colgado de otra charla',
);
chequear(
  !elComprobanteEntroRecien([sale('alias'), dice('cuánto sale?')]),
  'sin ninguna foto no hay comprobante',
);
chequear(
  elComprobanteEntroRecien([sale('alias'), entra('document')]),
  'un PDF del banco cuenta igual',
);
chequear(
  !elComprobanteEntroRecien([sale('alias'), entra('audio')]),
  'un audio no es un comprobante',
);

console.log('\n  Que no se diga dos veces\n');

chequear(
  yaMandamosElTip([sale('Recibido 🙌🏼'), sale(TIP_DE_LAS_COOKIES)]),
  'nuestro propio tip cuenta',
);
chequear(
  yaMandamosElTip([sale('acordate de calentarlas unos segundos en el microondas!')]),
  'si una de las chicas ya lo dijo con sus palabras, tampoco',
);
chequear(
  !yaMandamosElTip([dice('las meto al microondas?'), sale('Recibido 🙌🏼')]),
  'que lo diga la clienta no nos exime de decirlo',
);

/* --------------------------------------------------------------------- */

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

/*
  El corpus: las charlas de los últimos catorce días que tuvieron un pedido con
  cookies. Se recorre mensaje por mensaje en orden, y en cada salida del bot se
  pregunta lo mismo que preguntaría el pipeline. Así se ve el número que
  importa: en cuántas charlas saldría, y cuántas veces por charla.
*/
const filas = await q<{ c: string; created: string; direction: string; kind: string; text: string }>(
  `select m.conversation_id c, m.created_at::text created, m.direction, m.content_kind kind,
          coalesce(m.text,'') text
     from messages m
    where m.conversation_id in (
            select distinct o.conversation_id from orders o
             where o.created_at > now() - interval '14 days'
               and o.items::text ~* 'cookie'
          )
      and m.created_at > now() - interval '14 days'
    order by m.conversation_id, m.created_at asc`,
  [],
);

const pedidos = await q<{ c: string; items: unknown; created: string }>(
  `select conversation_id c, items, created_at::text created
     from orders
    where created_at > now() - interval '14 days' and items::text ~* 'cookie'
    order by created_at asc`,
  [],
);

const porCharla = new Map<string, typeof filas>();
for (const f of filas) {
  const ya = porCharla.get(f.c);
  if (ya) ya.push(f);
  else porCharla.set(f.c, [f]);
}
const pedidoDe = new Map<string, { items: unknown; created: string }>();
for (const p of pedidos) if (!pedidoDe.has(p.c)) pedidoDe.set(p.c, p);

let charlas = 0;
let saldria = 0;
let masDeUnaVez = 0;
let yaLoDecia = 0;
const ejemplos: string[] = [];

for (const [id, msgs] of porCharla) {
  const pedido = pedidoDe.get(id);
  if (!pedido) continue;
  charlas++;
  const items = (pedido.items ?? []) as Array<{ description?: string; productId?: string }>;
  const tip = tipDeCookies(items);
  if (!tip) continue;

  let veces = 0;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.direction !== 'out') continue;
    // El pedido tiene que existir antes de que el mensaje salga.
    if (Date.parse(m.created) < Date.parse(pedido.created)) continue;
    const hasta: MensajeParaElTip[] = msgs.slice(0, i).map((x) => ({
      direction: x.direction as 'in' | 'out',
      text: x.text,
      contentKind: x.kind,
    }));
    if (!elComprobanteEntroRecien(hasta)) continue;
    if (yaMandamosElTip(hasta)) {
      if (veces === 0) yaLoDecia++;
      break;
    }
    veces++;
    if (veces === 1 && ejemplos.length < 6) {
      ejemplos.push(`  ${m.created.slice(5, 16)}  ${m.text.replace(/\s+/g, ' ').slice(0, 150)}`);
    }
    break; // una vez que sale, `yaMandamosElTip` lo apaga para el resto
  }
  if (veces > 0) saldria++;
  if (veces > 1) masDeUnaVez++;
}

console.log(`\n  Corpus real: ${charlas} charlas con un pedido con cookies, 14 días\n`);
console.log(`  ${saldria} recibirían el tip.`);
console.log(`  ${yaLoDecia} ya lo tenían dicho (el modelo se acordó solo, o lo dijo el local).`);
console.log(`  ${masDeUnaVez} lo recibirían más de una vez — tiene que ser 0.`);
if (ejemplos.length) {
  console.log('\n  A qué mensaje se le pegaría:\n');
  for (const e of ejemplos) console.log(e);
}
if (masDeUnaVez > 0) mal++;

console.log(mal ? `\n  ${mal} fallaron.\n` : '\n  Pasa todo.\n');
await closeDb();
process.exit(mal ? 1 : 0);
