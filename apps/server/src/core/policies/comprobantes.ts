/**
 * Cuándo podemos dar por hecho que alguien mandó el comprobante.
 *
 * No es que lo leamos: el bot no ve las imágenes y el monto lo confirma una
 * persona. Lo único que se responde acá es una pregunta más chica y bastante
 * más útil: ¿llegó una foto DESPUÉS de que le pedimos la plata?
 *
 * Sirve en dos lugares distintos, y por eso vive aparte de los dos: el aviso de
 * la bandeja lo usa para no encender la marca con cualquier foto, y la
 * inscripción a un curso lo usa para no anotar a nadie que todavía no pagó.
 */

/** Lo mínimo que hace falta saber de un mensaje para decidir esto. */
export interface MensajeParaComprobante {
  direction: 'in' | 'out';
  text: string;
  contentKind: string;
}

/** Los adjuntos que pueden ser un comprobante. Un audio no lo es. */
const ES_ADJUNTO = (kind: string): boolean => kind === 'image' || kind === 'document';

/**
 * true si llegó una foto o un archivo después de que nosotros nombramos un
 * alias.
 *
 * `mensajes` va en orden cronológico y `alias` son los que cuentan como pedido
 * de plata: el de pedidos y el de cursos.
 *
 * El alias tiene que haberlo dicho ALGUIEN DE ESTE LADO —el bot o una persona
 * del local—, porque es lo que convierte una foto cualquiera en una respuesta.
 * Sin ese ancla, la foto de la torta que la clienta vio en Instagram contaría
 * como comprobante.
 */
export function llegoComprobante(
  mensajes: MensajeParaComprobante[],
  alias: Array<string | undefined | null>,
): boolean {
  const buscados = alias
    .map((a) => a?.trim().toLowerCase() ?? '')
    .filter((a) => a.length >= 4);
  if (!buscados.length) return false;

  const pedimosPlataEn = mensajes.findIndex(
    (m) => m.direction === 'out' && buscados.some((a) => m.text.toLowerCase().includes(a)),
  );
  if (pedimosPlataEn < 0) return false;

  return mensajes
    .slice(pedimosPlataEn + 1)
    .some((m) => m.direction === 'in' && ES_ADJUNTO(m.contentKind));
}

/*
  La otra cara del comprobante: decir que algo quedó reservado sin tenerlo.

  Pasó dos veces en la misma charla: "para el viernes te la reservamos sin
  problema" antes de hablar de plata, y después "listo Sofía, quedó anotada tu
  torta kinder…" seguido del alias. La persona lee las dos primeras palabras y
  no transfiere; el local guarda una torta que nadie busca.

  ESTO SOLO ANOTA EN EL LOG, no reescribe nada, y es a propósito. Un pedido
  cargado termina SIEMPRE con un mensaje de esta familia, así que una guarda que
  reemplazara la burbuja se llevaría puesto el total y el alias, que son
  correctos y hacen falta. Lo que corresponde no es tapar la frase sino escribir
  otra, y eso lo arregla la instrucción que devuelve `crear_pedido`.

  Queda midiendo para saber si esa instrucción alcanzó. Si en unos días esto
  sigue encendido, ahí sí hay con qué escribir la guarda que reescribe, y sobre
  todo con qué saber por qué texto cambiarla.
*/
const normalizar = (texto: string): string =>
  texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');

/** Afirmaciones de que algo ya está guardado para esa persona. */
const YA_RESERVADO = [
  /\b(quedo|queda|esta|ya esta) (anotad|reservad|tomad|guardad|apartad)[oa]/,
  /\b(te|se) (lo|la) (anote|anoto|reservo|reservamos|guardo|guardamos|aparto|apartamos)\b/,
  /\bte (lo|la) dejo (anotad|reservad|guardad)[oa]/,
  // "ya te reservamos", "ya lo anoté", "ya se lo guardamos": el pronombre varía.
  /\bya (te|se|lo|la|les)? ?(lo|la)? ?(anote|anotamos|reserve|reservamos|guarde|guardamos|aparte|apartamos)\b/,
];

/*
  Las mismas palabras dichas como condición son CORRECTAS y no se cuentan: "el
  lugar se reserva con la transferencia" es exactamente lo que hay que decir.
  Por eso se mira antes y después — la condición puede ir de los dos lados.
*/
const ES_CONDICION_ANTES =
  /\b(cuando|apenas|recien|una vez que|ni bien|para poder|para confirmar|para reservar|si )\b/;
const ES_CONDICION_DESPUES =
  /\b(con el pago|con la transferencia|con el comprobante|recien|una vez que|cuando)\b/;

const MIRAR = 45;

/** true si el texto afirma que algo ya quedó reservado, sin condicionarlo al pago. */
export function diceQueQuedoReservado(texto: string): boolean {
  const plano = normalizar(texto);
  for (const patron of YA_RESERVADO) {
    const m = patron.exec(plano);
    if (!m) continue;
    const antes = plano.slice(Math.max(0, m.index - MIRAR), m.index);
    if (ES_CONDICION_ANTES.test(antes)) continue;
    const despues = plano.slice(m.index + m[0].length, m.index + m[0].length + MIRAR);
    if (ES_CONDICION_DESPUES.test(despues)) continue;
    return true;
  }
  return false;
}
