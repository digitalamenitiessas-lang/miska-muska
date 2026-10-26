/*
  UNA TORTA O UN DESAYUNO NO LOS CONFIRMA EL BOT. NUNCA.

  Ya había una guarda para esto y no alcanzó, y la razón es la que importa:
  estaba en `crear_pedido`, o sea que solo corría cuando el bot INTENTABA cargar
  el pedido. El caso real de esta tarde no pasó por ahí. El bot escribió

    "Recibido! Ya queda anotada tu Torta Red Velvet de 20 porciones para el
     domingo a las 19:00 🎂  Te la esperamos en el local."

  sin llamar a ninguna herramienta. La guarda nunca corrió, el local nunca se
  enteró, y quedó una torta de veinte porciones comprometida para un domingo que
  nadie en la cocina sabía. Del local, esa misma tarde: "volvió a tomar tortas y
  desayunos sin que respondamos".

  Así que esta mira lo que el bot ESCRIBE, que es donde el daño ocurre. Lo que
  pidió Agus, con sus palabras: "si es más básico, directamente cuando pidan
  encargar desayuno o torta que lo derive al toque sin vueltas".

  No es una preferencia comercial como la del cadete: una torta comprometida y
  no producida es una fiesta sin torta. Va como guarda dura, reemplaza el
  mensaje y escala.
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
  DE QUÉ ESTAMOS HABLANDO.

  "mini torta" queda AFUERA a propósito y es la distinción más delicada de acá:
  una mini torta se vende del stock del día como una cookie, no se produce para
  una fecha, y bloquearla sería cortar una venta que hoy se cierra sola. Por eso
  la mini se descuenta antes de buscar "torta".
*/
const MINI = /\bmini\s+[a-záéíóúñ]+/g;

/*
  Los BOX tampoco están acá. El bot los viene tomando solo desde siempre y el
  local nunca lo objetó: lo que nombró Agus fue "desayuno o torta". Meterlos
  sumaba unos veinte bloqueos por día sobre ventas que hoy se cierran bien.
*/
const ES_ENCARGO = /\b(torta|tortas|chocotorta|tarta|tartas|red velvet|desayuno|desayunos)\b/;

/*
  "RED VELVET" ES UNA TORTA Y TAMBIÉN UNA COOKIE, y esa colisión frenó ocho
  ventas de mostrador en catorce días.

  El caso del local: una clienta pidió "1 cookie red velvet, 2 dubai, 2
  ferrero", el bot le pasó el total correcto y cuando ella dijo "te puedo
  transferir", la guarda le contestó "ya chequeo en la agenda si tenemos
  disponibilidad". Agus: "le ha contestado como cuando encargan una torta, en
  vez de contestarle que sí porque eso sí lo teníamos".

  La palabra está en la lista por la Torta Red Velvet, con razón. Pero cuando
  el mensaje habla de cookies, "red velvet" deja de ser señal de encargo: la
  cookie se vende del stock del día como cualquier otra.

  NO SE SACA DE LA LISTA, se neutraliza solo en ese contexto. Si además hay una
  torta de verdad, la palabra "torta" está en el mismo mensaje y la guarda corre
  igual —incluido el caso que originó todo esto, "Ya queda anotada tu Torta Red
  Velvet de 20 porciones"—. Medido: cambia 8 de 101 frenadas, y las 93 que
  quedan nombran torta, tarta o desayuno por su cuenta.
*/
const RED_VELVET = /\bred velvet\b/g;
const HAY_COOKIES = /\bcookies?\b/;

/*
  LA VENTANA TUVO QUE ENSANCHARSE, y esto es la corrección de mi propio
  arreglo. La primera versión preguntaba "¿este texto dice cookie?" mirando el
  mensaje y los dos anteriores, y el 13 de octubre a las 18:40 volvió a fallar:

    18:39 ella  "quería saber si les quedan cookies de red velvet"
    18:39 bot   "Sí, tenemos! 🍪 Cookie red velvet — $4.500"
    18:40 ella  "si si, 2 de las red velvet"
    18:40 ella  "para envío, puede ser?"
    18:40 bot   [frenado] "ya chequeo en la agenda si tenemos disponibilidad"

  La palabra "cookie" estaba, pero cuatro mensajes atrás. En los dos últimos
  ella ya decía "las red velvet" a secas, porque de qué hablaban ya estaba
  dicho. Quien sigue una charla no repite el sustantivo en cada frase.

  Por eso de qué se habla se decide con una ventana más ancha que la que usa
  el resto de la guarda. Las dos ventanas son distintas a propósito: la de
  `ES_ENCARGO` se midió en dos mensajes y ensancharla frena ventas buenas; esta
  solo decide si una palabra es ambigua, y equivocarse para este lado no frena
  nada.
*/
function sinRedVelvetDeCookie(plano: string, hayCookiesEnLaCharla = false): string {
  return hayCookiesEnLaCharla || HAY_COOKIES.test(plano) ? plano.replace(RED_VELVET, ' ') : plano;
}

/*
  EL PIE DEL PEDIDO DE LA WEB NO ES UNA TORTA.

  Todo pedido que se arma en la tienda online llega con el mismo texto de
  condiciones abajo: "*Las tortas se retiran de barrio norte y se abonan en
  efectivo al retirar (coordinar retiro por este medio)*". Lo pega la página,
  pidan lo que pidan, y la palabra "tortas" de ese renglón disparaba la guarda.

  Pasó el 24 y el 25 de octubre con el Box Halloween: entraba el pedido de la
  web, el bot contestaba "ya chequeo en la agenda si tenemos disponibilidad" y
  la charla caía en el panel como "[torta o desayuno]". Agus: "cuando vienen de
  la web no explica él? que se paga todo por transferencia, día de retiro, etc".

  Ya se había arreglado el 5 de octubre para los box del Día de la Madre, con
  una excepción atada a esa campaña. Cuando se borró la campaña, se fue con
  ella, y el agujero volvió con la siguiente. Por eso ahora se saca el renglón
  y no se exceptúa un producto: si el pedido de la web trae una torta de
  verdad, la torta está nombrada en los ítems y la guarda corre igual.
*/
const PIE_DE_LA_WEB = /\*?\s*las tortas se retiran de barrio norte[^*]*\*?/g;

function sinPieDeLaWeb(plano: string): string {
  return plano.replace(PIE_DE_LA_WEB, ' ');
}

/*
  EL BOT COMPROMETIÉNDOSE.

  Cada forma salió de un mensaje real. Lo que las une es que después de
  cualquiera de estas el cliente se queda tranquilo creyendo que ya está.
*/
const SE_COMPROMETE = [
  /\b(queda|quedo|quedas) (anotad|reservad|confirmad|guardad)/,
  /\bya (te )?(la|lo) (tenemos|anotamos|reservamos|confirmamos)\b/,
  /\b(anotad|reservad|confirmad)[oa] (para|el|tu)\b/,
  /\bte (la|lo) (esperamos|tenemos) (para|el)\b/,
  /*
    "Perfecto, entonces te lo confirmo: Torta kinder de 20 porciones — $50.000,
    para retirar el viernes". Ese "te lo confirmo" ya cerró la venta.

    Pero "te lo confirmo EN UN RATO" es lo contrario: es diferirlo, que es
    justamente lo que queremos. Por eso la excepción, y no al revés.
  */
  /\bte (la|lo) confirmo\b(?!\s+(en|cuando|apenas|ni bien|mas tarde|despues|ahora|ya))/,
  /\bconfirmad[oa]\b[^.!?]{0,30}\b(para el|para la|para manana|para hoy)\b/,
  /\blisto[,!]? (ya )?(queda|te la|te lo)\b/,
];

/*
  Y PEDIR PLATA, que es comprometerse igual o más: pasar el alias o pedir una
  seña por una torta es cerrar la venta. El caso de la chocotorta con decoración
  salió así — "el monto de la seña es de $17.400, el alias es miskapedidos"—,
  sin que nadie del local hubiera dicho que se podía hacer.
*/
const PIDE_PLATA = [
  /\bel alias es\b/,
  /\bte paso el alias\b/,
  /\balias:?\s*miska/,
  /\b(seña|senia|sena) (es|de|por)\b/,
  /\bmonto de la (seña|senia|sena)\b/,
];

export interface EncargoSinPersona {
  /** Qué lo disparó, para el log y para el motivo de la escalada. */
  motivo: string;
}

/**
 * ¿Este mensaje del bot compromete una torta o un desayuno por su cuenta?
 *
 * `hayHumano` apaga la guarda: si una persona del local ya habló en la charla,
 * la torta está autorizada y el bot puede seguir. Es la lección del domingo de
 * los envíos — una guarda que le discute a una empleada es peor que no tenerla.
 */
export function comprometeEncargo(
  texto: string,
  hayHumano: boolean,
  contexto = '',
  /**
   * ¿En esta charla se habló de cookies? Se calcula sobre una ventana más
   * ancha que `contexto`: ver `sinRedVelvetDeCookie`.
   */
  hayCookiesEnLaCharla = false,
): EncargoSinPersona | null {
  if (hayHumano) return null;

  /*
    EL CONTEXTO, porque el mensaje que pide la plata muchas veces no nombra la
    torta. El caso de la chocotorta con decoracion salio asi:
      "El monto de la seña es de $17.400 (30% de los $58.000).
       El alias es miskapedidos"

    Ni "torta" ni "chocotorta" en ese mensaje: la torta se habia hablado tres
    mensajes antes. Mirando solo el texto que sale, esta guarda lo dejaba pasar
    justo en el renglon donde se pide la plata, que es el que importa.

    El contexto son los ultimos mensajes de la charla y nada mas: una torta
    nombrada hace media hora, en una charla que despues compro cookies, no
    tiene que frenar la venta de las cookies.
  */
  const t = sinPieDeLaWeb(plano(texto)).replace(MINI, ' ');
  const ctx = sinPieDeLaWeb(plano(contexto)).replace(MINI, ' ');
  if (
    !ES_ENCARGO.test(sinRedVelvetDeCookie(t, hayCookiesEnLaCharla)) &&
    !ES_ENCARGO.test(sinRedVelvetDeCookie(ctx, hayCookiesEnLaCharla))
  ) {
    return null;
  }

  const compromiso = SE_COMPROMETE.find((re) => re.test(t));
  if (compromiso) return { motivo: 'lo dio por anotado' };

  const plata = PIDE_PLATA.find((re) => re.test(t));
  if (plata) return { motivo: 'pidió la transferencia' };

  return null;
}

/**
 * Lo único que el bot puede decir cuando alguien quiere encargar.
 *
 * Es la frase que pidió el local: "cuando digan que quieren encargar una torta,
 * 'perfecto, ahora te confirmo la disponibilidad', y ahí que lo derive".
 */
export const RESPUESTA_AL_ENCARGO =
  'Perfecto! Ya chequeo en la agenda si tenemos disponibilidad y te respondo a la brevedad 🙌🏼';

/*
  DESPUÉS DEL COMPROBANTE, EL UBER LO PIDE UNA PERSONA.

  Del local: "al toque que mandan el comprobante ya dice que manden uber.
  Recordá que debe decir que ya lo chequea y ahí valida una persona, y la
  persona dice también que manden el uber, nunca la IA".

  El motivo es plata: el bot no ve la transferencia. Si manda el Uber antes de
  que alguien mire la cuenta, el chofer llega a buscar un pedido que puede no
  estar pago —y el local se entera cuando ya salió.
*/
const ACUSA_EL_PAGO =
  /\b(recibido|recibi|lo tengo|llego (el|la|tu))\b|\bcomprobante\b|\bya nos ponemos a armar\b/;
const MANDA_EL_UBER = /\b(mandes|manda|mandas|pedis|pedi|pedir|envies|envia) (el|un) uber\b/;

/** ¿Está acusando el pago y de paso mandando el Uber? */
export function mandaElUberSinConfirmar(texto: string): boolean {
  const t = plano(texto);
  return ACUSA_EL_PAGO.test(t) && MANDA_EL_UBER.test(t);
}

/*
  TERMÓMETRO: el Uber y el costo del envío en el mismo mensaje.

  Si el Uber lo manda el cliente, no hay envío nuestro que cobrar ni que
  chequear: el viaje lo paga él y el precio se lo dice la app. Decir las dos
  cosas juntas —"mandá un Uber" y "el costo del envío te lo confirmo"— deja a
  la persona sin entender qué está esperando.

  Solo anota. La regla está escrita en la prosa; esto cuenta si alcanzó. Sobre
  9.149 mensajes de diez días, el bot ofreció chequear el costo del envío 126
  veces —28 solo hoy— y en 12 de ellas nombraba el Uber en el mismo mensaje.
*/
const OFRECE_COTIZAR_ENVIO =
  /(cheque|confirm|averigu|consult)[a-z]*[^.!?]{0,40}\b(el )?(costo|precio|valor|cuanto sale|monto)\b[^.!?]{0,30}\benvio\b|\benvio\b[^.!?]{0,40}\b(lo|te lo) (cheque|confirm)/;

/** ¿Dice que lo manda el cliente en Uber y encima ofrece cotizarle el envío? */
export function cotizaUnEnvioQueNoEsNuestro(texto: string): boolean {
  const t = plano(texto);
  return /\buber\b/.test(t) && OFRECE_COTIZAR_ENVIO.test(t);
}
