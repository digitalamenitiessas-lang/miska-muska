/**
 * EL LOCAL YA DIJO QUE ESTÁ LISTO.
 *
 * Cuando una persona del local escribe "listo sofi para retirar!", la venta
 * quedó cerrada por alguien que estaba mirando el pedido de verdad. Desde ese
 * momento el bot no puede volver atrás: ni pedir el comprobante otra vez, ni
 * decir "lo estamos chequeando", ni "todavía lo estamos armando".
 *
 * El local: "a nosotros nos ha puesto que ya está para retirar y ahí le vuelve
 * a mandar 'lo estamos chequeando'. Tendría que tener coherencia ahí y entender
 * que si ya le hemos dicho que ya retira, no contestarle nada".
 *
 * El caso real: pedido #3253, $37.000, la clienta ya había mandado el
 * comprobante y una persona le había dicho que pasara a retirar. Nadie marcó el
 * pago en el panel, así que para la base seguía en 0 — y la guarda de la
 * dirección, que mira la base, le contestó "lo estamos chequeando y ya nos
 * ponemos a armar tu pedido" cuando el pedido ya estaba en el mostrador.
 *
 * Por eso esto mira el CHAT y no la base: quien sabe si la venta se cerró es la
 * persona que la cerró, y lo escribió ahí.
 *
 * MEDIDO sobre 1.350 mensajes reales escritos por el local en veinte días: 15
 * coinciden, poco más del uno por ciento. Todos son de verdad un "está listo" o
 * un "ya lo entregamos". Las formas que se probaron y se descartaron por
 * imprecisas están abajo, con el motivo.
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

/*
  Las formas en que el local avisa que el pedido está listo o entregado.
  Salieron de leer los mensajes, no de imaginarlas.

  El hueco entre "listo" y "para retirar" existe porque en el medio va el
  nombre: "listo sofi para retirar!" es el mensaje que destapó todo esto.
*/
const ESTA_LISTO: RegExp[] = [
  /\b(ya |yaa )?(esta|estan|quedo|quedaron)\b[^.?!]{0,20}\blist[oa]s?\b/,
  /\blist[oa]s?\b[^.?!]{0,24}\bpara (retirar|buscar|que (pase|pases|lo retire|la retire))\b/,
  /\bya (lo|la|los|las) (podes|puede|pueden) (retirar|buscar|pasar a buscar)\b/,
  /\bya (te )?(lo|la|los|las) (entregamos|entregue|entregaron|dimos)\b/,
  /\b(pedi|manda|mandalo|mandale|puede venir el|que venga el)\b[^.?!]{0,20}\buber\b/,
  /\bpodes (pasar|venir)\b[^.?!]{0,20}\b(a )?(retirar|buscar|buscarlo|retirarlo)\b/,
];

/*
  Lo que usa las mismas palabras y NO es un "está listo". Cada línea salió de un
  falso positivo real de la medición:

   - "te esperamos mañana" y "apenas esté listo te aviso" hablan del futuro, que
     es justo lo contrario.
   - "pedí el uber DESPUÉS de enviar el comprobante" es una instrucción de cómo
     se hace, no un aviso de que ya está.
   - una pregunta ("en cuánto podés pasar?") no confirma nada.
   - "me podés pasar tu dirección" agarraba con "podés pasar" y no tiene nada que
     ver: por eso el patrón de arriba exige "a retirar" o "a buscar" detrás.
*/
const NO_ES: RegExp[] = [
  /\?\s*$/,
  /\bmanana\b|\bpasado manana\b/,
  /\b(despues|antes) de\b/,
  /\bcuando (este|lo tengamos|salga|llegue)\b/,
  /\bapenas\b/,
  /\bno (esta|estan|lo tenemos)\b/,
  /\bte aviso\b/,
];

/** ¿Este mensaje del local dice que el pedido ya está listo o entregado? */
export function diceQueEstaListo(texto: string): boolean {
  const p = plano(texto);
  if (NO_ES.some((r) => r.test(p))) return false;
  return ESTA_LISTO.some((r) => r.test(p));
}

/**
 * ¿Alguien DEL LOCAL ya le dijo en esta charla que el pedido está listo?
 *
 * Solo cuentan los mensajes escritos por una persona (`author: 'human'`). Que
 * lo diga el bot no vale: el bot es justamente el que se equivoca, y tomarle la
 * palabra a su propio mensaje sería cerrar el círculo con su propio error.
 */
export function yaDijeronQueEstaListo(
  mensajes: Array<{ direction: string; author: string; text: string; createdAt: string }>,
): string | null {
  const dicho = mensajes.filter(
    (m) => m.direction === 'out' && m.author === 'human' && diceQueEstaListo(m.text),
  );
  return dicho.length ? dicho[dicho.length - 1].createdAt : null;
}
