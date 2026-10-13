/**
 * Pone al día la campaña del Día de la Madre.
 *
 * POR QUÉ ESTO ES UN SCRIPT Y NO UN BOTÓN: la API de campañas tiene crear,
 * prender/apagar y editar los SKU, pero NO tiene editar la campaña. El nombre,
 * las fechas y el pitch no se pueden tocar desde ningún lado. Agus se pasó un
 * rato buscando dónde editarla y no estaba: no la encontraba porque no existe.
 *
 * La que había era de julio, apagada, y su pitch hablaba de "caja de alfajores,
 * box mamá y desayuno mamá" —tres cosas que no son la propuesta de este año—.
 * Eso es una trampa: el único control que SÍ funciona es el interruptor, así
 * que alcanzaba con que alguien lo prendiera para que el bot empezara a
 * ofrecer algo que no existe. Se deja el contenido correcto y el interruptor
 * como estaba.
 *
 * OJO CON EL STOCK. Si la campaña se prende, el bot recibe el renglón
 * "quedan N de M" y se lo puede decir a la clienta. Ese número NO se mueve
 * solo: `reserveStock` existe en el repositorio pero no lo llama nadie, así
 * que es lo que escriban a mano en la columna "Usadas". Eso tiene una ventaja
 * —las ventas del local se pueden sumar ahí, que era justo la duda de Agus— y
 * un costo: si nadie lo actualiza, el bot repite un número viejo.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/campana-de-la-madre.mts
 */
import { openDb, q, exec, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

/*
  SIN PRECIOS ACÁ, y me costó un día entenderlo.

  La primera versión decía "el Box gracias por todo a $46.000 y el te amo má a
  $35.000". El 13 de octubre a las 17:00 el local subió los precios a $49.000 y
  $37.000 en el catálogo, y el bot siguió pasando los viejos: 20 mensajes con
  $46.000 en las horas siguientes, mientras el catálogo y los SKU de esta misma
  campaña ya decían otra cosa.

  Lo más feo es que ese mismo día escribí, en el bloque de la ficha sobre el
  precio promocional, que los precios no se repiten porque "el día que los
  vuelva a tocar quedan dos números distintos y ninguna forma de saber cuál
  manda". Tenía razón y ya me había pasado a mí mismo ocho días antes, en este
  archivo, sin darme cuenta.

  El precio sale del catálogo y de los SKU de la campaña. Acá va cómo se
  presenta, que es lo que el catálogo no sabe.
*/
const PITCH =
  'Dos opciones de box, con el precio que diga el catálogo. ' +
  'Se abona el box completo por adelantado por transferencia y el pedido se toma recién ' +
  'con el comprobante y los cinco datos (nombre, apellido, DNI, celular y cuál box). ' +
  'Pedidos hasta el 14 de octubre; se retiran del local el sábado 17. El horario de retiro no ' +
  'se dice hasta que pagó. No se manda en cadete ni en Uber.';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const repos = createRepositories();

const [campana] = await q<any>(
  `SELECT * FROM campaigns WHERE name ILIKE '%madre%' ORDER BY created_at DESC LIMIT 1`,
);
if (!campana) {
  console.error('  No encontré ninguna campaña del Día de la Madre.');
  process.exit(1);
}

console.log(`  campaña   : ${campana.name} [${campana.id}]`);
console.log(`  encendida : ${campana.active ? 'SÍ' : 'no'}  (no se toca)`);
console.log(`  pitch viejo: ${campana.pitch}\n`);

await exec(
  `UPDATE campaigns SET name = $2, starts_on = $3, ends_on = $4, pitch = $5 WHERE id = $1`,
  [campana.id, 'Día de la Madre 2026', '2026-10-02', '2026-10-17', PITCH],
);

/* Los SKU sí tienen API, pero se dejan armados para que no haya que tipearlos. */
const previos = await repos.campaigns.skus(campana.id);
/*
  El precio y el stock se toman de lo que YA esta cargado y no se pisan: el
  local los cambia desde el panel, que es su lugar. Esto solo asegura que las
  dos cajas existan.
*/
const QUIERO = [
  { name: 'Box gracias por todo', sortOrder: 1 },
  { name: 'Box te amo má', sortOrder: 2 },
];

for (const s of QUIERO) {
  const ya = previos.find((p) => p.name === s.name);
  await repos.campaigns.upsertSku({
    id: ya?.id,
    campaignId: campana.id,
    name: s.name,
    /*
      El precio y el stock se respetan tal como están. Los pone el local desde
      el panel y correr este script no puede volverlos atrás: la primera
      versión los traía escritos acá y, el día que subieron el precio, haberlo
      corrido habría deshecho el cambio.
    */
    price: ya?.price ?? 0,
    stockTotal: ya?.stockTotal ?? 0,
    // Lo ya vendido tampoco se pisa: ese número lo llevan ellos a mano.
    stockUsed: ya?.stockUsed ?? 0,
    sortOrder: s.sortOrder,
  });
}

/* Los SKU viejos que ya no son de esta propuesta quedan en cero y al final. */
for (const viejo of previos.filter((p) => !QUIERO.some((s) => s.name === p.name))) {
  await exec(`DELETE FROM campaign_skus WHERE id = $1`, [viejo.id]);
  console.log(`  borrado el SKU viejo: ${viejo.name}`);
}

const [final] = await q<any>(`SELECT * FROM campaigns WHERE id = $1`, [campana.id]);
console.log(`\n  nombre  : ${final.name}`);
console.log(`  fechas  : ${String(final.starts_on).slice(0, 10)} a ${String(final.ends_on).slice(0, 10)}`);
console.log(`  pitch   : ${final.pitch}\n`);
for (const s of await repos.campaigns.skus(campana.id)) {
  console.log(`    ${s.name} — $${s.price} — ${s.stockUsed} usadas de ${s.stockTotal}`);
}
console.log(
  `\n  Sigue ${final.active ? 'ENCENDIDA' : 'apagada'}. Con el catálogo y la ficha ya cargados, ` +
    'el bot ofrece los box igual.\n',
);

await closeDb();
