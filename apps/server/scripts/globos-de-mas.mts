/*
  ¿CUÁNTO SE AHORRA JUNTANDO LOS GLOBITOS?

  El bot parte una respuesta larga en dos o tres mensajes porque se lee más
  natural. Mientras WhatsApp era gratis eso no costaba nada; ahora cada mensaje
  pasado del cupo sale ARS 37,6798.

  Un "globito de más" es un mensaje del bot que sale pegado al anterior sin que
  la clienta haya escrito en el medio: esos son los que se podrían unir sin
  perder una sola palabra.

  DOS DESCUENTOS QUE HAY QUE HACER, y sin ellos el ahorro sale inflado:

  1. Las fotos no se unen con el texto. Son mensajes distintos de WhatsApp y
     van a seguir siendo dos.
  2. Las charlas que llegan por un anuncio son gratis por 72 h. Juntar globitos
     ahí no ahorra un peso. Eran el 30% del tráfico el 1 de octubre, así que se
     descuenta esa parte.
*/
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const TARIFA = 37.6798;
const PARTE_POR_ANUNCIO = 348 / 1164; // medido el 1 de octubre, abierto por tipo
const VENTANA_S = 120;

const filas = await q<any>(
  `WITH salientes AS (
     SELECT m.id, m.conversation_id, m.created_at, m.content_kind, m.author,
            lag(m.created_at) OVER (PARTITION BY m.conversation_id ORDER BY m.created_at) AS anterior_sal,
            lag(m.content_kind) OVER (PARTITION BY m.conversation_id ORDER BY m.created_at) AS kind_anterior
       FROM messages m
      WHERE m.direction = 'out' AND m.author = 'bot'
        AND m.created_at > now() - interval '30 days'
   )
   SELECT to_char(s.created_at AT TIME ZONE $1,'YYYY-MM-DD') AS dia,
          count(*) AS salen,
          count(*) FILTER (
            WHERE s.anterior_sal IS NOT NULL
              AND s.created_at - s.anterior_sal < interval '120 seconds'
              AND s.content_kind = 'text' AND s.kind_anterior = 'text'
              AND NOT EXISTS (
                SELECT 1 FROM messages i
                 WHERE i.conversation_id = s.conversation_id AND i.direction = 'in'
                   AND i.created_at > s.anterior_sal AND i.created_at < s.created_at
              )
          ) AS pegados
     FROM salientes s
    GROUP BY 1 ORDER BY 1`,
  [TIMEZONE],
);

let totSalen = 0;
let totPegados = 0;
console.log('\n  día          salen del bot   globitos de más');
console.log('  ' + '─'.repeat(48));
for (const d of filas) {
  const salen = Number(d.salen);
  const peg = Number(d.pegados);
  totSalen += salen;
  totPegados += peg;
  console.log(
    `  ${d.dia}   ${String(salen).padStart(9)}   ${String(peg).padStart(8)} (${((peg / salen) * 100).toFixed(1).padStart(4)}%)`,
  );
}

const dias = filas.length || 1;
const pct = (totPegados / totSalen) * 100;
console.log('  ' + '─'.repeat(48));
console.log(`\n  ${dias} días: ${totSalen.toLocaleString('es-AR')} del bot, ${totPegados.toLocaleString('es-AR')} pegados (${pct.toFixed(1)}%)`);

const pegadosPorDia = totPegados / dias;
const alMes = pegadosPorDia * 31;
const cobrables = alMes * (1 - PARTE_POR_ANUNCIO);

console.log(`\n  Si se unieran todos:`);
console.log(`    ${Math.round(pegadosPorDia)} mensajes menos por día`);
console.log(`    ${Math.round(alMes).toLocaleString('es-AR')} menos en el mes`);
console.log(`    ${Math.round(cobrables).toLocaleString('es-AR')} de esos se cobran (el resto cae en charlas de anuncio)`);
console.log(`\n    AHORRO: ARS ${Math.round(cobrables * TARIFA).toLocaleString('es-AR')} por mes\n`);

/* Cuántos globitos trae un turno, para saber de qué estamos hablando. */
const tamanos = await q<any>(
  `WITH g AS (
     SELECT m.conversation_id, m.created_at,
            CASE WHEN m.created_at - lag(m.created_at) OVER w < interval '120 seconds'
                 THEN 0 ELSE 1 END AS arranca
       FROM messages m
      WHERE m.direction='out' AND m.author='bot' AND m.content_kind='text'
        AND m.created_at > now() - interval '7 days'
     WINDOW w AS (PARTITION BY m.conversation_id ORDER BY m.created_at)
   ),
   num AS (SELECT conversation_id, sum(arranca) OVER (PARTITION BY conversation_id ORDER BY created_at) AS grupo FROM g)
   SELECT count(*) AS cuantos, c AS globitos FROM (
     SELECT conversation_id, grupo, count(*) AS c FROM num GROUP BY 1,2
   ) t GROUP BY c ORDER BY c LIMIT 8`,
);
console.log('  De cuántos globitos es cada respuesta (7 días):\n');
for (const t of tamanos) console.log(`    ${t.globitos} globito(s): ${Number(t.cuantos).toLocaleString('es-AR')} respuestas`);
console.log();

await closeDb();
