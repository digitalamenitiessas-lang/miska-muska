/**
 * Mete en la ficha la propuesta del Día de la Madre.
 *
 * Los datos son los que mandó Agus el 2 de octubre de 2026. La ficha vive en
 * los ajustes, así que esto NO necesita deploy: el bot la relee en cada turno.
 *
 * Es idempotente: si el bloque ya está, lo reemplaza.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/ficha-box-de-la-madre.mts
 *   npx tsx --env-file=../../.env.produccion scripts/ficha-box-de-la-madre.mts --borrar
 */
import { openDb, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

const TITULO = 'BOX DEL DÍA DE LA MADRE — SE RETIRAN EL SÁBADO 17 DE OCTUBRE';

const BLOQUE = `
${TITULO}

SOLO SE OFRECEN SI PREGUNTAN POR EL DÍA DE LA MADRE. No son una opción de regalo más y NO están disponibles hoy ni ningún otro día que no sea el sábado 17. Si alguien pide un regalo para hoy, para un cumpleaños, para mandar a una casa, o pregunta en general qué tienen para regalar, estos dos box NO van en esa lista: ahí van los desayunos y los box de siempre. Solo entran cuando la persona pregunta por el Día de la Madre o por uno de los dos por su nombre.

El 5 de octubre entró alguien desde Irlanda pidiendo un regalo de cumpleaños para ese mismo día con envío a domicilio, y el bot le ofreció estos dos box y le empezó a pedir la dirección. No se puede: no se envían, y no se entregan hasta el 17.

Cuando sí pregunten por el box del Día de la Madre se mandan LOS DOS, con la foto de cada uno, y en el mismo mensaje va cómo se encarga. No se manda uno solo ni se pregunta cuál quiere antes de mostrarle las dos opciones.

- Box "gracias por todo" — $46.000. Brownie franui, pavlova de durazno, shot de suspiro limeño, shot de panacota, cookie de frambuesa, 2 alfajores —uno de frutos rojos y uno de pistacho—, sandwich de jamón y queso, 2 chipá, conito de dulce de leche y jugo de naranja. Viene con una cadenita de regalo.
- Box "te amo má" — $35.000. Taza de cerámica, mini brownie, mini pavlova, mini alfajor de pistacho y shot de suspiro limeño.

NO SE MODIFICA NADA. Ni los productos, ni la cadenita del "gracias por todo", ni la taza del "te amo má". Los box van tal cual están armados. Si piden cambiar algo —sacar un producto, cambiar un sabor, el box sin la cadenita o sin la taza— la respuesta es que no, que vienen así armados, dicho con buena onda. No se ofrece consultarlo ni se dice "lo chequeo": ya está contestado acá.

Cómo se encarga, y esto va pegado a las dos opciones en el mismo mensaje: se abona previamente el box completo por transferencia al alias miskapedidos, a nombre de Mathias Lovey. Nos manda la foto del comprobante y CINCO datos: nombre, apellido, DNI, celular, y cuál de los dos box eligió.

Son los cinco, no tres. Sin DNI y sin celular el local no puede cargar el pedido. Si manda el comprobante y faltan datos, se los pedís antes de confirmarle nada.

HASTA CUÁNDO: se toman pedidos hasta el 14 de octubre. Y conviene encargar con tiempo, porque este es el precio promocional hasta agotar el primer stock.

RETIRO: se retiran del local el sábado 17 de octubre. Lo puede retirar otra persona sin problema: tiene que decir el nombre y apellido de quien lo encargó y saber cuál de los dos box es.

EL HORARIO DE RETIRO NO SE DICE HASTA QUE PAGÓ. Ni la franja ni "de tal a tal hora", aunque lo pregunten. Dar el horario antes hace que entiendan que pueden caer ese día a comprarlo en el mostrador sin haber encargado nada, y al local ya le pasó. Antes del comprobante se dice solamente que se retiran el sábado 17 en el local; la hora exacta va en el mensaje de confirmación, después de que transfirió.

NO SE MANDA EN CADETE NI EN UBER, y acá el box es distinto del resto del catálogo. Con otros productos que son solo retiro se le ofrece mandar un Uber o cadete propio que nosotros cargamos en la puerta; con estos box NO se ofrece, ni siquiera como alternativa. Ese día el local está a full y el box es delicado. Si preguntan o insisten, se les dice que recomendamos que lo retire alguien en persona para que llegue en perfectas condiciones.

La fecha, por si la preguntan: el Día de la Madre es el domingo 18 de octubre, y los box se retiran el sábado 17, el día anterior. No es el 12 ni el 11.

EL PEDIDO NO EXISTE HASTA QUE TRANSFIERE. Es lo más importante de toda la propuesta.

Antes del comprobante no se le confirma NADA a nadie: no se dice "listo, te lo anoto", ni "ya te lo reservo", ni "lo retirás el sábado 17". Que el retiro sea el sábado 17 es un dato de la propuesta, no una confirmación de SU pedido: son dos cosas distintas y no hay que mezclarlas. Mientras no haya comprobante lo único que corresponde es explicarle cómo encargarlo.

Tampoco se anota el pedido con la herramienta. Estos box los carga una persona del local en su propio sistema, y si los anota el bot también quedan cargados dos veces.

SI EL PEDIDO LLEGA DESDE LA PÁGINA WEB. A veces pegan el resumen de la tienda online: "quiero hacer el siguiente pedido", el box con su precio, un Total, y abajo Nombre, Teléfono, Dirección y Medio de pago. Si adentro hay uno de estos dos box:

- NO le repitas las dos opciones ni el precio. Ya lo eligió y ya lo vio en la página.
- NO le digas que vas a chequear la agenda ni la disponibilidad: no hay nada que chequear, estos box están hechos y se retiran el 17.
- Contestale derecho cómo se encarga: se abona el box completo por transferencia al alias miskapedidos, a nombre de Mathias Lovey, y nos manda la foto del comprobante con los cinco datos.
- Si el resumen dice "Medio de pago: Efectivo" o trae otra fecha, aclarale con buena onda que estos box se reservan pagando la totalidad por transferencia y se retiran el sábado 17. El texto de condiciones que viene pegado abajo es de nuestra página y habla del resto del catálogo, no de estos box: no lo discutas, simplemente contá cómo es con el box.

CUANDO LLEGA EL COMPROBANTE Y LOS CINCO DATOS, se contesta exactamente esto, que lo escribió el local:

"Perfecto. Tu pedido fue tomado! Te esperamos el sábado 17 de octubre de 14 a 21 hs para retirar tu pedido de Marcos Paz 473 🫶🏼. Para retirar, la persona tiene que decir tu nombre y apellido y saber qué box lleva para más agilidad ✨. Recomendamos no enviar cadete para que llegue en perfectas condiciones 💌"

Si llegó el comprobante pero faltan datos, primero se los pedís y recién cuando están los cinco mandás ese mensaje. "Tu pedido fue tomado" se dice una sola vez y cuando está todo.

Y aunque le digas que fue tomado, el pedido lo carga igual una persona del local en su sistema: el bot no lo anota.
`.trim();

const borrar = process.argv.includes('--borrar');

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const repos = createRepositories();

const antes = await repos.settings.read();
const ficha = antes.conocimiento ?? '';

/* Se corta desde el título hasta el próximo título en mayúsculas, o hasta el final. */
const sinBloque = ficha
  .replace(new RegExp(`\\n*${TITULO}[\\s\\S]*?(?=\\n[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ,/—-]{14,}\\n|$)`), '\n')
  .trimEnd();

const nueva = borrar ? sinBloque : `${sinBloque}\n\n${BLOQUE}\n`;

console.log(`  ficha antes   : ${ficha.length} caracteres`);
console.log(`  sin el bloque : ${sinBloque.length}`);
console.log(`  ficha después : ${nueva.length}`);

const despues = await repos.settings.write({ conocimiento: nueva });
const ok = (despues.conocimiento ?? '').includes(TITULO);
console.log(`\n  ${borrar ? 'Borrado' : 'Guardado'}. El bloque ${ok ? 'está' : 'NO está'} en la ficha.`);
console.log('  No hace falta deploy: la ficha se relee en cada turno.\n');

await closeDb();
