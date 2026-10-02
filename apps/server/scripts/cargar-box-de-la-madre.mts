/**
 * Carga los dos box del Día de la Madre en el catálogo.
 *
 * Los datos salen del texto que mandó Agus el 2 de octubre de 2026. Las fotos
 * NO van acá: se cargan desde el panel, en Catálogo, tocando la miniatura del
 * producto. Esto deja los productos listos para recibirlas.
 *
 * Es idempotente: si ya están, los actualiza y no duplica nada.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/cargar-box-de-la-madre.mts
 */
import { openDb, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

/*
  POR QUÉ NO VAN COMO `limitedEdition`: ese flag hace que la ficha los anuncie
  con "invitá a consultar los sabores del mes", que es para las cookies. Estos
  box no tienen sabores que consultar, tienen fecha de retiro.

  POR QUÉ SÍ COMO `pickupOnly`: Agus lo pidió con todas las letras —"evitamos
  envíos a domicilio porque el box es delicado"— y ese flag no es decorativo:
  bloquea el envío con cadete y le hace explicar al cliente por qué.
*/
const BOXES = [
  {
    id: 'box-madre-gracias-por-todo',
    name: 'Box gracias por todo',
    category: 'desayunos',
    price: 46000,
    availableToday: true,
    limitedEdition: false,
    pickupOnly: true,
    sortOrder: 50,
    notes:
      'Box del Día de la Madre. Trae: brownie franui, pavlova de durazno, shot de suspiro ' +
      'limeño, shot de panacota, cookie de frambuesa, 2 alfajores (uno de frutos rojos y uno ' +
      'de pistacho), sandwich de jamón y queso, 2 chipá, conito de dulce de leche y jugo de ' +
      'naranja. Viene con una cadenita de regalo. NO se modifica nada: ni los productos ni la ' +
      'cadenita. Se abona el box completo por transferencia POR ADELANTADO; el pedido se toma ' +
      'recién cuando llega el comprobante. Se retira el sábado 17 de octubre en Marcos Paz 473. ' +
      'No se envía a domicilio.',
  },
  {
    id: 'box-madre-te-amo-ma',
    name: 'Box te amo má',
    category: 'desayunos',
    price: 35000,
    availableToday: true,
    limitedEdition: false,
    pickupOnly: true,
    sortOrder: 51,
    notes:
      'Box del Día de la Madre. Trae: taza de cerámica, mini brownie, mini pavlova, mini ' +
      'alfajor de pistacho y shot de suspiro limeño. NO se modifica nada: ni los productos ni ' +
      'la taza. Se abona el box completo por transferencia POR ADELANTADO; el pedido se toma ' +
      'recién cuando llega el comprobante. Se retira el sábado 17 de octubre en Marcos Paz 473. ' +
      'No se envía a domicilio.',
  },
];

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const repos = createRepositories();

const antes = await repos.products.list();

for (const box of BOXES) {
  const ya = antes.find((p) => p.id === box.id);
  // La foto que ya tenga no se pisa: la cargan desde el panel.
  await repos.products.upsert({ ...box, imageUrl: ya?.imageUrl ?? null });
  console.log(`  ${ya ? 'actualizado' : 'CARGADO'}  ${box.name} — $${box.price.toLocaleString('es-AR')}`);
}

const despues = await repos.products.list();
console.log('\n  Los box que quedan en el catálogo:');
for (const p of despues.filter((x) => /^box/i.test(x.name))) {
  console.log(
    `    $${String(p.price).padStart(6)}  ${p.availableToday ? 'sí' : 'NO'}  ` +
      `foto:${p.imageUrl ? 'sí' : 'NO'}  ${p.pickupOnly ? 'solo retiro' : 'con envío '}  ${p.name}`,
  );
}

await closeDb();
