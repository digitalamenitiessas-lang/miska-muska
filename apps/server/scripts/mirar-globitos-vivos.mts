/*
  Cómo viene el empalme de globitos en producción, contra cómo venía antes.
  Toma la hora del deploy como corte y compara los mismos números de los dos
  lados.
*/
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const DESDE = process.argv[2] ?? '2026-10-05 17:05:00+00';

const comparar = async (nombre: string, filtro: string, params: any[]) => {
  const r = await q<any>(
    `WITH s AS (
       SELECT m.id, m.conversation_id, m.created_at, m.content_kind, m.text,
              lag(m.created_at) OVER w AS ant,
              lag(m.content_kind) OVER w AS kind_ant
         FROM messages m
        WHERE m.direction='out' AND m.author='bot' AND ${filtro}
       WINDOW w AS (PARTITION BY m.conversation_id ORDER BY m.created_at)
     )
     SELECT count(*) FILTER (WHERE content_kind='text') AS textos,
            count(*) FILTER (
              WHERE ant IS NOT NULL AND created_at - ant < interval '120 seconds'
                AND content_kind='text' AND kind_ant='text'
                AND NOT EXISTS (SELECT 1 FROM messages i WHERE i.conversation_id=s.conversation_id
                                 AND i.direction='in' AND i.created_at > s.ant AND i.created_at < s.created_at)
            ) AS pegados,
            round(avg(length(text)) FILTER (WHERE content_kind='text')) AS largo_medio,
            max(length(text)) FILTER (WHERE content_kind='text') AS mas_largo,
            count(*) FILTER (WHERE content_kind='text' AND text LIKE '%' || chr(10) || chr(10) || '%') AS con_parrafos
       FROM s`,
    params,
  );
  const x = r[0];
  const pct = Number(x.textos) ? ((Number(x.pegados) / Number(x.textos)) * 100).toFixed(1) : '0';
  console.log(
    `  ${nombre.padEnd(22)} ${String(x.textos).padStart(5)} textos · ${String(x.pegados).padStart(4)} pegados (${pct.padStart(4)}%) · ` +
      `largo medio ${x.largo_medio} · más largo ${x.mas_largo} · ${x.con_parrafos} con párrafos`,
  );
};

console.log(`\n  Corte: ${DESDE}\n`);
await comparar('ANTES (7 días)', `m.created_at BETWEEN $1::timestamptz - interval '7 days' AND $1::timestamptz`, [DESDE]);
await comparar('DESPUÉS', `m.created_at > $1::timestamptz`, [DESDE]);

console.log('\n\n  ÚLTIMOS MENSAJES DEL BOT, tal cual salieron:\n');
const ult = await q<any>(
  `SELECT to_char(created_at AT TIME ZONE $2,'HH24:MI:SS') h, content_kind, length(text) AS n, text
     FROM messages WHERE direction='out' AND author='bot' AND created_at > $1::timestamptz
    ORDER BY created_at DESC LIMIT 8`,
  [DESDE, TIMEZONE],
);
for (const m of ult.reverse()) {
  console.log(`  ── ${m.h} · ${m.content_kind} · ${m.n ?? 0} car.`);
  console.log(`${(m.text ?? '[sin texto]').split('\n').map((l: string) => '     ' + l).join('\n')}\n`);
}

console.log('  LOS MÁS LARGOS DESDE EL CAMBIO:\n');
const largos = await q<any>(
  `SELECT to_char(created_at AT TIME ZONE $2,'HH24:MI') h, length(text) AS n,
          left(replace(text, chr(10), ' ⏎ '), 260) AS t
     FROM messages WHERE direction='out' AND author='bot' AND content_kind='text'
      AND created_at > $1::timestamptz ORDER BY length(text) DESC LIMIT 4`,
  [DESDE, TIMEZONE],
);
for (const m of largos) console.log(`  ${m.h} · ${m.n} car.\n     ${m.t}\n`);

await closeDb();
