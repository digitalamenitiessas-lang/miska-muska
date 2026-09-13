/*
  NUESTRO CADETE ES SOLO PARA DESAYUNOS Y BOXES DE REGALO.

  Lo pidió el local así: "desde el vamos sacale la opción de que tenemos cadete;
  para todos los que son del momento, que manden Uber a retirar; cadete solo
  ofrezcamos para desayunos". El motivo es de cocina: durante el día conseguir
  un cadete los demora muchísimo, y cada cadete que se va con unas cookies es un
  desayuno que no sale.

  ESTO EMPEZÓ SIENDO UN TERMÓMETRO Y NO ALCANZÓ. La primera versión solo anotaba,
  y el sábado de lluvia —con un solo cadete en el centro— marcó CERO mientras el
  bot escribía estos dos:

    16:56  "Ahora el local ve si consigue cadete, sino te recomendamos pedir
            Uber Auto que llega rápido"
    18:06  "Tenés razón, nosotros lo llevamos 🙌🏼 ya sale para tu zona, avisanos
            cuando estés cerca para que el cadete sepa dónde ir"

  El segundo es el peor: promete el cadete Y dice que ya salió. Y el detector no
  vio ninguno por una razón tonta: buscaba "lo llevamos nosotros" y el bot
  escribió "nosotros lo llevamos". Orden invertido, cero detecciones.

  Ahora bloquea, porque el dueño del proyecto lo dejó dicho: "es mejor que se
  bloquee y responda un humano, a que no respete las reglas que le dimos".

  CUÁNTAS VECES. Medido sobre los mensajes reales: con el prompt de hoy son 2,5
  bloqueos por día. Con el de la semana pasada —antes de que las reglas del
  cadete entraran— eran 24 a 34. O sea que las reglas escritas SÍ funcionaron y
  esto queda como red, no como el arreglo principal. Vale tenerlo presente: si
  algún día alguien toca esas reglas, este número se dispara y el equipo se come
  treinta escaladas diarias.
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
  Ofrecer que salga de acá con alguien nuestro.

  Las formas con "llevamos" están en los dos órdenes a propósito —"nosotros lo
  llevamos" y "lo llevamos nosotros"—, que es exactamente lo que se escapó.
*/
const OFRECE_EL_CADETE = [
  /\bnuestro cadete\b/,
  /\bcadete propio\b/,
  /\bcon (?:el |un |nuestro )?cadete\b/,
  /\b(?:tenemos|hay|conseguimos|consigue|consiguen|consiga) (?:un |el |algun )?cadete\b/,
  /\bel cadete (?:sale|va|sepa|lleva|llega|pasa|esta|tiene|puede|recibe|ya)\b/,
  /\bcadete (?:disponible|sale|lo lleva|te lo lleva|te la lleva)\b/,
  /\b(?:salga|sale|mandamos|mande|manda) el cadete\b/,
  /\b(?:envio|costo|precio) del cadete\b/,
  /\blos cadetes\b/,
  // Los dos órdenes. El que faltaba es el primero.
  /\bnosotros (?:te |se )?l[oa]s? (?:llevamos|mandamos|enviamos|acercamos|alcanzamos)\b/,
  /\b(?:te |se )?l[oa]s? (?:llevamos|mandamos|enviamos|acercamos|alcanzamos) nosotros\b/,
  /\bl[oa]s? (?:llevamos|llevemos|mandamos|mandemos|enviamos|enviemos)\b[^.!?]{0,25}\b(?:a |hasta )?(?:tu |el |la )?(?:domicilio|casa|zona)\b/,
  /\bllevamos (?:a |al )?domicilio\b/,
];

/*
  Donde el cadete SÍ corresponde: si el mensaje habla de un desayuno o un box, el
  cadete está bien nombrado.
*/
const ES_DESAYUNO_O_BOX =
  /\b(desayuno|desayunos|box|boxes|caja de regalo|para regalar|regalo sorpresa)\b/;

/*
  Y donde la frase NO es una oferta sino lo contrario. Cada una salió de un
  mensaje real que estaba bien dicho: el bot negando el cadete, recomendando el
  Uber por sobre el cadete, o hablando del cadete DEL CLIENTE, que no es el
  nuestro y se puede aceptar sin problema.
*/
const NO_ES_UNA_OFERTA = [
  /\bsin cadete\b/,
  /\bno hay cadete\b/,
  /\bno tenemos cadete/,
  /\bno tenemos nadie\b/,
  /\bno contamos con\b/,
  /\bno disponemos\b/,
  /\bno (?:manejamos|hacemos|tenemos) envio\b/,
  /\bno hacemos envio\b/,
  /\bno enviamos\b/,
  /\bno l[oa]s? (?:enviamos|mandamos|llevamos)\b/,
  /\bsolo para desayunos\b/,
  /\bcadete lo usamos solo\b/,
  // "más rápido y más económico QUE con nuestro cadete": está recomendando el Uber.
  /\bmas (?:economico|barato|rapido)\b[^.!?]{0,25}\bque (?:con )?(?:nuestro |el )?cadete\b/,
  // "avisanos cuando mandes tu cadete": ese cadete es del cliente, no el nuestro.
  /\b(?:mandes|mandas|mande|envies|tu|su) (?:el |un )?cadete\b/,
];

/** Cuántos mensajes atrás se mira para saber si la charla es de un desayuno. */
const VENTANA_DE_CONTEXTO = 6;

/**
 * ¿Este mensaje ofrece nuestro cadete para algo que no es un desayuno?
 *
 * Devuelve la frase que lo disparó, o `null` si está bien.
 *
 * `contexto` son los últimos mensajes de la charla: el mensaje que promete el
 * cadete muchas veces no vuelve a nombrar el producto —"dale, nosotros te lo
 * llevamos"— y sin mirar atrás no se sabe si era un desayuno.
 */
export function ofreceCadeteDeMas(texto: string, contexto = ''): string | null {
  const t = plano(texto);
  const ctx = plano(contexto);
  if (ES_DESAYUNO_O_BOX.test(t) || ES_DESAYUNO_O_BOX.test(ctx)) return null;
  if (NO_ES_UNA_OFERTA.some((re) => re.test(t))) return null;
  const hit = OFRECE_EL_CADETE.find((re) => re.test(t));
  if (!hit) return null;
  const m = t.match(hit);
  return m ? m[0] : null;
}

/** Los últimos mensajes de una charla, para pasar como contexto. */
export function contextoDeCadete(historial: Array<{ text?: string | null }>): string {
  return historial
    .slice(-VENTANA_DE_CONTEXTO)
    .map((m) => m.text ?? '')
    .join(' ');
}

/**
 * Lo que se manda en lugar del mensaje bloqueado.
 *
 * Es la frase que pidió el local, textual. Y ojo con la tentación de suavizarla
 * a "coordinamos el envío": eso suena a que lo llevamos nosotros, que es
 * exactamente lo que no hay. Agus fue explícita: "si no le decimos lo del Uber
 * y decimos coordinamos el envío, doy a entender que podemos llegar a mandarle
 * un cadete".
 */
export const RESPUESTA_SIN_CADETE =
  'Por el momento estamos sin cadete disponible por la alta demanda 🙈 lo que sí podés ' +
  'hacer es mandar un Uber Moto a retirarlo, que llega rápido.';
