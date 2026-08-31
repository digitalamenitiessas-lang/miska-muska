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

/** Normaliza las burbujas de un turno y descarta las que queden vacías. */
export function normalizeBubbles(bubbles: string[]): { bubbles: string[]; fixes: string[] } {
  const fixes: string[] = [];
  const out: string[] = [];
  for (const bubble of bubbles) {
    const podado = sinArranqueSobreactuado(bubble);
    if (podado !== bubble) fixes.push('arranque sobreactuado');
    const result = normalizeWriting(podado);
    fixes.push(...result.fixes);
    // Una burbuja que era solo puntuación puede quedar vacía, y un texto vacío
    // hace fallar el envío en el canal.
    if (result.text) out.push(result.text);
  }
  return { bubbles: out, fixes: [...new Set(fixes)] };
}
