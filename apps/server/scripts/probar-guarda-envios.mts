/*
  Prueba de la guarda del envío gratis.

  Corre con: npx tsx apps/server/scripts/probar-guarda-envios.mts

  Las frases de arriba son las que TIENEN que dispararla —la primera es textual
  de la charla que la motivó— y las de abajo son las que NO, que es la mitad que
  importa: una guarda que pisa la respuesta correcta es peor que no tenerla.
*/
import { afirmaQueYaSalio, prometeEnvioGratis } from '../src/core/policies/envios.js';

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

/* La segunda guarda: afirmar que el pedido ya salió. */
const YA_SALIO_SI = [
  'Quedó todo anotado así, Lautaro. Ya estamos con el envío en camino para llegar en esa franja 💕',
  'ya salió el cadete',
  'tu pedido va en camino 🙌🏼',
  'ya te lo mandamos con el cadete',
  'el cadete está en camino',
  'ya lo llevan para allá',
  'está saliendo ahora mismo',
];

const YA_SALIO_NO = [
  'Te aviso cuando esté en camino 🙌🏼',
  'En cuanto salga el cadete te escribo.',
  'Apenas salimos para allá te mando un mensaje.',
  'Quedó anotado. En un rato te confirman desde el local cómo viene la entrega.',
  'El envío se cobra aparte, y cuánto sale depende de la zona.',
  'Ya salió del horno esta mañana, está fresquísimo.',
];

let fallas = 0;
const revisar = (
  nombre: string,
  fn: (t: string) => boolean,
  prender: string[],
  callar: string[],
) => {
  for (const texto of prender) {
    if (!fn(texto)) {
      fallas += 1;
      console.log(`SE ESCAPA (${nombre})  ${texto}`);
    }
  }
  for (const texto of callar) {
    if (fn(texto)) {
      fallas += 1;
      console.log(`FALSO POSITIVO (${nombre})  ${texto}`);
    }
  }
  console.log(`${nombre}: ${prender.length} detectadas, ${callar.length} respetadas`);
};

revisar('envío gratis', prometeEnvioGratis, DEBE_PRENDER, NO_DEBE_PRENDER);
revisar('ya salió', afirmaQueYaSalio, YA_SALIO_SI, YA_SALIO_NO);

console.log(fallas === 0 ? 'OK' : `${fallas} casos mal`);
process.exit(fallas === 0 ? 0 : 1);
