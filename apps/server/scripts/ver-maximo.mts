import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const c = await q<any>(
  `SELECT id FROM conversations WHERE id IN (
     SELECT conversation_id FROM messages
      WHERE text ILIKE '%llevamos nosotros hoy mismo%' OR text ILIKE '%gracias por todo%es una belleza%'
      AND created_at > now() - interval '1 day')
   LIMIT 3`,
);
console.log('charlas:', c.map((x: any) => x.id).join(', ') || '(ninguna)');

for (const x of c) {
  const m = await q<any>(
    `SELECT to_char(created_at AT TIME ZONE $2,'HH24:MI:SS') h, direction, author, content_kind,
            handler, left(coalesce(text,''), 600) t
       FROM messages WHERE conversation_id = $1 AND created_at > now() - interval '12 hours'
      ORDER BY created_at ASC LIMIT 30`,
    [x.id, TIMEZONE],
  );
  console.log(`\n═══ ${x.id} ═══`);
  for (const r of m) console.log(`\n[${r.h}] ${r.direction} ${r.author ?? ''} ${r.content_kind ?? ''} ${r.handler ?? ''}\n${r.t}`);

  const o = await q<any>(
    `SELECT created_at, status, total, delivery_mode, delivery_date, delivery_time, items::text items
       FROM orders WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 3`,
    [x.id],
  );
  console.log('\n--- PEDIDOS ---');
  if (!o.length) console.log('  (ninguno)');
  for (const p of o)
    console.log(`  ${p.created_at} ${p.status} $${p.total} ${p.delivery_mode} ${p.delivery_date} ${p.delivery_time}\n    ${p.items}`);
}

const f = (await createRepositories().settings.read()).conocimiento ?? '';
const i = f.indexOf('BOX DEL DÍA DE LA MADRE');
console.log(`\n\n=== LA FICHA TIENE EL BLOQUE? ${i >= 0 ? 'SÍ' : 'NO'} ===`);
if (i >= 0) {
  for (const l of f.slice(i).split('\n')) {
    if (/cadete|uber|envi|domicilio|17 de octubre/i.test(l)) console.log(`  ${l.trim().slice(0, 170)}`);
  }
}

await closeDb();
