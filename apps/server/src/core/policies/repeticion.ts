/**
 * EL BOT NO DICE DOS VECES LO MISMO.
 *
 * El caso, textual y completo: una clienta mandó el comprobante, el bot lo
 * reconoció ("Recibido! Ya lo estamos chequeando"), y veinte minutos después
 * empezó a mandarle SEIS veces el mismo mensaje palabra por palabra —"te paso el
 * alias y apenas me mandes el comprobante te doy la dirección"— mientras ella
 * contestaba "ya te lo mandé", "ya te lo mandé", "es joda?" y volvía a mandar la
 * foto tres veces. Tuvo que entrar una persona a cortarlo.
 *
 * La causa de fondo era otra y se arregló aparte. Pero el bucle merece su propia
 * red, porque es una forma de fallar que no depende de la causa: si el contexto
 * no cambia, el modelo vuelve a escribir exactamente lo mismo, y cada repetición
 * le confirma a la persona que del otro lado no la están leyendo.
 *
 * DOS DECISIONES QUE LO HACEN SEGURO
 *
 * El largo mínimo. "Dale!", "🥰", "Perfecto" se repiten con toda razón en una
 * charla normal; lo que no se repite nunca palabra por palabra es un mensaje
 * largo. Por debajo de ese largo, esto no mira nada.
 *
 * La ventana de tiempo. Media hora después, repetir el alias puede ser correcto
 * —la persona volvió, la charla siguió—. Lo que no puede pasar es dos veces
 * seguidas en el mismo rato.
 */

/** Lo mismo dicho con otros espacios, otras tildes u otros emojis sigue siendo lo mismo. */
function comparable(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Por debajo de esto no se compara nada.
 *
 * Cuarenta caracteres son dos frases cortas. Un acuse ("dale, cualquier cosa
 * avisame") queda por debajo y puede repetirse tranquilo; el mensaje del alias,
 * la lista de datos o una explicación quedan por arriba.
 */
const LARGO_MINIMO = 40;

/** Cuánto hacia atrás se mira. Ver el porqué arriba. */
const VENTANA_MINUTOS = 15;

export interface MensajeParaRepeticion {
  direction: string;
  author: string;
  text: string;
  createdAt: string;
}

/**
 * ¿El bot ya dijo exactamente esto, hace poco?
 *
 * Solo mira lo que escribió el BOT. Que una persona del local haya mandado dos
 * veces el mismo mensaje rápido es decisión suya, y no es este el lugar para
 * corregirle la mano a nadie.
 */
export function yaLoDijo(
  texto: string,
  mensajes: MensajeParaRepeticion[],
  ahora = Date.now(),
): boolean {
  const nuevo = comparable(texto);
  if (nuevo.length < LARGO_MINIMO) return false;

  const desde = ahora - VENTANA_MINUTOS * 60 * 1000;
  return mensajes.some((m) => {
    if (m.direction !== 'out' || m.author !== 'bot') return false;
    const cuando = new Date(m.createdAt).getTime();
    if (!Number.isFinite(cuando) || cuando < desde) return false;
    return comparable(m.text) === nuevo;
  });
}
