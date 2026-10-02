/*
  CUÁNTOS MENSAJES SALEN FUERA DE LA VENTANA DE 24 H.

  Es la única pregunta que importa para el costo. Lo que contestamos dentro de
  la ventana que abre la clienta es gratis y sin tope; lo que sale afuera se
  cobra a ARS 37,6798. Meta solo nos da dos días de historia con el modelo
  nuevo, pero la ventana se puede reconstruir de nuestra propia base, que tiene
  meses: para cada saliente, cuándo fue el último entrante de esa charla.

  Es un TECHO, no un número exacto: los que llegaron por un anuncio tienen 72 h
  en vez de 24 y acá no se distinguen, así que algunos de los que esto cuenta
  como cobrables en realidad son gratis.
*/
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const TARIFA = 37.6798;

const r = await q<any>(
  `WITH salientes AS (
     SELECT m.id, m.created_at, m.conversation_id,
            (SELECT max(i.created_at) FROM messages i
              WHERE i.conversation_id = m.conversation_id
                AND i.direction = 'in' AND i.created_at <= m.created_at) AS ultimo_entrante
       FROM messages m
      WHERE m.direction = 'out'
        AND m.created_at > now() - interval '30 days'
   )
   SELECT to_char(created_at AT TIME ZONE $1, 'YYYY-MM-DD') AS dia,
          count(*) AS salen,
          count(*) FILTER (
            WHERE ultimo_entrante IS NULL
               OR created_at - ultimo_entrante > interval '24 hours'
          ) AS fuera
     FROM salientes
    GROUP BY 1 ORDER BY 1`,
  [TIMEZONE],
);

console.log('\n  día          salen   fuera de ventana   lo que costaría');
console.log('  ' + '─'.repeat(58));
let totSalen = 0;
let totFuera = 0;
for (const d of r) {
  const salen = Number(d.salen);
  const fuera = Number(d.fuera);
  totSalen += salen;
  totFuera += fuera;
  const pct = salen ? ((fuera / salen) * 100).toFixed(1) : '0';
  console.log(
    `  ${d.dia}   ${String(salen).padStart(5)}   ${String(fuera).padStart(5)} (${pct.padStart(4)}%)   ` +
      `ARS ${Math.round(fuera * TARIFA).toLocaleString('es-AR').padStart(8)}`,
  );
}

const dias = r.length || 1;
const fueraPorDia = totFuera / dias;
console.log('  ' + '─'.repeat(58));
console.log(`\n  ${dias} días: ${totSalen.toLocaleString('es-AR')} salientes, ${totFuera.toLocaleString('es-AR')} fuera de ventana (${((totFuera / totSalen) * 100).toFixed(1)}%)`);
console.log(`  Promedio: ${Math.round(fueraPorDia)} cobrables por día.`);
console.log(`\n  TECHO DEL MES (31 días): ARS ${Math.round(fueraPorDia * 31 * TARIFA).toLocaleString('es-AR')}`);
console.log(`  Y si todo lo que sale se cobrara, como decía el informe: ARS ${Math.round((totSalen / dias) * 31 * TARIFA).toLocaleString('es-AR')}\n`);

/* De dónde salen: ¿el bot contestando tarde, o una persona escribiendo primero? */
const quien = await q<any>(
  `WITH salientes AS (
     SELECT m.id, m.author, m.created_at, m.conversation_id,
            (SELECT max(i.created_at) FROM messages i
              WHERE i.conversation_id = m.conversation_id
                AND i.direction = 'in' AND i.created_at <= m.created_at) AS ultimo_entrante
       FROM messages m
      WHERE m.direction = 'out' AND m.created_at > now() - interval '30 days'
   )
   SELECT coalesce(author,'?') AS quien,
          count(*) FILTER (WHERE ultimo_entrante IS NULL) AS sin_entrante,
          count(*) FILTER (WHERE ultimo_entrante IS NOT NULL
                             AND created_at - ultimo_entrante > interval '24 hours') AS tarde
     FROM salientes GROUP BY 1 ORDER BY 2 DESC`,
);
console.log('  Quién manda los cobrables:\n');
console.log('  quién      nunca escribió     contestado tarde');
for (const x of quien) {
  console.log(
    `  ${String(x.quien).padEnd(10)} ${String(x.sin_entrante).padStart(10)}   ${String(x.tarde).padStart(16)}`,
  );
}
console.log();

await closeDb();
