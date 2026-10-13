/*
  Quién escribió y no recibió respuesta desde que Meta empezó a rebotar los
  envíos por falta de pago. El bot contesta igual —el mensaje se genera y se
  guarda— pero Meta no lo entrega, así que del otro lado hay silencio.
*/
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const DESDE = process.argv[2] ?? '2026-10-09 19:22:00+00';

const [r] = await q<any>(
  `SELECT count(*) FILTER (WHERE direction='in') AS entraron,
          count(*) FILTER (WHERE direction='out') AS salieron,
          count(DISTINCT conversation_id) FILTER (WHERE direction='in') AS charlas
     FROM messages WHERE created_at > $1::timestamptz AND channel='whatsapp'`,
  [DESDE],
);
console.log(`\n  Desde ${DESDE}:`);
console.log(`    entraron ${r.entraron} mensajes de clientas, en ${r.charlas} charlas`);
console.log(`    el bot generó ${r.salieron} respuestas (que Meta no entregó)\n`);

const gente = await q<any>(
  `SELECT c.id, coalesce(ct.display_name, ct.phone, '(sin nombre)') AS quien,
          to_char(max(m.created_at) AT TIME ZONE $2,'HH24:MI') AS ultimo,
          count(*) FILTER (WHERE m.direction='in') AS escribio
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     LEFT JOIN contacts ct ON ct.id = c.contact_id
    WHERE m.created_at > $1::timestamptz AND m.channel='whatsapp' AND m.direction='in'
    GROUP BY c.id, ct.display_name, ct.phone
    ORDER BY max(m.created_at) DESC`,
  [DESDE, TIMEZONE],
);
console.log(`  Las ${gente.length} charlas que quedaron sin respuesta entregada:\n`);
for (const g of gente) {
  console.log(`    ${g.ultimo}  ${String(g.quien).slice(0, 30).padEnd(32)} ${g.escribio} mensaje(s)`);
}
console.log();

await closeDb();
