import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

console.log('\n=== PEDIDOS CON TORTA TOMADOS ANOCHE ===');
const o = await q<any>(
  `SELECT o.id, o.conversation_id, o.created_at, o.created_by, o.status, o.total,
          o.delivery_date, o.delivery_time, o.customer_name, o.items::text items
     FROM orders o
    WHERE o.created_at > now() - interval '20 hours'
      AND o.items::text ILIKE '%torta%'
    ORDER BY o.created_at DESC LIMIT 8`,
);
if (!o.length) console.log('  (ninguno)');
for (const p of o) {
  console.log(
    `\n  ${new Date(p.created_at).toLocaleString('es-AR', { timeZone: TIMEZONE, hour12: false })} · ` +
      `por ${p.created_by} · ${p.customer_name} · $${p.total} · entrega ${p.delivery_date} ${p.delivery_time ?? ''}`,
  );
  console.log(`    conv=${p.conversation_id}`);
  console.log(`    ${p.items}`);
}

console.log('\n\n=== EL BOT COMPROMETIENDO UNA TORTA ANOCHE ===');
const m = await q<any>(
  `SELECT to_char(created_at AT TIME ZONE $1,'DD/MM HH24:MI') h, conversation_id, handler,
          left(text, 300) t
     FROM messages
    WHERE direction='out' AND author='bot' AND created_at > now() - interval '20 hours'
      AND text ILIKE '%torta%'
      AND (text ILIKE '%queda anotad%' OR text ILIKE '%te la esperamos%' OR text ILIKE '%alias%'
           OR text ILIKE '%confirmad%' OR text ILIKE '%te lo confirmo%' OR text ILIKE '%para hoy%'
           OR text ILIKE '%para maniana%' OR text ILIKE '%para mañana%')
    ORDER BY created_at DESC LIMIT 10`,
  [TIMEZONE],
);
if (!m.length) console.log('  (ninguno)');
for (const x of m) {
  console.log(`\n  ${x.h} · h=${x.handler ?? '-'} · ${x.conversation_id}`);
  console.log(`    ${String(x.t).replace(/\n/g, ' ⏎ ')}`);
}

await closeDb();
