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
