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
