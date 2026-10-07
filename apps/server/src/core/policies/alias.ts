/*
  LA PLATA VA A LA CUENTA QUE CORRESPONDE.

  Miska cobra en dos cuentas distintas: una para los pedidos de pastelería y
  otra para las inscripciones a cursos, que es de otra persona. El prompt trae
  las dos con la regla escrita —"una inscripción se cobra SIEMPRE en la de
  cursos, un pedido SIEMPRE en la de pedidos"— y aun así el 7 de octubre a las
  19:18, vendiendo un box del Día de la Madre:

    "Para el Box "te amo má" de $35.000 🫶🏼
     Transfieren al alias miskamuskacursos a nombre de Marcela Urrea Bianchini"

  En esa charla no se nombró un curso ni una vez. Dos minutos después la
  clienta mandó el comprobante: $35.000 a la cuenta equivocada.

  POR QUÉ ES GUARDA Y NO PROSA. El alias es una cadena fija y la pregunta
  "¿esto es un curso?" tiene una respuesta, no una interpretación. Es el mismo
  caso que la suma de los totales: hay UN resultado y se puede calcular acá sin
  preguntarle a nadie. Pedírselo al modelo ya se intentó —está en el prompt— y
  falló.

  SE CORRIGE, NO SE AVISA, y se corrige el alias Y EL TITULAR juntos. Dejar el
  alias bueno con el nombre de la otra persona es peor que el error original:
  la clienta ve que no coinciden, desconfía y pregunta.

  SOLO EN UNA DIRECCIÓN. Se arregla el alias de cursos usado donde no hay
  ningún curso. Al revés —el de pedidos en una inscripción— también sería un
  error, pero para cambiarlo haría falta estar seguro de que es una
  inscripción, y equivocarse ahí mandaría a la cuenta de otra persona una
  venta de pastelería. Mientras no haya un caso real medido, esa mitad no se
  toca: ante la duda, la plata va a la cuenta principal.
*/

/** Las dos cuentas, como vienen de los ajustes. */
export interface Cuentas {
  aliasPedidos: string;
  titularPedidos: string;
  aliasCursos: string;
  titularCursos: string;
}

/*
  Qué cuenta como "acá se habla de un curso". Va amplio a propósito: el costo
  de equivocarse hacia este lado es no corregir un alias —que es el
  comportamiento de hoy—, y hacia el otro es desviar una inscripción real.
*/
const HABLA_DE_CURSOS =
  /\b(curso|cursos|taller|talleres|clase|clases|inscrip|inscribir|cupo|cupos|alumn)/i;

/** ¿En este texto hay alguna señal de que se esté hablando de un curso? */
export function hablaDeCursos(texto: string): boolean {
  return HABLA_DE_CURSOS.test(texto);
}

export interface AliasCorregido {
  /** El alias que se mandaba. */
  mandaba: string;
  /** El que corresponde. */
  corresponde: string;
}

/**
 * Corrige el alias si el mensaje manda al de cursos sin que haya ningún curso.
 *
 * Devuelve el texto igual y `corregido: null` cuando no hay nada que tocar,
 * que es la enorme mayoría de los mensajes.
 */
export function corregirElAlias(
  texto: string,
  cuentas: Cuentas,
  contexto: string,
): { texto: string; corregido: AliasCorregido | null } {
  const cursos = cuentas.aliasCursos?.trim();
  const pedidos = cuentas.aliasPedidos?.trim();
  /*
    Sin las dos cuentas cargadas no hay nada que decidir. Y si son la misma
    —pasa cuando el de cursos quedó vacío y cae al de pedidos— tampoco.
  */
  if (!cursos || !pedidos || cursos.toLowerCase() === pedidos.toLowerCase()) {
    return { texto, corregido: null };
  }

  const loNombra = new RegExp(cursos.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  if (!loNombra.test(texto)) return { texto, corregido: null };

  // Si en algún lado se habla de un curso, el alias de cursos está bien puesto.
  if (hablaDeCursos(texto) || hablaDeCursos(contexto)) {
    return { texto, corregido: null };
  }

  let salida = texto.replace(new RegExp(loNombra.source, 'gi'), pedidos);

  /*
    El titular va en el mismo viaje. Si solo se cambiara el alias, el mensaje
    diría "miskapedidos a nombre de Marcela Urrea Bianchini", que es un dato
    falso y encima el que la clienta va a mirar cuando abra el homebanking.
  */
  const titularCursos = cuentas.titularCursos?.trim();
  if (titularCursos && cuentas.titularPedidos?.trim()) {
    salida = salida.replace(
      new RegExp(titularCursos.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      cuentas.titularPedidos.trim(),
    );
  }

  return { texto: salida, corregido: { mandaba: cursos, corresponde: pedidos } };
}
