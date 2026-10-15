/**
 * El bloque del Día de la Madre en la ficha.
 *
 * Arrancó siendo la propuesta de venta que mandó Agus el 2 de octubre de 2026.
 * Desde la noche del 14 de octubre es lo contrario: los box se agotaron y los
 * pedidos cerraron, así que el bloque existe para que el bot NO los venda y
 * sepa atender a las trescientas personas que ya pagaron y retiran el sábado.
 *
 * POR QUÉ NO SE BORRA Y YA: porque el bloque no es solo la oferta. Adentro
 * están el horario de retiro, la dirección, que lo puede buscar otra persona,
 * que no se manda en cadete y lo de la cadenita. Borrarlo dejaría al bot sin
 * con qué contestarle a la gente que tiene el box pago. Lo que se saca es la
 * venta; lo que atiende a quien ya compró se queda.
 *
 * La ficha vive en los ajustes, así que esto NO necesita deploy: el bot la
 * relee en cada turno.
 *
 * Es idempotente: si el bloque ya está, lo reemplaza.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/ficha-box-de-la-madre.mts
 *   npx tsx --env-file=../../.env.produccion scripts/ficha-box-de-la-madre.mts --borrar
 */
import { openDb, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

/*
  EL TÍTULO CAMBIÓ, y eso importa para que esto siga siendo idempotente: el
  bloque viejo se llamaba "— SE RETIRAN EL SÁBADO 17 DE OCTUBRE" y hay que
  sacarlo además del nuevo, o quedan los dos en la ficha y el viejo todavía
  dice cómo vender algo que ya no existe.
*/
const TITULO = 'BOX DEL DÍA DE LA MADRE — PEDIDOS CERRADOS, SE RETIRAN EL SÁBADO 17';
const TITULO_VIEJO = 'BOX DEL DÍA DE LA MADRE — SE RETIRAN EL SÁBADO 17 DE OCTUBRE';

const BLOQUE = `
${TITULO}

LOS PEDIDOS ESTÁN CERRADOS Y LOS BOX ESTÁN AGOTADOS. No se ofrecen, no se toman pedidos nuevos y NO se pasan precios de estos dos box. Ni aunque pregunten por el Día de la Madre, ni aunque pidan un regalo para mamá, ni aunque nombren un box por su nombre. Todo lo que sigue acá abajo es para atender a quien YA encargó y pagó, no para vender.

El 14 de octubre a la noche el local los apagó del catálogo porque quedaban diez, y el bot los siguió ofreciendo igual durante una hora —y con el precio viejo, porque al apagarlos se quedó sin el precio bueno y usó el único número que le quedaba escrito—. Se estuvo a punto de vender box que no existen. Por eso esto está arriba de todo y es terminante.

SI PREGUNTAN POR LOS BOX DEL DÍA DE LA MADRE, la respuesta es que se agotaron y que los pedidos ya cerraron, dicho con pena y con buena onda. No se les da precio, no se les manda la foto, no se les cuenta qué traen para tentarlos, y no se les ofrece anotarlos en una lista ni avisarles si se libera alguno. Si insisten mucho o se enojan, no decidas vos: decile que lo estás viendo y que en un ratito le confirman. Eso lo resuelve una persona del local.

Sí se les puede ofrecer el resto del catálogo: desayunos, box de siempre, tortas. Eso sigue andando normal.

LO QUE SIGUE ES PARA QUIEN YA ENCARGÓ Y PAGÓ.

RETIRO: el sábado 17 de octubre, en el local, de 14 a 21 hs, en Marcos Paz 473. Lo puede retirar otra persona sin problema: tiene que decir el nombre y apellido de quien lo encargó y saber cuál de los dos box es.

El sábado 17 el local abre a las 8 como siempre, pero los box NO se entregan hasta las 14. Son dos cosas distintas y confundirlas ya costó un disgusto: el 13 de octubre una clienta que acababa de pagar preguntó si podía pasar a las 9 y el bot le dijo que sí, porque le contestó con el horario del local. Una persona tuvo que entrar a desdecirlo. Si preguntan si pueden pasar antes de las 14, la respuesta es que no, con buena onda, pero es no.

NO SE MANDA EN CADETE NI EN UBER, y no se ofrece ni como alternativa. Ese día el local está a full y el box es delicado. Si preguntan o insisten, se les dice que recomendamos que lo retire alguien en persona para que llegue en perfectas condiciones.

QUÉ TRAE CADA UNO, para responderle a quien ya lo tiene pago:
- Box "gracias por todo": brownie franui, pavlova de durazno, shot de suspiro limeño, shot de panacota, cookie de frambuesa, 2 alfajores —uno de frutos rojos y uno de pistacho—, sandwich de jamón y queso, 2 chipá, conito de dulce de leche y jugo de naranja. Viene con una cadenita de regalo de la marca Chini.
- Box "te amo má": taza de cerámica, mini brownie, mini pavlova, mini alfajor de pistacho y shot de suspiro limeño.

Esto es para quien ya lo pagó. A quien pregunta para comprar no se le cuenta qué trae: se le dice que se agotaron.

LA CADENITA DEL VIDEO SE AGOTÓ. El modelo que se ve en el video de Instagram ya no está. A quien ya encargó el box "gracias por todo" y pregunte, se le dice con estas palabras o parecidas:

"El modelo de cadenita del video se agotó pero igualmente lleva otro modelo hermoso de cadenita de la misma marca 🤗"

Si pregunta cuál es el modelo nuevo, no lo inventes: decile que es de la misma marca, Chini, y que lo chequeás.

NO SE MODIFICA NADA. Ni los productos, ni la cadenita, ni la taza. Los box van tal cual están armados. Si piden cambiar algo, la respuesta es que no, dicho con buena onda. No se ofrece consultarlo: ya está contestado acá.

SI LLEGA UN COMPROBANTE DE ALGUIEN QUE NO ESTABA ANOTADO, o un pedido desde la página web con uno de estos box adentro, NO lo confirmes ni le digas que fue tomado. Los box están agotados y eso puede ser plata de alguien que se va a quedar sin box. Decile que lo estás viendo y que en un ratito le confirman, y que lo mire una persona del local.

Y el pedido lo carga igual una persona del local en su sistema: el bot no lo anota.

La fecha, por si la preguntan: el Día de la Madre es el domingo 18 de octubre, y los box se retiran el sábado 17, el día anterior.
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
const sacar = (texto: string, titulo: string) =>
  texto
    .replace(
      new RegExp(`\\n*${titulo}[\\s\\S]*?(?=\\n[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ,/—-]{14,}\\n|$)`),
      '\n',
    )
    .trimEnd();

const sinBloque = sacar(sacar(ficha, TITULO), TITULO_VIEJO);

const nueva = borrar ? sinBloque : `${sinBloque}\n\n${BLOQUE}\n`;

console.log(`  ficha antes   : ${ficha.length} caracteres`);
console.log(`  sin el bloque : ${sinBloque.length}`);
console.log(`  ficha después : ${nueva.length}`);

const despues = await repos.settings.write({ conocimiento: nueva });
const texto = despues.conocimiento ?? '';
console.log(`\n  ${borrar ? 'Borrado' : 'Guardado'}. El bloque ${texto.includes(TITULO) ? 'está' : 'NO está'} en la ficha.`);
console.log(`  El bloque viejo ${texto.includes(TITULO_VIEJO) ? 'TODAVÍA ESTÁ — revisalo' : 'ya no está'}.`);
console.log('  No hace falta deploy: la ficha se relee en cada turno.\n');

await closeDb();
