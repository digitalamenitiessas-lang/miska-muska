/*
  UN SOLO MENSAJE EN VEZ DE TRES.

  El bot parte las respuestas largas en dos o tres globitos porque se lee más
  natural, más parecido a cómo escribe una persona. Mientras WhatsApp fue
  gratis eso no costaba nada. Desde octubre, cada mensaje pasado del cupo de
  mil sale ARS 37,6798, así que cada globito de más es plata.

  Lo pidió el local. Y la consigna fue "mandar menos mensajes pero la misma
  información", así que acá NO se recorta nada: los globitos se pegan con un
  renglón en blanco en el medio y el texto llega entero. El corte que el modelo
  pensó como separación entre mensajes pasa a ser una separación entre
  párrafos, que en WhatsApp se lee prácticamente igual.

  MEDIDO sobre 21.035 mensajes del bot de 30 días: 1.990 son globitos pegados
  al anterior sin que la clienta haya escrito en el medio, o sea el 9,5%. Al
  mes son unos 1.990 mensajes menos, de los cuales se cobran unos 1.395 —el
  resto cae en charlas que entraron por un anuncio, que son gratis—. El ahorro
  da ARS 52.565 por mes.

  OJO CON EL NÚMERO: el informe de septiembre decía que los globitos de más
  eran el 17% y que juntarlos ahorraba ARS 177.779. Los dos números estaban
  mal. Son la mitad.

  POR QUÉ ESTO VA AL FINAL DEL PIPELINE Y NO EN `splitBubbles`, que era el
  lugar obvio: varias guardas trabajan POR GLOBITO. La de la dirección cambia
  el globito que iba a darla por uno que pide la plata; la de la descripción
  inventada reemplaza el globito que miente; la del stock hace lo mismo. Si los
  globitos se juntaran antes, cualquiera de esas reemplazaría la respuesta
  entera en vez de la parte que estaba mal. Se juntan recién cuando ya no queda
  ninguna guarda por correr.

  LAS FOTOS NO SE TOCAN. Son mensajes distintos de WhatsApp y no hay forma de
  meterlas adentro de un texto: lo que se junta son los textos que quedaron
  seguidos, y una foto en el medio corta la serie.
*/
import type { OutboundContent } from '../types/message.js';

/**
 * El techo de lo que se junta, en caracteres.
 *
 * WhatsApp corta en 4.096 y un turno del bot anda por los 400, así que esto no
 * es para el límite de WhatsApp: es para que un turno raro —una carta larga,
 * una explicación que se fue de largo— no termine en un ladrillo que nadie
 * lee. Pasado esto, se deja el corte donde estaba.
 */
const LARGO_MAXIMO = 1500;

/** Lo que separa dos globitos cuando se juntan: un renglón en blanco. */
const ENTRE_GLOBITOS = '\n\n';

/**
 * Junta los textos que salen seguidos en uno solo.
 *
 * Las fotos y cualquier otro contenido quedan donde estaban y cortan la serie,
 * así que "texto, foto, texto" sigue siendo tres mensajes y no dos.
 */
export function juntarLosGlobitos(contents: OutboundContent[]): OutboundContent[] {
  const salida: OutboundContent[] = [];

  for (const contenido of contents) {
    const ultimo = salida.at(-1);
    if (
      contenido.kind !== 'text' ||
      !ultimo ||
      ultimo.kind !== 'text' ||
      !contenido.text.trim()
    ) {
      if (contenido.kind !== 'text' || contenido.text.trim()) salida.push(contenido);
      continue;
    }

    const junto = `${ultimo.text.trim()}${ENTRE_GLOBITOS}${contenido.text.trim()}`;
    if (junto.length > LARGO_MAXIMO) {
      salida.push(contenido);
      continue;
    }
    salida[salida.length - 1] = { ...ultimo, text: junto };
  }

  return salida;
}
