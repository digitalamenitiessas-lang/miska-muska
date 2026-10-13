/*
  A quién le pasamos el precio promocional y todavía no pagó.

  El local cambió el precio hoy a las 17:00. Quien ya transfirió está cerrado y
  no hay nada que hacer. El problema son los del medio: les dijimos $46.000
  hace unas horas, no transfirieron todavía, y si vuelven mañana se van a
  encontrar con $49.000 sin que nadie se lo haya avisado.

  No lo arregla ninguna guarda: es una lista de gente a la que conviene
  escribirle.
*/
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const CAMBIO = process.argv[2] ?? '2026-10-13 20:00:00+00';

const r = await q<any>(
  `WITH cotizados AS (
     /* Charlas donde se nombró el precio viejo de un box del Día de la Madre. */
     SELECT DISTINCT m.conversation_id,
            max(m.created_at) AS ultima_cotizacion
       FROM messages m
      WHERE m.direction='out'
        AND (m.text LIKE '%46.000%' OR m.text LIKE '%35.000%')
        AND (m.text ILIKE '%gracias por todo%' OR m.text ILIKE '%te amo m%'
             OR m.text ILIKE '%día de la madre%')
        AND m.created_at > now() - interval '7 days'
        AND m.created_at < $1::timestamptz
      GROUP BY m.conversation_id
   )
   SELECT c.conversation_id AS id,
          coalesce(ct.display_name, ct.phone, '(sin nombre)') AS quien,
          to_char(c.ultima_cotizacion AT TIME ZONE $2,'DD/MM HH24:MI') AS cuando,
          /* ¿Mandó algún comprobante después de que le cotizamos? */
          EXISTS (SELECT 1 FROM messages p
                   WHERE p.conversation_id = c.conversation_id AND p.direction='in'
                     AND p.content_kind IN ('image','document')
                     AND p.created_at > c.ultima_cotizacion) AS pago,
          /* ¿Le escribió alguien del local después? */
          EXISTS (SELECT 1 FROM messages h
                   WHERE h.conversation_id = c.conversation_id AND h.direction='out'
                     AND h.author='human' AND h.created_at > c.ultima_cotizacion) AS atendida
     FROM cotizados c
     LEFT JOIN conversations cv ON cv.id = c.conversation_id
     LEFT JOIN contacts ct ON ct.id = cv.contact_id
    ORDER BY c.ultima_cotizacion DESC`,
  [CAMBIO, TIMEZONE],
);

const sinPagar = r.filter((x: any) => !x.pago);
console.log(`\n  ${r.length} charlas recibieron el precio promocional en los últimos 7 días.`);
console.log(`    ${r.length - sinPagar.length} ya mandaron comprobante → cerradas, sin problema`);
console.log(`    ${sinPagar.length} NO pagaron todavía → les cotizamos un precio que ya no existe\n`);

console.log('  LAS QUE QUEDARON COLGADAS (más recientes primero):\n');
for (const x of sinPagar.slice(0, 40)) {
  console.log(
    `    ${x.cuando}  ${String(x.quien).slice(0, 28).padEnd(30)} ${x.atendida ? '(ya le escribió una persona)' : ''}`,
  );
}
if (sinPagar.length > 40) console.log(`    … y ${sinPagar.length - 40} más`);
console.log();

await closeDb();
