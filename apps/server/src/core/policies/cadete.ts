/*
  TERMÓMETRO: el bot ofreciendo nuestro cadete para algo que no es un desayuno.

  Había uno y no servía: miraba los PEDIDOS que se cargan con `cadete-miska`.
  El día que el local reclamó —"puede ser que sigue ofreciendo mandar con
  nuestro cadete?"— ese termómetro marcaba cero, y tenía razón: los nueve
  pedidos con cadete de ese día eran desayunos y boxes, todos correctos.

  El problema no estaba en lo que el bot CARGABA sino en lo que PROMETÍA. A una
  clienta que compraba muffins le dijo "tenemos dos opciones: nuestro cadete lo
  lleva al domicilio" y le coordinó una franja horaria; el pedido después salió
  con Uber, así que del lado de los datos no quedó rastro. Del lado de la
  clienta quedó una promesa que nadie iba a cumplir.

  Por eso este mira el texto que sale, que es donde vive el problema. Solo
  anota: distinguir por texto "estoy ofreciendo el cadete" de "estoy explicando
  que el desayuno lo llevamos nosotros" es una lectura con criterio, y las
  guardas duras son para lo que no puede pasar, no para lo que conviene evitar.
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

/** Ofrecer que salga de acá con alguien nuestro. */
const OFRECE_CADETE = [
  /\bnuestro cadete\b/,
  /\bcon (?:el |un )?cadete\b/,
  /\bcadete (?:disponible|lo lleva|te lo lleva)\b/,
  /\b(?:te |se )?lo llevamos nosotros\b/,
  /\blo lleva(?:mos)? (?:a|hasta) (?:tu |el |la )?(?:domicilio|casa)\b/,
];

/*
  Donde el cadete SÍ corresponde. Si el mensaje habla de un desayuno o un box, el
  cadete está bien nombrado y no hay nada que anotar.
*/
const ES_DESAYUNO = /\b(desayuno|desayunos|box|boxes|caja de regalo|para regalar)\b/;

/*
  Y donde la frase no es una oferta sino lo contrario: "estamos sin cadete", "no
  manejamos envío con nuestro cadete". Son las respuestas que pidió el local y
  nombran al cadete justamente para explicar que no está.
*/
const LO_ESTA_NEGANDO =
  /\b(sin cadete|no (?:manejamos|hacemos|tenemos)|no contamos con|no hay cadete|no disponemos)\b/;

/**
 * ¿Este mensaje ofrece nuestro cadete para algo que no es un desayuno?
 *
 * Devuelve la frase que lo disparó, o `null` si está bien.
 */
export function ofreceCadeteDeMas(texto: string): string | null {
  const t = plano(texto);
  if (ES_DESAYUNO.test(t)) return null;
  if (LO_ESTA_NEGANDO.test(t)) return null;
  const hit = OFRECE_CADETE.find((re) => re.test(t));
  if (!hit) return null;
  const m = t.match(hit);
  return m ? m[0] : null;
}
