import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const DESDE = process.argv[2] ?? '2026-10-09 22:08:10+00';

const [a] = await q<any>(
  `SELECT count(*) FILTER (WHERE direction='out') AS salieron,
          count(*) FILTER (WHERE direction='in') AS entraron,
          count(DISTINCT conversation_id) AS charlas,
          to_char(max(created_at) AT TIME ZONE $2,'HH24:MI:SS') AS ultimo
     FROM messages WHERE channel='whatsapp' AND created_at > $1::timestamptz`,
  [DESDE, TIMEZONE],
);
console.log(`\n  Desde ${DESDE}:`);
console.log(`    entraron  ${a.entraron}`);
console.log(`    SALIERON  ${a.salieron}`);
console.log(`    en ${a.charlas} charlas · último movimiento ${a.ultimo}\n`);

const u = await q<any>(
  `SELECT to_char(created_at AT TIME ZONE $2,'HH24:MI:SS') AS h, author,
          left(coalesce(text,''), 95) AS t
     FROM messages WHERE channel='whatsapp' AND direction='out'
      AND created_at > $1::timestamptz ORDER BY created_at DESC LIMIT 6`,
  [DESDE, TIMEZONE],
);
console.log('  Últimos que salieron:');
for (const x of u.reverse()) {
  console.log(`    ${x.h} ${String(x.author).padEnd(8)} ${String(x.t).replace(/\n/g, ' ')}`);
}
console.log();

await closeDb();
