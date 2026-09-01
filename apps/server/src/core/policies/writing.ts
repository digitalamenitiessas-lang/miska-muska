/**
 * Cómo se escribe, en código.
 *
 * La forma cuesta credibilidad igual que la plata: la dueña lee cada mensaje, y
 * un signo de apertura o un "te copa alguno?" le suenan a otra marca. Así que va
 * dos veces, como las reglas de negocio: en prosa en el system prompt (el bloque
 * WRITING de `agent/persona.ts`) y como guarda acá.
 *
 * Lo que se corrige en código es solo lo determinista y sin pérdida: borrar el
 * signo de apertura y traducir "copa". Cuántos emojis lleva un mensaje NO se
 * decide acá: eso es criterio, no regla, y una guarda que los borra a ciegas le
 * saca el 🙏🏻 justo al mensaje del papá internado. Eso vive solo en el prompt.
 *
 * Se aplica al texto que genera el modelo y al que sale de un mensaje rápido.
 * NO se aplica a lo que escribe una persona del local: corregirle la ortografía
 * a Mica sería un bug, no una mejora.
 */

/*
  Signos de apertura del español. El equipo escribe solo el de cierre.

  Los dos regex quedan privados a propósito: llevan la bandera `g`, así que
  guardan `lastIndex` entre llamadas y basta que alguien de afuera les haga
  `.test()` para que la siguiente normalización arranque desde la mitad del texto.
  Es un bug que aparece una vez cada mil mensajes; no exportarlos lo hace
  imposible.
*/
const SIGNO_PEGADO_A_ESPACIO = /([ \t])[ \t]*[¿¡]+/g;
const APERTURA = /[¿¡]+/g;

/*
  "copa" no se usa: no es una palabra de la casa. El mapa es CERRADO y está
  anclado a "te/me + copa", así nunca toca una "copa de mousse" ni un producto
  futuro que se llame Copa. Si aparece una forma que no está acá, sale igual y se
  agrega a mano: reescritura libre no, porque no sería auditable.
*/
const COPA: Array<[RegExp, string]> = [
  [/\bte coparí([ao])\b/gi, 'te gustarí$1'],
  [/\bte copan\b/gi, 'te gustan'],
  [/\bte copa\b/gi, 'te gusta'],
  [/\bme copan\b/gi, 'me gustan'],
  [/\bme copa\b/gi, 'me gusta'],
];

/*
  Vocabulario de adentro que se le escapa al cliente.

  El caso real: preguntaron "venden salsa?" y el bot contestó "No tenemos salsa
  en el catálogo, así que no la vendemos". Fuera de que suena seco, le mostró al
  cliente cómo funcionamos por dentro: él no sabe que existe un catálogo, y no
  tiene por qué enterarse.

  Se BORRA la muletilla y no se reescribe la frase. "no tenemos salsa en el
  catálogo" queda "no tenemos salsa", que sigue siendo castellano y sigue
  diciendo lo mismo. El tono lo arregla el prompt; esto solo saca la palabra que
  nunca tendría que haber salido.
*/
const JERGA_INTERNA: Array<[RegExp, string]> = [
  [/s+en (?:el|nuestro|mi) cat[áa]logo/gi, ''],
  [/s+en (?:el|nuestro|mi) sistema/gi, ''],
  [/s+en (?:la|nuestra|mi) base(?: de datos)?/gi, ''],
  [/no (?:lo |la |los |las )?tengo cargad[oa]s?/gi, 'no tenemos'],
];

/*
  Hablar desde el lado equivocado del mostrador.

  El caso real: "hoy retiramos hasta las 21:30". Retirar lo hace la CLIENTA; el
  local no retira nada. Dicho en primera persona del plural queda al revés, y a
  quien lo lee le suena a que somos nosotros los que vamos a buscar el pedido.
  Lo que el local dice es "hoy estamos hasta las 21:30".

  Mismo criterio que las otras dos tablas: mapa CERRADO y anclado a la forma
  exacta que apareció. "Retiramos" suelto NO se toca, porque hay frases donde
  está bien ("si no lo retiran, lo retiramos de la vitrina"); lo que se corrige
  es el uso horario, que es el que salió mal y el único que es siempre un error.
*/
/** Mantiene la mayúscula inicial del original. */
function comoVenia(original: string, reemplazo: string): string {
  return original[0] === original[0].toUpperCase()
    ? reemplazo[0].toUpperCase() + reemplazo.slice(1)
    : reemplazo;
}

/*
  Se pide que lo que sigue sea UN HORARIO, y no alcanza con la preposición.
  "Lo retiramos de la vitrina a la noche" está bien dicho —ahí el que retira es
  el local— y con un patrón más suelto quedaba "lo estamos de la vitrina".
  El reemplazo es una función para no perder la mayúscula cuando la frase
  arranca con "Retiramos".
*/
const LADO_EQUIVOCADO: Array<[RegExp, (coincidencia: string) => string]> = [
  [
    new RegExp(
      /*
        El espacio va DENTRO del lookahead y con su propio grupo. Afuera, el
        match se lo comía y quedaba "Estamosdesde las 9"; y sin el grupo, el `|`
        parte el patrón entero y el espacio solo valdría para la primera
        alternativa.
      */
      '\\bretiramos(?= (?:' +
        // "hasta las 21:30", "de 9 a 21", "desde las 9"
        '(?:hasta|desde|de) (?:las? |los? |el )?\\d' +
        '|' +
        // "los sábados hasta las 22"
        'los (?:lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bados?|domingos?)\\b' +
      '))',
      'gi',
    ),
    (coincidencia) => comoVenia(coincidencia, 'estamos'),
  ],
];

/*
  "no figura" y "no me aparece" quedaron AFUERA a propósito, y vale la pena que
  esté escrito para que nadie los agregue de nuevo con buena intención: cambiarlos
  por "no tenemos" da vuelta el orden de la frase. "Esa torta no figura" salía
  como "Esa torta no tenemos", que es castellano roto — y un mensaje mal escrito
  es peor que uno con una palabra de más. De esos dos se ocupa el prompt.
*/

export interface WritingResult {
  text: string;
  /** Qué hubo que corregir. Vacío significa que el prompt cumplió solo. */
  fixes: string[];
}

/**
 * Normaliza un texto del bot. Idempotente, y seguro sobre alias, precios,
 * direcciones, links y {{placeholders}}: solo borra dos caracteres y reemplaza
 * una palabra anclada.
 *
 * Se compara el resultado en vez de usar `.test()` a propósito: un regex con la
 * bandera `g` guarda `lastIndex` entre llamadas y `test` lo mueve, así que
 * mezclarlo con `replace` sobre la misma constante es una fuente de bugs que se
 * ven una vez cada mil mensajes.
 */
export function normalizeWriting(text: string): WritingResult {
  const fixes: string[] = [];
  let out = text;

  /*
    Dos pasadas en vez de borrar y después aplastar espacios. Aplastar todos los
    runs de dos o más espacios del mensaje entero rompía la sangría de las listas
    del equipo (la carta de cookies, los renglones de datos con ▫️) cada vez que
    aparecía un signo en cualquier otra parte del texto. Acá solo se toca el hueco
    donde estaba el signo.
  */
  const sinApertura = out.replace(SIGNO_PEGADO_A_ESPACIO, '$1').replace(APERTURA, '');
  if (sinApertura !== out) {
    fixes.push('signo de apertura');
    out = sinApertura;
  }

  for (const [re, to] of COPA) {
    const traducido = out.replace(re, to);
    if (traducido !== out) {
      fixes.push('la palabra copa');
      out = traducido;
    }
  }

  for (const [re, to] of JERGA_INTERNA) {
    const limpio = out.replace(re, to);
    if (limpio !== out) {
      fixes.push('vocabulario interno');
      out = limpio;
    }
  }

  for (const [re, aDerechas] of LADO_EQUIVOCADO) {
    const derecho = out.replace(re, (m) => aDerechas(m));
    if (derecho !== out) {
      fixes.push('lado equivocado del mostrador');
      out = derecho;
    }
  }

  return { text: out.trim(), fixes };
}

/*
  Saludos con los que arrancan varios mensajes rápidos del equipo. Están bien
  cuando el mensaje abre la charla, y quedan mal cuando la charla ya empezó: el
  cliente pregunta por un desayuno en el quinto mensaje y el bot le contesta
  "Holaa! Tenemos 4 opciones…", como si recién se conocieran.

  Se resuelve acá y no editando cada texto del equipo porque el mismo texto sirve
  para los dos casos: lo único que cambia es si ya hubo conversación.
*/
const SALUDO_INICIAL = /^\s*(hola+|buenas|buen d[ií]a|buenas tardes|buenas noches)\b[\s!¡,.:]*/i;

/*
  Lo que es puro trámite de cortesía y no pregunta nada.

  Existe para una guarda concreta: el mensaje rápido "saludo" es un hola
  enlatado, y se estaba mandando como respuesta a gente que había preguntado
  algo. Medido sobre tres días: salió doce veces y en seis la persona había
  escrito una pregunta de verdad —"tienen disponible tarta de frutilla",
  "le quedan fechas para muffins", "qué precio de el box de brownies"—. Una de
  ellas esperó una hora y volvió a escribir "??".
*/
/*
  Las más largas van PRIMERO. Con `buenas?` adelante, "buenas tardes" perdía el
  "buenas" y quedaba un "tardes" suelto que hacía pasar el mensaje por pregunta.
*/
const PURA_CORTESIA =
  /\b(buenas tardes|buenas noches|buen d[ií]as?|qu[eé] tal|c[oó]mo (est[aá]s|andas|anda|va|te va)|todo bien|hola+s*|holi+s*|buenas?|saludos|hi|hey|disculp[aá]|perd[oó]n|por favor)\b/giu;

/**
 * ¿Este mensaje es SOLO un saludo, sin nada que contestar?
 *
 * Se saca la cortesía y se mira si queda algo. "Holaa, cómo estás?" no deja
 * nada: es un hola. "Hola, qué precio tienen las cookies?" deja "qué precio
 * tienen las cookies", que es justo lo que hay que contestar.
 */
export function esSoloUnSaludo(texto: string): boolean {
  return (
    texto
      .replace(PURA_CORTESIA, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim().length === 0
  );
}

/**
 * Saca el saludo con el que arranca un texto, si tiene uno.
 *
 * Devuelve el texto igual si al sacarlo quedaría empezando en minúscula: eso
 * pasa cuando el saludo y la frase siguiente son una sola oración ("Hola! como
 * estas?"), y ahí cortar deja un mensaje peor que el original.
 */
export function sinSaludoInicial(text: string): string {
  const sinSaludo = text.replace(SALUDO_INICIAL, '').trimStart();
  if (!sinSaludo || sinSaludo === text.trimStart()) return text;
  const primera = sinSaludo[0];
  if (primera !== primera.toUpperCase()) return text;
  return sinSaludo;
}

/*
  Muletillas de entusiasmo con las que el modelo arranca las burbujas. Es la
  primera queja que hizo el local ("me suena a inteligencia artificial") y la
  prohibición está en el prompt, pero volvió a aparecer en producción: un
  "Buenísimo." antes de cada confirmación.

  Solo se corta cuando la muletilla es una oración entera —termina en punto o
  signo— y lo que sigue arranca en mayúscula. "Buenísimo. Retiralo con el
  nombre" pierde el "Buenísimo."; "Buenísimo, quedan dos kinder" se deja como
  está, porque cortarlo dejaría la frase empezando en minúscula.

  No está "dale", que sí es una palabra de la casa.
*/
const ARRANQUE_SOBREACTUADO =
  /^\s*(buen[íi]simo|genial|excelente|perfecto|qu[ée] (lindo|hermoso|bueno|mimo))\s*[!.…]+\s+/i;

/** Saca la muletilla de entusiasmo con la que arranca una burbuja, si la hay. */
export function sinArranqueSobreactuado(text: string): string {
  const cortado = text.replace(ARRANQUE_SOBREACTUADO, '');
  if (!cortado || cortado === text) return text;
  const primera = cortado[0];
  if (primera !== primera.toUpperCase()) return text;
  return cortado;
}

/*
  Anunciar la foto que ya salió.

  La foto viaja ANTES del texto, así que cuando la persona lee, la imagen ya
  está arriba: "ahí tenés la carta" le está contando algo que ya pasó. La
  prohibición está en el prompt Y en la descripción de `mandar_foto`, y aun así
  salió tres veces —la última, "Ahí tenés toda la carta!" con la carta arriba—.
  Tres es cuando deja de ser un descuido del modelo y pasa a ser trabajo nuestro.

  Mismo criterio que el arranque sobreactuado: se corta solo si el anuncio es
  una oración entera y lo que sigue arranca en mayúscula. Si el anuncio y la
  frase útil son una sola oración, cortar deja algo peor y no se toca.
*/
const ANUNCIO_DE_FOTO =
  new RegExp(
    '^\\s*(' +
      // "ahí la tenés", "acá tenés toda la carta", "ahí lo ves"
      '(ah[ií]|ac[áa])\\s+(la|lo|las|los|te)?\\s*(ten[ée]s|va|van|ves)\\b[^.!?]*' +
      '|' +
      // "ahí te mando las dos", "ahí te paso la carta"
      '(ah[ií]|ac[áa])\\s+te\\s+(mando|paso|dejo|comparto|adjunto)\\b[^.!?]*' +
      '|' +
      // "te paso la carta", "te mando la foto", "te adjunto el flyer"
      'te\\s+(paso|mando|dejo|comparto|adjunto)\\s+(la|el|las|los)\\s*' +
      '(carta|foto|imagen|flyer|lista|men[úu])\\b[^.!?]*' +
      '|' +
      // "mirá la imagen", "mirá, esta es la carta"
      'mir[áa][\\s,]+[^.!?]{0,40}(carta|foto|imagen|flyer)\\b[^.!?]*' +
    ')\\s*[!.…]+\\s+',
    'i',
  );

/** Saca el anuncio de una foto que ya salió, si la burbuja arranca con uno. */
export function sinAnuncioDeFoto(text: string): string {
  const cortado = text.replace(ANUNCIO_DE_FOTO, '');
  if (!cortado || cortado === text) return text;
  const primera = cortado[0];
  if (primera !== primera.toUpperCase()) return text;
  return cortado;
}

/*
  Acotaciones de guion.

  A una clienta le llegó, textual, "*(sin respuesta adicional, la conversación
  quedó cerrada con el agradecimiento)*". Es el modelo narrando que no tiene
  nada que decir, en vez de no decir nada.

  La causa se arregló en otro lado —ahora existe `no_contestar`, que es la forma
  legítima de callarse— y esto es la red por si igual se escapa: una burbuja que
  es ENTERA un aparte, y que además habla de la conversación o de la respuesta,
  no es un mensaje para nadie.

  Las dos condiciones juntas y no una sola: "(te lo dejo anotado)" también es una
  burbuja entera entre paréntesis, y esa sí hay que mandarla.
*/
const SOLO_APARTE = /^\s*\*{0,2}\s*[([]([\s\S]*)[)\]]\s*\*{0,2}\s*$|^\s*\*{1,2}([^*]+)\*{1,2}\s*$/;
const HABLA_DEL_TURNO =
  /\b(respuesta|responder|contestar|contesto|conversaci[óo]n|charla|mensaje|silencio|cerrad[ao]|nada que (decir|agregar)|sin (m[áa]s|nada))\b/i;

/*
  Y la misma acotación escrita como prosa, sin paréntesis que la delaten.

  De las tres que salieron en cuatro días, la de arriba atrapa dos. La tercera
  fue esta, y le llegó entera a una clienta:

    "No hay ningún mensaje nuevo del cliente al que responder — lo último fue
     del local ("Agendada! 😍"), así que no corresponde que yo intervenga ahora.
     Me quedo esperando a que la persona escriba."

  Lo que la delata no es la forma sino a QUIÉN le habla. El bot le escribe a la
  clienta y la trata de vos: "te lo anoto", "pasame". Un mensaje que se refiere a
  ella en tercera persona —"el cliente", "la persona"— no le está hablando a
  nadie: es el modelo pensando en voz alta.

  Las dos condiciones juntas, otra vez, y por lo mismo: "el nombre de la persona
  que lo recibe" también la nombra en tercera persona, y esa frase hay que
  mandarla. Lo que no puede estar es eso Y hablar del turno.
*/
const HABLA_DEL_CLIENTE_EN_TERCERA =
  /\b(?:el|la|l[oa]s)\s+(?:client[ae]s?|persona|usuari[oa]s?)\b|\bmensaje\s+(?:nuevo|del\s+client)/i;
const HABLA_DE_SI_MISMO =
  /\b(intervenir|intervenga|intervengo|me\s+quedo\s+esperando|no\s+corresponde|no\s+(?:hace\s+falta|hay\s+nada)\s+que\s+(?:responder|contestar|decir)|al\s+que\s+responder|espero\s+a\s+que\s+(?:escriba|responda))\b/i;

/** ¿Esta burbuja es una acotación del modelo y no un mensaje para el cliente? */
export function esAcotacion(text: string): boolean {
  const limpio = text.trim();

  // La forma más común: toda la burbuja es un aparte entre paréntesis.
  const m = SOLO_APARTE.exec(limpio);
  if (m) {
    const adentro = (m[1] ?? m[2] ?? '').trim();
    if (adentro && HABLA_DEL_TURNO.test(adentro)) return true;
  }

  // Y la de prosa suelta: habla del cliente en tercera persona Y de su propio turno.
  return HABLA_DEL_CLIENTE_EN_TERCERA.test(limpio) && HABLA_DE_SI_MISMO.test(limpio);
}

/** Normaliza las burbujas de un turno y descarta las que queden vacías. */
export function normalizeBubbles(bubbles: string[]): { bubbles: string[]; fixes: string[] } {
  const fixes: string[] = [];
  const out: string[] = [];
  for (const bubble of bubbles) {
    if (esAcotacion(bubble)) {
      fixes.push('acotación de guion');
      continue;
    }
    const sinAnuncio = sinAnuncioDeFoto(bubble);
    if (sinAnuncio !== bubble) fixes.push('anuncio de foto');
    const podado = sinArranqueSobreactuado(sinAnuncio);
    if (podado !== sinAnuncio) fixes.push('arranque sobreactuado');
    const result = normalizeWriting(podado);
    fixes.push(...result.fixes);
    // Una burbuja que era solo puntuación puede quedar vacía, y un texto vacío
    // hace fallar el envío en el canal.
    if (result.text) out.push(result.text);
  }
  return { bubbles: out, fixes: [...new Set(fixes)] };
}
