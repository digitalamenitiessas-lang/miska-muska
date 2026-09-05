/**
 * ALGUIEN ESTÁ ESPERANDO EN LA PUERTA AHORA.
 *
 * Es el aviso más urgente que puede llegar por el chat: un Uber o un cadete
 * parado en Marcos Paz esperando que le entreguen un paquete. Si nadie sale, el
 * chofer se va y el pedido se cae — con la plata ya cobrada.
 *
 * El local lo reportó así: "toma pedidos sin derivarlo al humano, y el Uber ya
 * está fuera y nunca puso humano para que veamos el pedido". Y lo llamativo es
 * que el mensaje SIEMPRE llega: el propio mensaje rápido del local le pide a la
 * clienta "y un mensajito cuando esté afuera". Llegaba y no lo veía nadie.
 *
 * Esto NO le contesta a la clienta —de eso se ocupa el bot— ni frena nada:
 * enciende la alerta del panel, que es lo único que hace que alguien mire.
 *
 * MEDIDO ANTES DE ESCRIBIRLO, sobre 4.098 mensajes entrantes de cuatro días: 47
 * avisan una llegada, unos 12 por día. Es la frecuencia que tiene que tener algo
 * que pide salir a la puerta; si fueran cien, dejarían de mirarlas.
 */

/** Sin tildes y con los espacios planchados, que es como se compara. */
function plano(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Las formas en que la gente avisa que el chofer está. Salieron de la base. */
const ESTA_ESPERANDO: RegExp[] = [
  /\b(esta|estoy) (afuera|en la puerta|esperando)\b/,
  /\bahi (esta|estan)\b/,
  /\b(esta|estan) (ahi|aca|aqui)\b/,
  /\besta a (un|1|dos|2|tres|3|cinco|5) (min|minuto|minutos|cuadra|cuadras)\b/,
  /\b(el|la|un|una) (uber|didi|cadete|chofer|conductor|moto|remis|delivery)\b[^.?!]{0,25}\b(esta|llego|afuera|en la puerta|ahi|esperando)\b/,
  /\b(ya )?lleg(o|aron)\b[^.?!]{0,20}\b(uber|didi|cadete|chofer|moto|remis)\b/,
  /\bya (esta|llego) (el|la) (uber|didi|cadete|chofer|moto|remis)\b/,
  /*
    "Ya está llegando el Uber" es un aviso igual de urgente, y además el mejor:
    llega un minuto ANTES de que el chofer frene en la puerta, que es justo el
    minuto que hace falta para salir con el paquete.

    Se agregó después de medirlo: sobre 7.707 mensajes entrantes de veinticinco
    días suma 8 casos, los 8 de verdad, sin ningún falso positivo. Los "me está
    llegando" —la clienta contando que YA lo recibió— los saca NO_ES.
  */
  /\b(ya )?(esta|estan) (llegando|por llegar)\b/,
  /\bya (viene|sale|salio) (el|la|un|una) (uber|didi|cadete|chofer|moto|remis)\b/,
];

/*
  Lo que se le parece y no es una llegada al local. Cada línea salió de un falso
  positivo real de la medición:

   - "me llegó" es la clienta diciendo que YA LO RECIBIÓ, que es el otro extremo
     de la historia.
   - "ahí está el comprobante" usa las mismas palabras para otra cosa.
   - una pregunta ("llegó?") es alguien preguntando, no avisando.
   - "gracias" en el mismo mensaje es un agradecimiento por algo terminado.
   - una negación es un reclamo, y ese ya tiene su propio camino.
*/
const NO_ES: RegExp[] = [
  /\bme (lleg|llego|va a llegar)/,
  /\b(comprobante|captura|transferencia|el pago)\b/,
  /\?\s*$/,
  /\bgracias\b/,
  /\bno (lleg|esta|ha llegado)/,
  /\bcuando\b/,
  /\bsi puedo\b/,
];

/**
 * Lo que se le contesta a quien avisa que el chofer llegó.
 *
 * El bot contestaba "Perfecto, ya le avisamos que está esperando 🙌" y el local
 * preguntó lo obvio: "¿a quién le avisa?". Del otro lado eso no significa nada.
 *
 * Lo que pidió el local, con sus palabras: "cuando digan que el Uber está
 * fuera, que responda: perfecto, ya se lo entregamos, si podés avisale que se
 * acerque hasta la ventanita de Miska Muska con tu nombre. A veces hay Ubers
 * que son re piolas y se acercan, y ahí nos salvaría".
 *
 * El segundo renglón es el que trabaja: le da al cliente algo para hacer que
 * de verdad ayuda —que el chofer se acerque y pregunte por su nombre— en vez de
 * un acuse de recibo que no le sirve a nadie.
 *
 * El primero se dice en presente y no en pasado ("ya salimos a entregárselo",
 * no "ya se lo entregamos"): el bot no sabe si alguien llegó al mostrador
 * todavía, y afirmar una entrega que no pasó es la misma clase de mentira que
 * ya frena `afirmaQueYaSalio`.
 */
export const RESPUESTA_A_LA_LLEGADA =
  'Perfecto! Ya salimos a entregárselo 🙌🏼\n\n' +
  'Si podés, avisale que se acerque a la ventanita de Miska Muska y pregunte por tu ' +
  'nombre, así lo tiene enseguida 🩷';

/** ¿Este mensaje avisa que hay alguien esperando en la puerta? */
export function avisaQueLlego(texto: string): boolean {
  const p = plano(texto);
  if (NO_ES.some((r) => r.test(p))) return false;
  return ESTA_ESPERANDO.some((r) => r.test(p));
}

/** Lo que ve quien atiende. Le dice qué hacer, no qué pasó. */
export const AVISO_DE_LLEGADA =
  '[llegó] Salí a la puerta: avisan que el que viene a retirar ya está esperando. ' +
  'Si nadie sale, el chofer se va y el pedido se cae.';
