/*
  EL TIP DE LAS COOKIES, DESPUÉS DE QUE PAGAN.

  Está en la ficha del local desde hace meses, con estas palabras: "cada vez que
  un cliente compre, encargue o confirme un pedido que incluya una o más
  cookies, agregar al final la siguiente información".

  Y no se cumplía. Medido sobre 126 pedidos con cookies de siete días: el tip
  salió en 44, el 35%. Curiosamente el modelo chico lo manda MÁS que el grande
  —17 y 14 los últimos dos días contra 4 el jueves— así que no es que se haya
  perdido con el cambio: nunca fue confiable.

  Es de las cosas que no tienen por qué depender de que el modelo se acuerde.
  El pedido está cargado, sabemos qué tiene adentro, y sabemos que acaba de
  entrar el comprobante. Se agrega y listo.

  EL MOMENTO LO ELIGIÓ EL LOCAL: "esto era una vez que pagaban y mandaban la
  cookie". No cuando arman el pedido ni cuando preguntan precios — cuando ya
  transfirieron. Por eso no alcanza con mirar el pedido: hay que mirar también
  la charla, y de eso se ocupan las dos funciones de abajo.

  LA EXCEPCIÓN DEL BOX DE EDICIÓN LIMITADA también está en la ficha y también es
  del local: ese box trae cuatro cookies y tres llevan crema, así que ahí se
  calienta SOLO la Volcán de Chocolate y cinco segundos, no diez. Decirle a
  alguien que caliente una cookie con crema es arruinarle la cookie.
*/

/** Lo que se agrega cuando el pedido trae cookies sueltas. */
export const TIP_DE_LAS_COOKIES =
  '🍪 Un tip: calentalas 10 segundos en el microondas antes de comerlas, quedan mucho más ' +
  'ricas 🤤 No necesitan heladera — guardalas en una bolsa bien cerrada a temperatura ' +
  'ambiente 🩷';

/** Y lo que se agrega cuando lo que compró es el Box de Edición Limitada. */
export const TIP_DEL_BOX_LIMITADO =
  '🍪 Un tip: de las cuatro, calentá SOLO la Volcán de Chocolate, 5 segundos en el ' +
  'microondas 🤤 Las otras tres llevan crema, así que esas van tal cual 🩷';

/** Un ítem de pedido, con lo poco que hace falta mirar. */
export interface ItemDelPedido {
  description?: string | null;
  productId?: string | null;
}

/** Lo mínimo que hace falta saber de un mensaje para decidir esto. */
export interface MensajeParaElTip {
  direction: 'in' | 'out';
  text: string;
  contentKind: string;
}

const ES_COOKIE = /\bcookies?\b/i;
const ES_BOX_LIMITADO = /\bedici[oó]n limitada\b/i;

/**
 * El tip que corresponde a este pedido, o `null` si no lleva cookies.
 *
 * Mira la descripción y el id, porque los dos caminos existen: el bot escribe
 * "Cookie Dubai" y el id es "cookie-dubai", pero el Box de Cookies Edición
 * Limitada se llama así y su id no dice cookie.
 */
export function tipDeCookies(items: ItemDelPedido[]): string | null {
  const texto = items.map((i) => `${i.description ?? ''} ${i.productId ?? ''}`).join(' ');
  if (ES_BOX_LIMITADO.test(texto)) return TIP_DEL_BOX_LIMITADO;
  return ES_COOKIE.test(texto) ? TIP_DE_LAS_COOKIES : null;
}

/**
 * ¿El comprobante entró recién, o fue hace media conversación?
 *
 * `llegoComprobante` contesta si llegó ALGUNA VEZ, que es lo que necesitan el
 * aviso de la bandeja y la inscripción a un curso. Acá hace falta la otra
 * pregunta: el tip va pegado al comprobante, no diez mensajes después, porque
 * si no aparece suelto en medio de otra charla y se lee raro.
 *
 * La ventana cuenta mensajes, no minutos, y son ocho a propósito: entra el
 * "ya te lo mandé", el "gracias", el nombre del titular de la cuenta y alguna
 * repregunta, que es lo que pasa siempre entre la foto y nuestra respuesta.
 */
export function elComprobanteEntroRecien(
  mensajes: MensajeParaElTip[],
  ventana = 8,
): boolean {
  for (let i = mensajes.length - 1; i >= 0; i -= 1) {
    const m = mensajes[i];
    if (m.direction !== 'in') continue;
    if (m.contentKind !== 'image' && m.contentKind !== 'document') continue;
    return mensajes.length - i <= ventana;
  }
  return false;
}

/*
  Y no se manda dos veces.

  Se busca "microondas" en lo que salió de este lado —del bot o de una persona
  del local— y no el tip completo: si una de las chicas ya se lo dijo con sus
  palabras, o si el modelo se acordó solo (que pasa el 35% de las veces), el tip
  nuestro sobra. Un consejo repetido en la misma charla se lee como que no
  estamos leyendo.
*/
const YA_LO_DIJIMOS = /\bmicroondas\b/i;

/** ¿Este texto ya habla de calentar las cookies? */
export function hablaDelMicroondas(texto: string): boolean {
  return YA_LO_DIJIMOS.test(texto);
}

/**
 * ¿Alguien de este lado ya le dijo lo del microondas en esta charla?
 *
 * Ojo con lo que NO alcanza: mirar solo el historial. El primer día salieron
 * dos mensajes con el tip repetido —el del modelo y el nuestro, uno abajo del
 * otro en la misma burbuja— porque el modelo lo había escrito en ESE turno, que
 * todavía no es historial. Por eso `hablaDelMicroondas` vive aparte: en el
 * pipeline hay que preguntarle también a lo que está por salir.
 */
export function yaMandamosElTip(mensajes: MensajeParaElTip[]): boolean {
  return mensajes.some((m) => m.direction === 'out' && hablaDelMicroondas(m.text));
}
