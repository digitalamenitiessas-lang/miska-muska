import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const [c] = await q<any>(
  `SELECT conversation_id FROM messages
    WHERE text ILIKE '%el horario exacto de retiro%'
      AND created_at > now() - interval '2 days'
    ORDER BY created_at DESC LIMIT 1`,
);
if (!c) {
  console.log('  No encontré la charla.');
} else {
  console.log(`  ${c.conversation_id}\n`);
  const m = await q<any>(
    `SELECT to_char(created_at AT TIME ZONE $2,'DD/MM HH24:MI:SS') h, direction, author,
            content_kind, handler, left(coalesce(text,''), 420) t
       FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [c.conversation_id, TIMEZONE],
  );
  for (const r of m) {
    console.log(`\n[${r.h}] ${r.direction} ${r.author ?? ''} ${r.content_kind ?? ''} ${r.handler ?? ''}`);
    console.log(String(r.t).replace(/\n/g, ' ⏎ '));
  }
}

await closeDb();
