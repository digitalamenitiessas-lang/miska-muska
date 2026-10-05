/*
  Espera a que haya movimiento real después del cambio de globitos y recién ahí
  imprime cómo quedó. Sirve para no mirar un panel vacío a las ocho de la
  mañana y creer que algo anda mal.

  npx tsx --env-file=... scripts/esperar-globitos.mts "2026-10-05 11:19:00+00" 40
*/
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const DESDE = process.argv[2] ?? '2026-10-05 11:19:00+00';
const MINIMO = Number(process.argv[3] ?? 40);
const HASTA = Date.now() + 3 * 60 * 60 * 1000; // no esperar más de tres horas

const cuantos = async (): Promise<number> => {
  const r = await q<any>(
    `SELECT count(*) n FROM messages WHERE direction='out' AND author='bot'
      AND content_kind='text' AND created_at > $1::timestamptz`,
    [DESDE],
  );
  return Number(r[0].n);
};

let n = await cuantos();
while (n < MINIMO && Date.now() < HASTA) {
  await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
  n = await cuantos();
}

console.log(`\n  ${n} mensajes de texto del bot desde el cambio.\n`);

const r = await q<any>(
  `WITH s AS (
     SELECT m.id, m.conversation_id, m.created_at, m.content_kind, m.text,
            lag(m.created_at) OVER w AS ant, lag(m.content_kind) OVER w AS kind_ant
       FROM messages m
      WHERE m.direction='out' AND m.author='bot' AND m.created_at > $1::timestamptz
     WINDOW w AS (PARTITION BY m.conversation_id ORDER BY m.created_at)
   )
   SELECT count(*) FILTER (WHERE content_kind='text') textos,
          count(*) FILTER (
            WHERE ant IS NOT NULL AND created_at - ant < interval '120 seconds'
              AND content_kind='text' AND kind_ant='text'
              AND NOT EXISTS (SELECT 1 FROM messages i WHERE i.conversation_id=s.conversation_id
                               AND i.direction='in' AND i.created_at > s.ant AND i.created_at < s.created_at)
          ) pegados,
          round(avg(length(text)) FILTER (WHERE content_kind='text')) largo_medio,
          max(length(text)) FILTER (WHERE content_kind='text') mas_largo,
          count(*) FILTER (WHERE content_kind='text' AND text LIKE '%' || chr(10) || chr(10) || '%') con_parrafos
     FROM s`,
  [DESDE],
);
const x = r[0];
console.log(
  `  ${x.textos} textos · ${x.pegados} pegados (${((Number(x.pegados) / Number(x.textos)) * 100).toFixed(1)}%)\n` +
    `  largo medio ${x.largo_medio} · más largo ${x.mas_largo} · ${x.con_parrafos} con párrafos\n`,
);

console.log('  MUESTRA, tal cual salieron:\n');
const ult = await q<any>(
  `SELECT to_char(created_at AT TIME ZONE $2,'HH24:MI') h, length(text) n, text
     FROM messages WHERE direction='out' AND author='bot' AND content_kind='text'
      AND created_at > $1::timestamptz AND text LIKE '%' || chr(10) || chr(10) || '%'
    ORDER BY created_at DESC LIMIT 5`,
  [DESDE, TIMEZONE],
);
for (const m of ult.reverse()) {
  console.log(`  ── ${m.h} · ${m.n} car.`);
  console.log(`${m.text.split('\n').map((l: string) => '     ' + l).join('\n')}\n`);
}

console.log('  LOS MÁS LARGOS:\n');
const largos = await q<any>(
  `SELECT to_char(created_at AT TIME ZONE $2,'HH24:MI') h, length(text) n,
          left(replace(text, chr(10), ' / '), 300) t
     FROM messages WHERE direction='out' AND author='bot' AND content_kind='text'
      AND created_at > $1::timestamptz ORDER BY length(text) DESC LIMIT 3`,
  [DESDE, TIMEZONE],
);
for (const m of largos) console.log(`  ${m.h} · ${m.n} car.\n     ${m.t}\n`);

await closeDb();
