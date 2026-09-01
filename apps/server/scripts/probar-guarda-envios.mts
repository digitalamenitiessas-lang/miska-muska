/*
  Prueba de la guarda del envío gratis.

  Corre con: npx tsx apps/server/scripts/probar-guarda-envios.mts

  Las frases de arriba son las que TIENEN que dispararla —la primera es textual
  de la charla que la motivó— y las de abajo son las que NO, que es la mitad que
  importa: una guarda que pisa la respuesta correcta es peor que no tenerla.
*/
import { prometeEnvioGratis } from '../src/core/policies/envios.js';

const DEBE_PRENDER = [
  'No, lo que pagás en efectivo cuando llegue es el pedido en sí ($6.300), no hay un cobro aparte por el envío 🙌🏼',
  'el envio es gratis',
  'El envío te sale gratis 💕',
  'no te cobramos el envío',
  'el cadete no se cobra',
  'Gratis el envío en esa zona',
  'el envío va incluido en el precio',
  'sin cargo el delivery',
  'el reparto está bonificado',
  'Te lo mandamos con nuestro cadete y no hay ningún costo adicional',
];

const NO_DEBE_PRENDER = [
  'El envío se cobra aparte, y cuánto sale depende de la zona.',
  'Los cursos no tienen descuento, el valor es el mismo para todas.',
  'La tableta sale $14.000, el envío lo coordinamos después.',
  'Te lo llevamos con nuestro cadete, el costo te lo confirman del local.',
  'Con el comprobante ya queda reservado, no hay que pagar nada más por adelantado.',
  'El curso es gratis para las que ya hicieron el anterior.',
  'La mini torta va de regalo para el cumpleañero, sin cargo.',
  'Hacemos envíos con nuestro cadete a Banda del Río Salí.',
];

let fallas = 0;
for (const texto of DEBE_PRENDER) {
  if (!prometeEnvioGratis(texto)) {
    fallas += 1;
    console.log(`SE ESCAPA  ${texto}`);
  }
}
for (const texto of NO_DEBE_PRENDER) {
  if (prometeEnvioGratis(texto)) {
    fallas += 1;
    console.log(`FALSO POSITIVO  ${texto}`);
  }
}

console.log(
  fallas === 0
    ? `OK · ${DEBE_PRENDER.length} detectadas, ${NO_DEBE_PRENDER.length} respetadas`
    : `${fallas} casos mal`,
);
process.exit(fallas === 0 ? 0 : 1);
