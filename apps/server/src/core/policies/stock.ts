/**
 * NO SE OFRECE LO QUE HOY NO HAY.
 *
 * El domingo 6 el Box de Cookies Edición Limitada estuvo apagado todo el día.
 * El bot lo ofreció 32 veces como disponible y aclaró que no había otras 36.
 * Mitad y mitad, el mismo día, con el mismo dato delante. Una clienta pagó, no
 * había, hubo que devolverle la plata y llamó al local insultando.
 *
 * La causa de fondo era una contradicción entre la lista del día y la ficha
 * ("ofrecer SIEMPRE el Box de Cookies Edición Limitada"), y eso ya se arregló
 * en la ficha. Esto es la red: un prompt puede fallar, una guarda no.
 *
 * QUÉ MIRA: si el bot nombró un producto que hoy está apagado SIN decir que no
 * hay. Nombrarlo está perfecto —"esa hoy no nos queda, trae tal y tal"— y es lo
 * que el local quiere. Lo que no puede pasar es nombrarlo como si se pudiera
 * comprar.
 */

/** Sin tildes, sin puntuación y con los espacios planchados. */
function plano(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Las palabras que hacen que nombrar el producto esté BIEN.
 *
 * Alcanza con que aparezcan en la misma oración: "el box hoy no nos queda" y
 * "hoy no tenemos el box" son las dos formas, y el orden cambia según cómo lo
 * escriba el modelo.
 */
const DICE_QUE_NO_HAY =
  /\b(no (nos |los |las |lo |la |te |me )*(hay|queda|quedan|quedo|quedaron|tenemos|tengo)|no (esta|estan) disponible|(esta|estan|figura|figuran) (sin stock|agotad)|se (nos )?(agoto|agotaron|termino|terminaron)|agotad[oa]s?|sin stock|nos quedamos sin|ya no (hay|queda|tenemos)|todavia no (esta|hay)|vuelve a haber|apenas (vuelva|tengamos)|queda (afuera|fuera))\b/;
/*
  El agujero que tenía: "no LOS tenemos". El patrón pedía el "no" pegado al
  verbo, así que "la cookie pistacho y el chipá no los tenemos disponibles hoy"
  —que es exactamente lo que queremos que diga— contaba como oferta indebida.
  Trece mensajes correctos marcados de más en siete días, y uno de ellos habría
  sido un bloqueo con la guarda nueva.
*/

/**
 * Corta el texto en oraciones.
 *
 * El punto de "$5.000" no termina una oración, así que antes de partir se lo
 * cambia por un marcador que no puede aparecer en un mensaje de WhatsApp, y
 * después se lo repone. Sin esto, "sale $22.000" quedaba cortado en dos y la
 * mitad con el precio perdía de vista el nombre del producto.
 */
const MARCA_DECIMAL = '\u0000';

function oraciones(texto: string): string[] {
  return texto
    .replace(/(\d)\.(\d)/g, `$1${MARCA_DECIMAL}$2`)
    .split(/[.!?\n]+/)
    .map((o) => o.split(MARCA_DECIMAL).join('.'))
    .filter((o) => o.trim());
}

/**
 * Las formas en que se puede nombrar un producto.
 *
 * El nombre completo casi nunca aparece tal cual: el catálogo dice "Box de
 * cookies edición limitada" y el bot escribe "Box de Cookies Edición Limitada",
 * "Box Edición Limitada" o "el box de edición limitada". Se compara por las
 * palabras CON PESO —las de cuatro letras o más, sin las de relleno— y se pide
 * que estén todas.
 *
 * Con eso, "Torta kinder 10 porciones" y "Torta kinder 20 porciones" no se
 * confunden entre sí (los números son palabras distintas) pero "cookie kinder"
 * tampoco dispara con "torta kinder".
 */
const RELLENO = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'y', 'en', 'por', 'para', 'un', 'una']);

function clavesDe(nombre: string): string[] {
  return plano(nombre)
    .split(' ')
    .filter((p) => p.length >= 3 && !RELLENO.has(p));
}

export interface ProductoApagado {
  id: string;
  name: string;
}

export interface OfertaIndebida {
  id: string;
  name: string;
  oracion: string;
}

/**
 * Las señales de que el mensaje NO está solo nombrando el producto, sino
 * llevándolo a la caja: el alias, el pedido de la transferencia, el "te lo
 * anoto".
 *
 * Sin esto la guarda agarraba uno de cada cuatro mensajes del bot, y con razón:
 * hay 55 productos apagados y el bot habla de ellos todo el día —pasa el precio,
 * ofrece encargar una torta para el sábado—. Eso está BIEN y el prompt se lo
 * pide. Lo que no puede pasar es cobrar algo que no existe.
 *
 * `crear_pedido` ya rechaza lo agotado, así que el pedido nunca llega a la base.
 * El agujero es anterior: el bot pide la plata igual. Pasó tal cual —"Dale! El
 * Box de Cookies Edición Limitada te queda en $22.000. Para confirmarlo,
 * transferí a este alias"— y hubo que devolver el dinero.
 */
const VA_A_COBRAR =
  /\b(transferi|transferencia|alias|comprobante|senia|sena|te lo (anoto|reservo|encargo|guardo|separo)|quedo (anotado|reservado)|para confirmar|lo confirmamos)\b/;

/** true si el texto, además de nombrar, está cerrando la venta. */
export function vaACobrar(texto: string): boolean {
  return VA_A_COBRAR.test(plano(texto));
}

/**
 * Los productos apagados que este texto ofrece como si se pudieran comprar.
 *
 * Devuelve vacío cuando el bot los nombró aclarando que no hay, que es el uso
 * correcto y el más común. La guarda del pipeline además exige `vaACobrar`:
 * nombrar un agotado y pasar su precio está bien; cobrarlo, no.
 */
export function ofreceLoQueNoHay(
  texto: string,
  apagados: ProductoApagado[],
): OfertaIndebida[] {
  if (!texto.trim() || !apagados.length) return [];
  const encontrados: OfertaIndebida[] = [];
  const vistos = new Set<string>();

  for (const oracion of oraciones(texto)) {
    const p = plano(oracion);
    if (DICE_QUE_NO_HAY.test(p)) continue; // acá lo está aclarando: está bien
    for (const producto of apagados) {
      if (vistos.has(producto.id)) continue;
      const claves = clavesDe(producto.name);
      if (!claves.length) continue;
      if (claves.every((c) => p.includes(c))) {
        vistos.add(producto.id);
        encontrados.push({ id: producto.id, name: producto.name, oracion: oracion.trim() });
      }
    }
  }
  return encontrados;
}

/** Lo que se le dice al modelo cuando la guarda lo agarra. */
export function avisoDeStock(faltantes: OfertaIndebida[]): string {
  const nombres = faltantes.map((f) => f.name).join(', ');
  return (
    `OJO: ${nombres} HOY NO HAY, y lo estabas ofreciendo como si se pudiera comprar. ` +
    'Reescribí el mensaje: decí que hoy no queda, contá qué trae si te lo preguntaron, y ' +
    'ofrecé lo que sí está en la lista de hoy. No lo cargues en un pedido de hoy. ' +
    'Ya pasó que alguien pagó algo que no había y hubo que devolverle la plata.'
  );
}

/*
  NO SE COBRA LO QUE HOY NO HAY.

  El 12 de septiembre a las 18:13:

    bot    "Entonces queda: 2 x Cookie kinder / 1 x Brownie pistacho /
            1 x Alfajor block. Total: $19.800. Te paso el alias: miskapedidos"
    ella   transfirió y mandó la captura
    local  "tengo todo menos cookie kinder"
    local  "mil disculpas, estamos con mensajitos automáticos y te dijeron que
            sí a productos que no tenemos en el local"

  La Cookie kinder se había apagado a las 13:02 de ese mismo día, cinco horas
  antes. Hubo que devolver los $19.800.

  Y OJO CON DÓNDE ESTABA EL AGUJERO, porque no era donde parecía: `crear_pedido`
  hizo lo suyo. En esa charla NO quedó ningún pedido cargado —la validación
  rechazó la kinder por apagada— y el bot pasó el alias igual. La validación del
  pedido ya funcionaba; lo que faltaba era frenar el mensaje que pide la plata.

  POR QUÉ ESTA ES ANGOSTA Y EL TERMÓMETRO SIGUE SIENDO ANCHO. Medido sobre los
  5.609 mensajes del bot de siete días:

    ofreceLoQueNoHay tal cual .................. 1.320 = 188,6/día
    + está pidiendo la plata ...................... 84 =  12,0/día
    + solo mostrador, sin tortas ni desayunos ..... 37 =   5,3/día

  Los 189 no son un error: el bot habla de productos apagados todo el día con
  razón. Pasa la carta de cookies, pasa la lista de precios de tortas, dice "hoy
  no nos queda". Bloquear eso sería una de cada cuatro respuestas.

  LAS TORTAS Y LOS DESAYUNOS QUEDAN AFUERA, y no es un descuido. Se producen para
  una fecha, así que apagado quiere decir "no hay uno hecho", no "no se puede":
  el local fue explícito en que apagado no significa dejar de ofrecerlos. Y para
  el caso de HOY ya hay guarda dentro de `crear_pedido`. Meterlos acá subiría a
  12 por día y frenaría encargos que están bien.

  Con el mostrador es al revés: una cookie, un brownie, un alfajor no se producen
  por encargo. Apagado ahí quiere decir que no hay, y cobrarlo termina en
  devolución.
*/
const PIDE_LA_PLATA = /\b(alias|transferi|transferencia|comprobante|seña|senia|sena)\b/;

/** ¿Este mensaje está pidiendo plata? */
export function pideLaPlata(texto: string): boolean {
  return PIDE_LA_PLATA.test(plano(texto));
}

const NOMBRA_UN_DESAYUNO = /\b(desayuno|desayunos|box|boxes)\b/;

/**
 * Los productos apagados que este mensaje está COBRANDO.
 *
 * `apagadosDeMostrador` tiene que venir ya filtrado: solo lo que no se produce
 * por encargo. Ver el comentario de arriba, que explica por qué.
 */
export function cobraLoQueNoHay(
  texto: string,
  apagadosDeMostrador: ProductoApagado[],
): OfertaIndebida[] {
  if (!pideLaPlata(texto)) return [];
  const ofrecidos = ofreceLoQueNoHay(texto, apagadosDeMostrador);
  if (!ofrecidos.length) return [];
  /*
    La mini torta que va ADENTRO de un desayuno no se está vendiendo suelta, así
    que su stock no importa acá. Es el único falso positivo estructural que
    apareció en siete días.
  */
  if (NOMBRA_UN_DESAYUNO.test(plano(texto))) {
    return ofrecidos.filter((o) => !/mini\s*torta/i.test(o.name));
  }
  return ofrecidos;
}

/**
 * Lo que se manda en lugar del mensaje que cobraba.
 *
 * No dice qué falta —eso lo sabe el local, y decirlo mal es peor— y no cierra la
 * venta: deja la charla esperando un minuto mientras alguien mira.
 */
export const TEXTO_STOCK_A_CHEQUEAR =
  'Dame un minuto que confirmo que tengamos todo eso listo y te paso el alias 🙌🏼';
