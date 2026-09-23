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

  NO REESCRIBE EL MENSAJE. El de Agus también decía cosas ciertas y útiles —que
  hoy no había cookie oreo, y que el Brownie Oreo sale $4.700—, así que taparlo
  se llevaría puesto lo bueno. Marca la charla y la pasa a una persona, que es
  quien puede desdecir una descripción inventada.
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

/** Lo que lee quien abre la bandeja. */
export const MOTIVO_BOX_INVENTADO =
  '[descripción inventada] El bot le atribuyó al Box de Cookies Edición Limitada un sabor ' +
  'que no trae. Las cuatro son Franui, Banana Split, Crème Brûlée y Volcán de Chocolate. ' +
  'Corregilo vos antes de que compre algo que no es.';
