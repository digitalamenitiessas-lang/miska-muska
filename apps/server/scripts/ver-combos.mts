import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const c = await q<any>(
  `SELECT count(*) n, count(DISTINCT conversation_id) charlas
     FROM messages WHERE direction='in' AND text ILIKE '%combo%'
      AND created_at > now() - interval '90 days'`,
);
console.log(`\n  Preguntas por "combo" en 90 días: ${c[0].n} mensajes, ${c[0].charlas} charlas.\n`);

const r = await q<any>(
  `SELECT to_char(i.created_at AT TIME ZONE $1,'DD/MM HH24:MI') h,
          left(i.text, 110) pregunta,
          (SELECT left(o.text, 200) FROM messages o
            WHERE o.conversation_id = i.conversation_id AND o.direction='out'
              AND o.created_at > i.created_at AND o.created_at < i.created_at + interval '3 minutes'
            ORDER BY o.created_at LIMIT 1) respuesta
     FROM messages i
    WHERE i.direction='in' AND i.text ILIKE '%combo%'
      AND i.created_at > now() - interval '90 days'
    ORDER BY i.created_at DESC LIMIT 12`,
  [TIMEZONE],
);
for (const x of r) {
  console.log(`  ── ${x.h}  «${String(x.pregunta).replace(/\n/g, ' ')}»`);
  console.log(`     → ${String(x.respuesta ?? '(sin respuesta)').replace(/\n/g, ' ⏎ ')}\n`);
}

await closeDb();
