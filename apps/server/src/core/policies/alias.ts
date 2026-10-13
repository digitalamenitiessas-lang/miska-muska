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

/*
  EL BOT PIDIENDO EL ALIAS EN VEZ DE DARLO.

  El 13 de octubre: "Se retira el sábado 17, sí! Pero el horario exacto te lo
  paso cuando llegue el comprobante ✨ Dale, entonces pasame el alias para que
  transfieras!". "Pasame el alias" lo dice la clienta, no nosotros.

  Y el daño no es sonar raro: el bot NUNCA le pasó el alias. Esa venta se cerró
  porque ella lo tenía de un mensaje anterior; sin eso se quedaba esperando a
  que le mandáramos algo que, en la cabeza del bot, tenía que mandar ella.

  Medido sobre 2.735 mensajes que nombran el alias en 30 días: 6 veces. Dos son
  del mismo día, las dos en charlas de box, y aparecen pegadas a "te confirmo
  el horario cuando llegue el comprobante" — la frase diferida parece arrastrar
  al bot al otro lado del mostrador.

  SE ARREGLA LA FRASE Y SE AGREGA EL ALIAS. Solo dar vuelta "pasame" por "te
  paso" deja un mensaje bien escrito que igual no trae el dato, y la clienta
  tiene que pedirlo otra vez. El alias va como bloque aparte al final y no
  dentro de la frase: metido en el medio rompe el castellano —"te paso el alias
  miskapedidos y la titular para que hagas la transferencia"— y un mensaje mal
  escrito es peor que uno con una vuelta de más.

  NO SE TOCA SI EL MENSAJE YA TRAE EL ALIAS. "Una vez que me lo pasas, te doy
  el alias" y "me pasás por transferencia al alias miskapedidos" están bien
  dichas, y las dos entraban como error hasta que se exigió que la palabra
  "alias" fuera el objeto directo de "pasame".
*/
const PIDE_EL_ALIAS =
  /\b(pasa(?:me|nos)|mand[áa]?(?:me|nos)|me pas[áa]s|nos pas[áa]s|envia(?:me|nos))\s+(el\s+)?alias\b/gi;

/** ¿El mensaje ya trae un alias escrito? Entonces lo está dando. */
const TRAE_UN_ALIAS = (texto: string, c: Cuentas): boolean =>
  [c.aliasPedidos, c.aliasCursos]
    .filter((a) => a?.trim())
    .some((a) => new RegExp(a.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(texto));

export function corregirElAliasAlReves(
  texto: string,
  cuentas: Cuentas,
  contexto = '',
): { texto: string; corregido: boolean } {
  PIDE_EL_ALIAS.lastIndex = 0;
  if (!PIDE_EL_ALIAS.test(texto)) return { texto, corregido: false };
  if (TRAE_UN_ALIAS(texto, cuentas)) return { texto, corregido: false };

  const deCursos = hablaDeCursos(texto) || hablaDeCursos(contexto);
  const alias = deCursos ? cuentas.aliasCursos : cuentas.aliasPedidos;
  const titular = deCursos ? cuentas.titularCursos : cuentas.titularPedidos;
  if (!alias?.trim()) return { texto, corregido: false };

  const derecho = texto.replace(PIDE_EL_ALIAS, (m) =>
    m[0] === m[0].toUpperCase() ? 'Te paso el alias' : 'te paso el alias',
  );

  const bloque = titular?.trim()
    ? `\n\nAlias: ${alias.trim()}\nA nombre de: ${titular.trim()}`
    : `\n\nAlias: ${alias.trim()}`;

  return { texto: `${derecho.trimEnd()}${bloque}`, corregido: true };
}
