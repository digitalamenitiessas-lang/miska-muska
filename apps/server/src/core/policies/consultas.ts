/*
  NO SE DICE "SIGO ESPERANDO" SI NO HAY NADA ESPERANDO.

  Pasó un viernes a las nueve de la noche. La clienta quería una torta para ese
  momento, el bot escaló a cocina, y una empleada entró y contestó:

    21:10  PERSONA  "Perdón!! No llegamos porqe en 20 cerramos 🥺"
    21:19  bot      "Estoy en contacto con cocina, dame un momentito más 🙈"
    21:19  bot      "Todavía estoy chequeando! Dame un minuto más que ya tengo respuesta"
    21:19  PERSONA  "Perdón son las respuestas automáticas. No llegamos amor 🥺"

  La empleada tuvo que salir a pedir disculpas por el bot delante de la clienta.

  El mensaje de una persona CIERRA la consulta —eso ya funciona, lo hace
  `sendAsOperator`—, así que a las 21:19 no había ninguna consulta abierta. El
  bot no estaba esperando nada: lo decía porque en el historial venía diciéndolo.

  Y ahí está lo que la hace una guarda y no una línea de prosa: "¿hay una
  consulta abierta?" no es una opinión, es una fila en la base. Si no la hay, el
  mensaje es falso, y punto. Ya existe la regla escrita —"cuando una persona del
  local dice algo, no se lo discute"— y no alcanzó.

  Medido sobre diez días: el bot dijo que seguía esperando después de que una
  persona ya había hablado unas 4 veces por día.
*/

/** Sin tildes y con los espacios planchados, que es como se compara. */
function plano(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/*
  Las formas de decir "seguí esperando". Todas salieron de mensajes reales.

  Quedan afuera los "dejame que lo chequeo" en presente, que son el ARRANQUE de
  una consulta y están bien: el problema no es empezar a consultar, es seguir
  diciendo que se consulta cuando ya contestaron.
*/
const SIGUE_ESPERANDO = [
  /\b(sigo|todavia|aun)\b[^.!?]{0,45}\b(esperando|chequeando|consultando|viendo|sin respuesta)\b/,
  /\bestoy (esperando|en contacto con)\b/,
  /\bestoy (chequeando|consultando|viendo)\b[^.!?]{0,30}\b(todavia|aun|con cocina|con el local)\b/,
  /\bdame (un|unos) (momentito|minutito|segundito|segundos|minutos) mas\b/,
  /\bya (casi )?tengo (la )?respuesta\b/,
];

/**
 * ¿Este mensaje dice que sigue esperando una respuesta?
 *
 * Solo tiene sentido preguntárselo junto con si hay una consulta abierta de
 * verdad: la frase por sí sola es correcta mientras la consulta exista.
 */
export function diceQueSigueEsperando(texto: string): boolean {
  const t = plano(texto);
  return SIGUE_ESPERANDO.some((re) => re.test(t));
}

/**
 * Lo que se manda en su lugar.
 *
 * No repite la espera —que es lo que estaba mal— y tampoco inventa una
 * respuesta que el bot no tiene. Escala, así que mientras lo dice es verdad.
 */
export const RESPUESTA_SIN_CONSULTA =
  'Perdón, dejame que lo confirme bien con el local y te aviso 🙏🏻';
