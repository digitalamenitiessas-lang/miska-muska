/**
 * La guarda del envío gratis.
 *
 * Pasó de verdad, y costó una entrega: una clienta preguntó "el cadete lo tengo
 * que pagar yo?" y el bot le contestó "no, no hay un cobro aparte por el envío".
 * Nadie le dijo eso nunca. El envío SIEMPRE se cobra, y cuánto depende de la
 * zona, que es justamente un dato que el bot no tiene.
 *
 * Esto ya estaba prohibido en el prompt —"no le expliques tiempos, zonas ni
 * costos de envío: eso no lo tenés"— y el modelo lo dijo igual. Es la misma
 * lección que dejó la dirección antes de cobrar: un prompt puede fallar, una
 * guarda no. Lo que cuesta plata se valida en código.
 *
 * Está separado del pipeline para poder leerlo y cambiarlo sin abrir 900 líneas,
 * y porque la lista de formas de decir "gratis" va a crecer.
 */

/** Sin acentos y con los espacios planchados, que es como se compara. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/** Las palabras que nombran el envío. */
const ENVIO = /\b(envio|envios|cadete|cadetes|delivery|reparto)\b/g;

/**
 * Las formas de decir que no se cobra.
 *
 * "no hay cobro" y "no hay un cobro aparte" entran las dos, igual que "no se
 * cobra" y "no te cobramos nada". La negación tiene que estar adentro del
 * patrón: sin eso, "el envio se cobra aparte" —que es lo que HAY que decir—
 * daría positivo y la guarda pisaría la respuesta correcta.
 */
const SIN_CARGO = [
  /\bgratis\b/,
  /\bgratuito?s?\b/,
  /\bsin (cargo|costo|costos|recargo)\b/,
  /\bno (se |te |lo )*(cobra|cobran|cobramos)\b/,
  /\bno hay (un |ningun )?(cobro|costo|cargo|recargo|adicional)\b/,
  /\bni un peso\b/,
  /\bva incluido\b/,
  /\besta incluido\b/,
  /\bbonificado\b/,
];

/**
 * Cuántos caracteres pueden separar "envío" de "gratis" para que hablen de lo
 * mismo.
 *
 * Ochenta es una frase larga y un poco más: alcanza para "no hay un cobro
 * aparte por el envío" y para "el envío del cadete no te lo cobramos", y no
 * llega a unir dos oraciones que hablan de cosas distintas.
 */
const VENTANA = 80;

/**
 * true si el texto dice, de alguna forma, que el envío no se cobra.
 *
 * Mira las dos direcciones —"envío … gratis" y "gratis … envío"— porque el
 * modelo escribe de las dos maneras.
 */
export function prometeEnvioGratis(texto: string): boolean {
  const plano = normalizar(texto);
  ENVIO.lastIndex = 0;
  for (let m = ENVIO.exec(plano); m; m = ENVIO.exec(plano)) {
    const desde = Math.max(0, m.index - VENTANA);
    const hasta = Math.min(plano.length, m.index + m[0].length + VENTANA);
    const ventana = plano.slice(desde, hasta);
    if (SIN_CARGO.some((r) => r.test(ventana))) return true;
  }
  return false;
}

/**
 * Con qué se reemplaza la burbuja.
 *
 * Se cambia entera y no solo la frase, por lo mismo que la guarda de la
 * dirección: recortar la mentira de una oración deja un castellano roto. Y dice
 * lo que corresponde en ese punto de la charla, que es que el envío se cobra y
 * que el monto lo confirma una persona — porque el monto de verdad no lo tenemos.
 */
export const TEXTO_ENVIO_SE_COBRA =
  'El envío se cobra aparte, y cuánto sale depende de la zona 🙌🏼 Ya le paso tu ' +
  'dirección a alguien del local para que te confirme el costo.';

/*
  La segunda mentira sobre envíos, del mismo día que la primera: el bot le
  escribió a un cliente "ya estamos con el envío en camino para llegar en esa
  franja" por un pedido de $42.300 que tenía cobrado cero.

  Es distinto de prometer una hora. Acá no promete: AFIRMA que algo ya pasó. Y
  eso el bot no lo puede saber nunca —si el cadete salió lo sabe el local, no
  nosotros—, así que no depende de si está pago o no: no se dice y punto.
*/
const YA_SALIO = [
  /\bya (salio|salimos|sali)\b/,
  /\bya (lo|la|le|te lo|te la) (mandamos|enviamos|despachamos|llevan|llevamos)\b/,
  /\bya esta(mos)? (en camino|yendo|saliendo|en la calle)\b/,
  /\besta saliendo\b/,
  /\bel cadete (ya )?(salio|va|esta yendo)\b/,
  /\bsalio para\b/,
  /*
    "en camino" a secas, y hace falta: la frase real era "ya estamos CON EL
    ENVÍO en camino", con tres palabras metidas en el medio que rompían
    cualquier patrón más cerrado. Lo que la salva de dispararse de gusto es el
    filtro de futuro: "te aviso cuando esté en camino" no entra.
  */
  /\ben camino\b/,
];

/*
  Lo que sale del horno no es un reparto.

  "Ya salió del horno esta mañana" es una frase perfecta y la guarda la mataba.
  Se mira lo que viene JUSTO DESPUÉS del match, que es donde aparece.
*/
const NO_ES_EL_REPARTO = /^\s*(del horno|de la cocina|del molde|el pan|la torta del horno)/;

/** Cuánto se mira después de la frase para descartar que hablara de otra cosa. */
const DESPUES = 25;

/*
  Palabras que convierten la afirmación en una promesa a futuro. "Te aviso
  cuando esté en camino" no es una mentira, es lo que corresponde decir, y sin
  este filtro la guarda le pisaba la respuesta correcta.
*/
const ES_FUTURO = /\b(cuando|en cuanto|apenas|ni bien|una vez que|si|te aviso)\b/;

/** Cuánto antes de la frase se mira para ver si en realidad hablaba a futuro. */
const ANTES = 40;

/** true si el texto afirma que el pedido ya salió o va en camino. */
export function afirmaQueYaSalio(texto: string): boolean {
  const plano = normalizar(texto);
  for (const patron of YA_SALIO) {
    const m = patron.exec(plano);
    if (!m) continue;
    const preludio = plano.slice(Math.max(0, m.index - ANTES), m.index);
    if (ES_FUTURO.test(preludio)) continue;
    const cola = plano.slice(m.index + m[0].length, m.index + m[0].length + DESPUES);
    if (NO_ES_EL_REPARTO.test(cola)) continue;
    return true;
  }
  return false;
}

/**
 * Con qué se reemplaza.
 *
 * Dice lo único cierto que se puede decir en ese punto: que el pedido está
 * anotado y que el momento de la entrega lo confirma el local.
 */
export const TEXTO_NO_SE_SI_SALIO =
  'Quedó todo anotado 🙌🏼 En un rato te confirman desde el local cómo viene la entrega.';
