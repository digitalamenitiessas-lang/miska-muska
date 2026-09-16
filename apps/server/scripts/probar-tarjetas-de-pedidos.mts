/**
 * Que la tarjeta y la lista digan lo mismo.
 *
 * Es el invariante que se rompió y que el local encontró antes que nosotros:
 * "creo que está con un bug, no coincide el por cobrar con el listado real".
 * La tarjeta sumaba toda la tabla y la lista traía las 200 más nuevas, así que
 * cuatro pedidos del 31/08 entregados y sin cobrar entraban en los $143.100 y
 * no aparecían abajo ni filtrando.
 *
 * La prueba no inventa datos: corre las dos consultas contra la base de verdad
 * y compara. Si alguien toca una de las dos condiciones y no la otra, esto se
 * enciende.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-tarjetas-de-pedidos.mts
 */
import { openDb, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const repos = createRepositories();

let mal = 0;
const plata = (n: number) => '$' + n.toLocaleString('es-AR');

const resumen = await repos.orders.resumen();

console.log('\n  Tarjeta contra lista, sobre la base real\n');

/* --- Por cobrar: la tarjeta es plata, la lista tiene que sumar lo mismo. --- */
const porCobrar = await repos.orders.list({ pendiente: 'porCobrar', limit: 500 });
const suma = porCobrar.reduce((t, o) => t + Math.max(0, o.total - o.paid), 0);
const okCobrar = suma === resumen.porCobrar;
if (!okCobrar) mal++;
console.log(
  `  ${okCobrar ? '✓' : '✗'} Por cobrar: la tarjeta dice ${plata(resumen.porCobrar)} y los ` +
    `${porCobrar.length} de la lista suman ${plata(suma)}`,
);

/* --- Sin comprobante: la tarjeta es un conteo. --- */
const sinComprobante = await repos.orders.list({ pendiente: 'sinComprobante', limit: 500 });
const okSin = sinComprobante.length === resumen.sinComprobante;
if (!okSin) mal++;
console.log(
  `  ${okSin ? '✓' : '✗'} Sin comprobante: la tarjeta dice ${resumen.sinComprobante} y la ` +
    `lista trae ${sinComprobante.length}`,
);

/* --- Sin precio, que es la tercera que sale del resumen. --- */
const sinPrecio = await repos.orders.list({ pendiente: 'sinPrecio', limit: 500 });
const okPrecio = sinPrecio.length === resumen.sinPrecio;
if (!okPrecio) mal++;
console.log(
  `  ${okPrecio ? '✓' : '✗'} Sin precio: la tarjeta dice ${resumen.sinPrecio} y la lista ` +
    `trae ${sinPrecio.length}`,
);

/* --- Y que cada filtro devuelva SOLO lo que promete. --- */
console.log('\n  Que no se cuele nada que no corresponda\n');

const cancelado = [...porCobrar, ...sinComprobante, ...sinPrecio].filter(
  (o) => o.status === 'cancelado',
);
if (cancelado.length) mal++;
console.log(
  `  ${cancelado.length ? '✗' : '✓'} Ningún cancelado en las tres listas ` +
    `(${cancelado.length} colados)`,
);

const pagado = porCobrar.filter((o) => o.total <= o.paid);
if (pagado.length) mal++;
console.log(
  `  ${pagado.length ? '✗' : '✓'} En "por cobrar" no hay nada ya saldado (${pagado.length})`,
);

const conPlata = sinComprobante.filter((o) => o.paid > 0 || o.total <= 0);
if (conPlata.length) mal++;
console.log(
  `  ${conPlata.length ? '✗' : '✓'} En "sin comprobante" nadie registró un peso ` +
    `(${conPlata.length})`,
);

/* --- Lo que el bug hacía imposible: que aparezcan los viejos. --- */
const masViejo = porCobrar
  .map((o) => Date.parse(o.createdAt))
  .sort((a, b) => a - b)[0];
if (masViejo) {
  const dias = Math.floor((Date.now() - masViejo) / 86_400_000);
  const ultimas200 = await repos.orders.list({ limit: 200 });
  const corte = ultimas200.length
    ? Date.parse(ultimas200[ultimas200.length - 1].createdAt)
    : 0;
  const quedabaAfuera = masViejo < corte;
  console.log(
    `\n  El más viejo de "por cobrar" tiene ${dias} días. Con las 200 más nuevas ` +
      `${quedabaAfuera ? 'NO llegaba a la lista — era justo el bug.' : 'sí entraba.'}`,
  );
}

console.log(mal ? `\n  ${mal} fallaron.\n` : '\n  Pasa todo: el número y la lista coinciden.\n');
await closeDb();
process.exit(mal ? 1 : 0);
