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
/*
  Lo que vale igual para los dos, escrito una vez. Si se repite copiado en cada
  uno, el día que cambie una fecha se cambia en un lado y no en el otro.
*/
const RETIRO_Y_PAGO =
  'Se abona el box completo por transferencia POR ADELANTADO; el pedido se toma recién ' +
  'cuando llegan el comprobante y los cinco datos: nombre, apellido, DNI, celular y cuál de ' +
  'los dos box. Se toman pedidos hasta el 14 de octubre, y el precio es promocional hasta ' +
  'agotar el primer stock. Se retira del local el sábado 17 de octubre y lo puede retirar otra ' +
  'persona. EL HORARIO DE RETIRO NO SE DICE HASTA QUE PAGÓ: darlo antes hace que entiendan que ' +
  'pueden caer ese día a comprarlo en el mostrador, y ya pasó. NO se manda en cadete ni en ' +
  'Uber, y tampoco se ofrece esa opción.';

const BOXES = [
  {
    id: 'box-madre-gracias-por-todo',
    name: 'Box gracias por todo',
    category: 'dia-de-la-madre',
    /* El precio sale del catalogo: ver el comentario de PRECIO abajo. */
    availableToday: true,
    limitedEdition: false,
    pickupOnly: true,
    sortOrder: 50,
    notes:
      'Box del Día de la Madre. Trae: brownie franui, pavlova de durazno, shot de suspiro ' +
      'limeño, shot de panacota, cookie de frambuesa, 2 alfajores (uno de frutos rojos y uno ' +
      'de pistacho), sandwich de jamón y queso, 2 chipá, conito de dulce de leche y jugo de ' +
      'naranja. Viene con una cadenita de regalo de la marca Chini. ' +
      /*
        LA CADENITA DEL VIDEO SE AGOTÓ, y hay que decirlo ANTES de que paguen.
        Agus: "si no les aviso que cambié la cadenita después me matan". Va
        pegado a la descripción del box y no como una regla aparte, para que la
        aclaración salga cada vez que el bot lo describe y no solo cuando se
        acuerda.
      */
      'IMPORTANTE, se aclara siempre al encargarlo: el modelo de cadenita que se ve en el video ' +
      'se agotó, pero igualmente lleva otro modelo hermoso de cadenita de la misma marca. ' +
      'NO se modifica nada: ni los productos ni la cadenita. ' +
      RETIRO_Y_PAGO,
  },
  {
    id: 'box-madre-te-amo-ma',
    name: 'Box te amo má',
    category: 'dia-de-la-madre',
    availableToday: true,
    limitedEdition: false,
    pickupOnly: true,
    sortOrder: 51,
    notes:
      'Box del Día de la Madre. Trae: taza de cerámica, mini brownie, mini pavlova, mini ' +
      'alfajor de pistacho y shot de suspiro limeño. NO se modifica nada: ni los productos ni ' +
      'la taza. ' +
      RETIRO_Y_PAGO,
  },
];

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const repos = createRepositories();

const antes = await repos.products.list();

/*
  EL PRECIO NO SE TOCA, y esto es la segunda vez que lo aprendo en dos días.

  El script traía $46.000 y $35.000 escritos. El 13 de octubre el local los
  subió a $49.000 y $37.000 desde el panel, y el 14, corriendo esto para
  agregar el aviso de la cadenita, se los volví a bajar sin darme cuenta. El
  mismo día había desactivado esta misma mina en el script de la campaña y no
  se me ocurrió mirar este.

  Lo que un script como este puede escribir es lo que NO está en el panel: el
  nombre, la categoría, las notas, los flags. El precio, la foto y la
  disponibilidad los maneja el local, y correr esto no puede pisarlos nunca.
*/
const PRECIO_SI_NO_EXISTE = { 'box-madre-gracias-por-todo': 49000, 'box-madre-te-amo-ma': 37000 };

for (const box of BOXES) {
  const ya = antes.find((p) => p.id === box.id);
  const precio = ya?.price ?? PRECIO_SI_NO_EXISTE[box.id as keyof typeof PRECIO_SI_NO_EXISTE] ?? 0;
  await repos.products.upsert({
    ...box,
    price: precio,
    // Lo que maneja el local desde el panel se respeta tal como está.
    imageUrl: ya?.imageUrl ?? null,
    availableToday: ya?.availableToday ?? box.availableToday,
  });
  console.log(
    `  ${ya ? 'actualizado' : 'CARGADO'}  ${box.name} — $${precio.toLocaleString('es-AR')}` +
      `${ya ? ' (precio respetado)' : ''}`,
  );
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
