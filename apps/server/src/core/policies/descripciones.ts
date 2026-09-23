/*
  NO INVENTAR DE QUÉ ESTÁ HECHO ALGO.

  El caso, un miércoles a las 16:50. La clienta pidió una cookie Oreo, que ese
  día no había, y el bot contestó:

    "Pero tenemos la cookie nutella y oreo en el Box Edición Limitada (la del
     Volcán de Chocolate que es tipo brownie con oreo), o si preferís algo con
     oreo tenemos el Brownie Oreo a $4.700"

  Agus: "en el box edición limitada no hay cookie con Nutella Oreo, y la de
  volcán de chocolate que es tipo brownie con oreo, eso es mentira, digamos, no
  sé qué entreveró".

  DE DÓNDE SALIÓ, que es lo que importa: las tres piezas existen en la ficha,
  pero ninguna pertenece a la Volcán.
    - "tipo brownie" es de la Cookie Franui, la única de las cuatro del box que
      tiene descripción escrita.
    - "Brownie con Oreo" está en el Box Popurrí y en el Box Requete Feliz.
    - "cookie nutella y oreo" es un producto real, pero se vende suelto.

  El box lista cuatro sabores y solo uno dice qué es. Preguntado por algo que no
  había, el modelo fue a buscar lo más parecido, no encontró descripción de la
  Volcán, y rellenó el hueco con pedazos de las otras. La causa no es que el bot
  mienta: es que le dejamos tres nombres pelados.

  POR QUÉ ESTO ES UNA GUARDA Y NO SOLO UNA LÍNEA DE PROSA. Se midió antes de
  escribirla: en 30 días hay 1.129 mensajes que nombran el box, 673 listan bien
  los cuatro sabores, y este detector marca UNO — exactamente el de Agus. Cero
  falsos positivos.

  Y se midió también lo que NO había que hacer. Un primer detector, más ancho,
  marcaba cualquier oración que nombrara el box y otra cookie: 42 casos, y los
  42 eran correctos ("tenemos kinder y dubai sueltas, y también el Box Edición
  Limitada con sus 4 sabores"). Lo que separa una cosa de la otra es la
  preposición: "EN el box" atribuye, "y también el box" enumera. Por eso la
  ventana entre la cookie intrusa y el box es de veinte caracteres y no de
  cuarenta: con cuarenta entraba un falso positivo del 12/09.

  SÍ REEMPLAZA EL MENSAJE, y es una decisión del local. La primera versión solo
  marcaba la charla: el mensaje salía igual y una persona lo corregía después.
  Luciano lo cortó: "simplemente que si el bot no sabe se bloquee". Es cierto
  que el mensaje de Agus también decía cosas útiles —que no había cookie oreo,
  que el Brownie Oreo sale $4.700— y que taparlo se las lleva puestas. Pero una
  clienta que lee una descripción falsa compra otra cosa, y eso cuesta más que
  repetir un precio.

  Se puede reemplazar sin miedo justamente por la medición: una marca en 1.129
  mensajes. Si el detector fuera más ancho esto sería una pésima idea, y por eso
  la prueba mide la proporción y falla si sube del 1%.

  LO QUE ESTA GUARDA NO PUEDE HACER, dicho acá para que nadie lo busque después:
  no previene, corrige. Se intentó detectar antes —por el texto del bot y por la
  pregunta de la clienta— y ninguno de los dos caminos cierra. Describir las
  cuatro en una lista y describir mal una son casi la misma frase: un detector
  sobre la salida marcaba 64 de 788 mensajes, casi todos correctos, del tipo
  "…y Volcán de Chocolate, y viene con una bolsa de regalo", donde el "viene
  con" es del box. Y por el lado de la pregunta: en 30 días NADIE preguntó qué
  es la Volcán. El caso de Agus no arrancó con esa pregunta sino con "tenés
  cookie Oreo?", y el bot salió a improvisar un reemplazo.
*/

/** Sin tildes y con los espacios planchados, que es como se compara. */
function plano(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}

/** Las cookies que NO están en el box. Las cuatro que sí, quedan afuera. */
const INTRUSAS = 'nutella|oreo|kinder|dubai|ferrero|red velvet|chips|pistacho';

/** Cómo se nombra el box, con y sin las palabras del medio. */
const BOX = 'box (de cookies )?(de )?edicion limitada|box edicion limitada';

const ATRIBUYE: RegExp[] = [
  // "la cookie nutella y oreo EN el Box Edición Limitada"
  new RegExp(`(${INTRUSAS})[^.!?]{0,20}\\b(en|del|de) (el |la )?(${BOX})`),
  // "el Box Edición Limitada TRAE ... nutella"
  new RegExp(`(${BOX})[^.!?]{0,60}\\b(trae|viene con|incluye|tiene)\\b[^.!?]{0,60}(${INTRUSAS})`),
];

/**
 * ¿Le está metiendo al Box de Edición Limitada una cookie que no tiene?
 *
 * Se mira oración por oración: nombrar el box y otra cookie en el mismo mensaje
 * es lo normal y correcto. Lo que no lo es, es atribuírsela.
 */
export function atribuyeAlBoxLoQueNoTiene(texto: string): boolean {
  return texto
    .split(/(?<=[.!?\n])/)
    .some((oracion) => {
      const p = plano(oracion);
      return ATRIBUYE.some((re) => re.test(p));
    });
}

/**
 * Lo que sale en lugar del mensaje inventado.
 *
 * Corto y sin prometer nada que no sepamos. No repite los sabores —si el bot
 * los tuviera claros no habríamos llegado acá— y no nombra el box, para no
 * volver a meterse en la descripción que justamente no tiene.
 */
export const TEXTO_LO_CHEQUEO =
  'Uy, dejame que eso lo chequeo bien y te confirmo en un ratito 🙈';

/** Lo que lee quien abre la bandeja. */
export const MOTIVO_BOX_INVENTADO =
  '[descripción inventada] El bot le atribuyó al Box de Cookies Edición Limitada un sabor ' +
  'que no trae. Las cuatro son Franui, Banana Split, Crème Brûlée y Volcán de Chocolate. ' +
  'Corregilo vos antes de que compre algo que no es.';
