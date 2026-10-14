/**
 * El aviso de los pedidos que el bot cargó y nadie miró.
 *
 * Del local: "ayer había dos pedidos tomados que no decían atención ni
 * derivado a humano". Es cierto, y venía pasando parejo: uno por día sobre
 * unos 27 que carga el bot.
 *
 * El agujero tiene forma: el aviso que ya existía se dispara con el
 * COMPROBANTE, así que cubre lo que se paga por transferencia y se escapa todo
 * lo que se paga en el local.
 *
 * Lo que hay que medir acá no es que agarre el caso —eso es una consulta— sino
 * CUÁNTOS avisos por día serían. Un cartel que se enciende seguido es un
 * cartel que dejan de mirar, y ya pasó con el de los comprobantes.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-pedidos-sin-mirar.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

/*
  La misma consulta del repositorio, pero mirando hacia atrás: para cada pedido
  se pregunta si quince minutos DESPUÉS de cargarlo nadie lo había visto. Así
  se puede contar sobre días que ya pasaron.
*/
const r = await q<any>(
  `SELECT to_char(o.created_at AT TIME ZONE $1,'DD/MM') dia,
          o.number, o.total, o.customer_name,
          to_char(o.created_at AT TIME ZONE $1,'HH24:MI') hora,
          o.items::text items
     FROM orders o
     JOIN conversations c ON c.id = o.conversation_id
    WHERE o.created_by = 'bot' AND o.status <> 'cancelado'
      AND o.created_at > now() - interval '10 days'
      AND NOT EXISTS (
        SELECT 1 FROM messages m
         WHERE m.conversation_id = o.conversation_id
           AND m.direction='out' AND m.author='human'
           AND m.created_at BETWEEN o.created_at AND o.created_at + interval '15 minutes'
      )
      AND NOT EXISTS (
        SELECT 1 FROM messages p
         WHERE p.conversation_id = o.conversation_id AND p.direction='in'
           AND p.content_kind IN ('image','document')
           AND p.created_at BETWEEN o.created_at - interval '30 minutes'
                                AND o.created_at + interval '15 minutes'
      )
    ORDER BY o.created_at`,
  [TIMEZONE],
);

const porDia = new Map<string, number>();
for (const x of r) porDia.set(x.dia, (porDia.get(x.dia) ?? 0) + 1);

console.log(`\n  Avisos que se habrían encendido en 10 días: ${r.length}\n`);
for (const [d, n] of [...porDia].sort()) console.log(`    ${d}   ${n}  ${'█'.repeat(n)}`);
console.log(`\n  Promedio: ${(r.length / 10).toFixed(1)} por día.\n`);

console.log('  CADA UNO TIENE QUE SER UN PEDIDO QUE ALGUIEN DEBERÍA PREPARAR:\n');
for (const x of r.slice(-14)) {
  console.log(`    ${x.dia} ${x.hora}  #${x.number}  $${String(x.total).padStart(6)}  ${String(x.customer_name ?? '—').slice(0, 22).padEnd(24)}`);
  console.log(`              ${String(x.items).slice(0, 120)}`);
}
console.log();

await closeDb();
