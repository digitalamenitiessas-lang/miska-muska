/*
  EL BOX DEL DÍA DE LA MADRE LO CARGA UNA PERSONA. SIEMPRE.

  Agus, el 2 de octubre, y lo dijo dos veces en el mismo audio:

    "Esto sí tengo mucho miedo, porque si nos llega a pasar algún pedido o algo,
     después estamos muertos, porque ese día llega la persona a buscarlo y no
     está el pedido tomado. Entonces sí es necesario que cuando la persona pase
     el dato de la transferencia lo derive a un humano para que nosotros lo
     podamos cargar."

  CHOCA DE FRENTE CON LO QUE EL BOT HACE HOY. Cuando entra un comprobante el
  pipeline arma el pedido solo —el rescate, que en diez días recuperó 85 ventas
  que iban a quedar cobradas y sin registrar—. Para estos box eso es
  exactamente lo que no hay que hacer: si lo carga el bot Y lo carga una
  persona, quedan dos box para la misma clienta; y si lo carga el bot y nadie
  mira, los datos no entran al sistema del local y el 17 de octubre alguien
  llega a buscar algo que no existe.

  Así que acá el rescate se APAGA y el aviso se ENCIENDE.

  Y SE ENCIENDE AUNQUE NO HAYAMOS PASADO EL ALIAS. Esa es la diferencia con el
  aviso normal de comprobantes, que exige haber pasado el alias antes para no
  sonar con cualquier foto. Acá no sirve: el alias de esta propuesta sale
  publicado en Instagram, así que una clienta puede transferir y mandar el
  comprobante sin que de este lado se lo hayamos dicho nunca. Con la regla
  normal esa charla entraría muda.

  EL COSTO DE EQUIVOCARSE NO ES SIMÉTRICO, y por eso la guarda se inclina a
  avisar de más: una alerta de sobra son diez segundos de alguien mirando una
  conversación; una alerta de menos es una señora el sábado 17 en la puerta.

  ──────────────────────────────────────────────────────────────────────────
  POR QUÉ "GRACIAS POR TODO" NO SE BUSCA SUELTO.

  Es el nombre de uno de los box y también lo que escribe media clientela
  cuando se va contenta. Buscarlo solo sería encender el cartel en cada charla
  que termina bien. Por eso los dos nombres de box piden tener "box" cerca, y
  lo único que vale por sí solo es "día de la madre", que nadie dice de paso.

  Medido sobre los mensajes reales de 30 días: ver `probar-dia-de-la-madre.mts`.
*/

/** Los dos productos, como quedaron cargados en el catálogo. */
export const BOXES_DE_LA_MADRE = ['box-madre-gracias-por-todo', 'box-madre-te-amo-ma'];

/*
  "Día de la madre" vale solo. Los nombres de los box necesitan "box" al lado,
  dentro de la misma frase, en cualquiera de los dos órdenes.
*/
const SEÑALES: RegExp[] = [
  /d[ií]a de la madre/i,
  /\bbox\b[^.!?\n]{0,40}gracias por todo/i,
  /gracias por todo[^.!?\n]{0,25}\bbox\b/i,
  /*
    Ojo con el \b después de "má": en JavaScript la "á" NO es carácter de
    palabra, así que `m[aá]\b` no engancha "má" seguido de comilla o dos
    puntos —justo como lo escribe Agus: Box "te amo má": $35.000—. El corte se
    hace con un lookahead de letra, que además deja afuera "te amo mamá".
  */
  /\bbox\b[^.!?\n]{0,40}te amo m[aá](?![a-záéíóúñ])/i,
  /te amo m[aá](?![a-záéíóúñ])[^.!?\n]{0,25}\bbox\b/i,
];

/** ¿Este texto habla de los box del Día de la Madre? */
export function hablaDelBoxDeLaMadre(texto: string): boolean {
  return SEÑALES.some((r) => r.test(texto));
}

/** Lo mismo sobre una charla entera: alcanza con que lo diga cualquiera de los dos. */
export function laCharlaEsDeBoxDeLaMadre(
  mensajes: Array<{ text?: string | null }>,
): boolean {
  return mensajes.some((m) => Boolean(m.text) && hablaDelBoxDeLaMadre(m.text!));
}

/*
  ──────────────────────────────────────────────────────────────────────────
  NO SE OFRECE UN BOX QUE YA NO ESTÁ.

  La noche del 14 de octubre quedaban diez box y el local los apagó del
  catálogo, que es la palanca que usan para decir "esto ya no se vende". El bot
  los siguió ofreciendo una hora larga, en cuatro charlas, y encima al precio
  promocional que ya no existía. Agus, a las 22:30: "me preocupo porque literal
  nos quedan los últimos 10 box y ya no tenemos más para vender y vamos a
  sobrevender".

  Dos cosas fallaron a la vez, y la segunda es la que duele: la ficha describía
  los dos box enteros, así que el bot podía armar la oferta sin mirar el
  catálogo; y el único precio que le quedaba escrito, una vez apagado el
  producto, era el viejo. APAGAR EL PRODUCTO EMPEORÓ EL MENSAJE en vez de
  callarlo. La ficha ya se arregló, pero la ficha es prosa: esto es la red.

  QUÉ MIRA: que el bot no VENDA un box que el catálogo tiene apagado. Nombrarlo
  está bien y hace falta —hay trescientas personas que ya lo pagaron y preguntan
  por el retiro, el horario y la cadenita—. Lo que no puede pasar es ofrecerlo,
  ponerle precio o pedir la transferencia.

  POR QUÉ NO ALCANZABA LA GUARDA DE STOCK que ya existe: esa mira los productos
  sueltos que el mensaje cobra, y para estos box está apagada a propósito,
  porque el CONTENIDO del box nombra cosas apagadas —los alfajores, la taza— y
  borraba precios buenos. Aquella cuida los ingredientes; esta cuida el box.
*/

/** Un box del Día de la Madre que hoy no se vende, como viene del catálogo. */
export interface BoxApagado {
  id: string;
  name: string;
}

/*
  Vender es poner precio o pedir la plata. Nombrar, contar qué trae o hablar del
  retiro, no.
*/
const PONE_PRECIO = /\$\s?\d|\b\d{2}\.?\d{3}\b|\bsale\b|\bcuesta\b|\bprecio\b|\bvale\b/i;
const PIDE_LA_PLATA_DEL_BOX =
  /\balias\b|\btransferi|\btransferencia\b|\bcomprobante\b|\bseña\b|\bmiskapedidos\b/i;
/*
  Y presentar las opciones también es vender, aunque no haya número: "tenemos
  dos opciones para el Día de la Madre" seguido de las fotos fue exactamente el
  mensaje de las 22:10.
*/
const OFRECE = /\btenemos\b|\bopciones?\b|\bten[ée]s\b|\bpod[ée]s (llevar|elegir|encargar)\b|\bpara encargar\b|\bcu[aá]l te (interesa|gustar[ií]a)\b/i;

/*
  Decir que no hay es justamente lo que queremos: si el mensaje ya lo aclara, no
  se toca. Se repite acá en vez de importarlo de `stock.ts` porque aquel módulo
  no exporta el patrón y copiarlo entero ataría dos guardas que cambian por
  motivos distintos.
*/
const YA_DICE_QUE_NO_HAY =
  /\bse (agot|termin)|\bagotad|\bsin stock\b|\bya no (hay|quedan?|tenemos|los tenemos|nos quedan)\b|\bno (nos )?quedan?\b|\bcerramos los pedidos\b|\bpedidos? (ya )?(est[aá]n )?cerrad/i;

/**
 * ¿Este mensaje está VENDIENDO un box que el catálogo tiene apagado?
 *
 * Devuelve los box en cuestión, o vacío si no hay problema. `apagados` son los
 * box del Día de la Madre con `availableToday` en false: si el local los vuelve
 * a encender, esta guarda se apaga sola y nadie tiene que acordarse de nada.
 */
export function vendeUnBoxQueNoEsta(texto: string, apagados: BoxApagado[]): BoxApagado[] {
  if (!apagados.length) return [];
  if (!hablaDelBoxDeLaMadre(texto)) return [];
  if (YA_DICE_QUE_NO_HAY.test(texto)) return [];
  const vende = PONE_PRECIO.test(texto) || PIDE_LA_PLATA_DEL_BOX.test(texto) || OFRECE.test(texto);
  if (!vende) return [];
  /*
    Cuál de los dos aparece. Si el mensaje presenta las dos opciones y los dos
    están apagados, vuelven los dos; si solo uno está apagado, vuelve ese.

    El caso que no hay que perder es el mensaje que dice "día de la madre" y
    ofrece sin nombrar ningún box por su nombre —"tenemos dos opciones
    hermosas", que fue el de las 22:10—: ahí no hay nombre que matchear, así
    que si no se reconoce ninguno vuelven todos los apagados.
  */
  const nombrados = apagados.filter((b) => NOMBRE_DE_BOX(b).test(texto));
  return nombrados.length ? nombrados : apagados;
}

/** El patrón que reconoce a cada box por su nombre dentro de un mensaje. */
function NOMBRE_DE_BOX(box: BoxApagado): RegExp {
  return /gracias por todo/i.test(box.name)
    ? /gracias por todo/i
    : /te amo m[aá](?![a-záéíóúñ])/i;
}

/**
 * Lo que se manda en lugar del mensaje que vendía algo que ya no hay.
 *
 * Dice la verdad y cierra la puerta, porque la puerta está cerrada: el local
 * apagó los dos box cuando le quedaban diez. No ofrece anotar en una lista ni
 * avisar si se libera alguno, que es lo que el bot inventaría solo.
 */
export const TEXTO_BOX_AGOTADO =
  'Los box del Día de la Madre ya se agotaron y cerramos los pedidos 🥺 ' +
  'Mil gracias por escribirnos igual! Si querés te cuento qué otras cosas tenemos 🫶🏼';

/**
 * El cartel que ve el local. Dice qué hacer, no solo que pasó algo.
 *
 * Cambia según haya o no un pedido anotado, y las dos versiones terminan en lo
 * mismo: esto va al sistema de ustedes. Que el bot haya dejado una ficha no
 * reemplaza eso —Agus fue claro en que los datos los toma una persona—, así
 * que el cartel no se calla ni cuando el pedido ya existe.
 */
export function motivoDelBoxDeLaMadre(pedidoNumero?: number): string {
  const base = '[box día de la madre] Llegó un comprobante de un box del Día de la Madre. ';
  /*
    Los cinco datos van escritos en el cartel y no en la cabeza de nadie. Son
    los que Agus pidió el 2 de octubre —"nombre, apellido, DNI, celular y el
    box que quieran encargar"— y son los que hay que copiar al sistema del
    local. Un aviso que dice "cargalo" y no dice qué cargar obliga a ir a
    buscar la lista a otro lado.
  */
  const cierre =
    'Datos a cargar: nombre, apellido, DNI, celular y cuál de los dos box. ' +
    'Se retira el sábado 17 de 14 a 21.';
  return pedidoNumero
    ? `${base}El bot dejó anotado el #${pedidoNumero}, pero los datos de la clienta hay que ` +
        `pasarlos igual al sistema de ustedes. ${cierre}`
    : `${base}Cargalo vos a mano: el bot NO lo cargó a propósito, porque estos tienen que ` +
        `quedar en el sistema de ustedes. ${cierre}`;
}
