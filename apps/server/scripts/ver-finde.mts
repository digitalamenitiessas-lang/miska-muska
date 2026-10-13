import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const charla = async (titulo: string, buscar: string, limite = 16) => {
  const [c] = await q<any>(
    `SELECT conversation_id FROM messages WHERE text ILIKE $1
      AND created_at > now() - interval '6 days' ORDER BY created_at DESC LIMIT 1`,
    [buscar],
  );
  console.log(`\n\n═══ ${titulo} ═══`);
  if (!c) return console.log('  (no la encontré)');
  const m = await q<any>(
    `SELECT to_char(created_at AT TIME ZONE $2,'DD/MM HH24:MI') h, direction, author,
            left(coalesce(text,''), 330) t
       FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT $3`,
    [c.conversation_id, TIMEZONE, limite],
  );
  console.log(`  ${c.conversation_id}`);
  for (const r of m.reverse()) {
    console.log(`\n  [${r.h}] ${r.direction} ${r.author ?? ''}\n  ${String(r.t).replace(/\n/g, ' ⏎ ')}`);
  }
};

await charla('A. EL BOX A LAS 9 DE LA MAÑANA', '%9 AM ya podés pasar%');
await charla('B. COOKIES Y "CHEQUEO EN LA AGENDA"', '%2 cookies ferrero%');
await charla('C. DOMINGO, PEDIDO AL MEDIODÍA', '%es para comerlos ahora al mediodía%');
await charla('D. ENVÍO SIN CARGO EXTRA', '%lo llevamos nosotros sin cargo extra%', 10);

await closeDb();
