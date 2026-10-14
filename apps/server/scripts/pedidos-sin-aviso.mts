/*
  Pedidos que el bot cargó y que nadie miró.

  Del local: "ayer había dos pedidos tomados que no decían atención ni derivado
  a humano".

  OJO CON LA BASE SOLA: cuando una persona contesta desde el panel se borran
  `attention_reason` y `attention_cleared_reason` a la vez, así que una charla
  atendida se ve idéntica a una que nunca avisó. Ya me equivoqué una vez por
  eso y afirmé que el 57% de los pedidos no alertaba, cuando sí alertaban.

  Por eso acá, además de la base, se mira si alguien del local escribió en la
  charla: si escribió, la vio. Y el log del servidor es el que tiene la verdad
  de si la alerta llegó a encenderse.
*/
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const DESDE = process.argv[2] ?? '2026-10-13 03:00:00+00';
const HASTA = process.argv[3] ?? '2026-10-14 03:00:00+00';

const o = await q<any>(
  `SELECT o.id, o.number, o.conversation_id, o.created_by, o.status, o.total, o.paid,
          o.customer_name, o.items::text items,
          to_char(o.created_at AT TIME ZONE $3,'DD/MM HH24:MI') AS cuando,
          o.created_at,
          c.attention_reason, c.attention_cleared_reason, c.attention_cleared_at,
          (SELECT count(*) FROM messages h WHERE h.conversation_id = o.conversation_id
            AND h.direction='out' AND h.author='human'
            AND h.created_at > o.created_at - interval '2 hours') AS humano_cerca,
          (SELECT count(*) FROM messages p WHERE p.conversation_id = o.conversation_id
            AND p.direction='in' AND p.content_kind IN ('image','document')
            AND p.created_at BETWEEN o.created_at - interval '2 hours' AND o.created_at + interval '2 hours') AS comprobantes
     FROM orders o
     LEFT JOIN conversations c ON c.id = o.conversation_id
    WHERE o.created_at >= $1::timestamptz AND o.created_at < $2::timestamptz
    ORDER BY o.created_at ASC`,
  [DESDE, HASTA, TIMEZONE],
);

/*
  SOLO LOS QUE CARGÓ EL BOT. Un pedido que cargó una persona a mano no necesita
  que nadie lo mire: lo miró quien lo cargó. Mezclarlos hacía que 133 pedidos
  parecieran un problema cuando la pregunta es sobre un puñado.
*/
const delBot = o.filter((p: any) => p.created_by === 'bot');
console.log(`\n  ${o.length} pedidos en esa ventana · ${delBot.length} los cargó el bot.\n`);

const sospechosos: any[] = [];
for (const p of delBot) {
  const marcada = Boolean(p.attention_reason) || Boolean(p.attention_cleared_reason);
  const vista = Number(p.humano_cerca) > 0;
  const estado = marcada ? 'alerta ✓' : vista ? 'la atendió una persona' : 'SIN RASTRO ⚠';
  console.log(
    `  #${String(p.number).padEnd(5)} ${p.cuando}  $${String(p.total).padStart(7)}  ${estado.padEnd(24)}` +
      `${String(p.customer_name ?? '—').slice(0, 24)}`,
  );
  if (!marcada && !vista) sospechosos.push(p);
}

console.log(`\n\n  ═══ SIN NINGÚN RASTRO DE QUE ALGUIEN LOS MIRARA: ${sospechosos.length} ═══\n`);
for (const p of sospechosos) {
  console.log(`  #${p.number} · ${p.cuando} · ${p.customer_name} · $${p.total}`);
  console.log(`    ${p.conversation_id}`);
  console.log(`    comprobantes cerca: ${p.comprobantes}`);
  console.log(`    ${p.items}\n`);
}

await closeDb();
