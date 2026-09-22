/*
  CUANDO EL BOT DICE QUE VA A PREGUNTAR, ALGUIEN TIENE QUE ENTERARSE.

  El caso que lo ordenó, un domingo a las 21:25:

    21:22  CLIENTA  "la torta franuí para cuántas porciones es?"
    21:25  CLIENTA  "la de 20 porciones, para el martes antes de las 12"
    21:25  bot      "Dale, perfecto. Dejame que lo chequeo en la agenda si
                     podemos armártela para el martes a las 12 y te respondo
                     a la brevedad 🙌🏼"
    21:26  CLIENTA  "Buenísimo gracias 🥰"

  Y nada más hasta el martes al mediodía, cuando la clienta escribió para
  preguntar a qué hora la pasaba a buscar. El pedido no existía. Era una torta
  de $50.000 para un asado del mediodía; se le ofreció para las 17.

  El local lo tenía visto: "ese comportamiento del bot, que no manda la consulta
  a atención o humano, tenés que insistirle hasta el último para que mande, y
  deja pasar pedidos".

  LO QUE NO ES EL PROBLEMA: el mensaje del bot. Decir "lo chequeo y te confirmo"
  cuando no sabés si hay lugar en la agenda es exactamente lo correcto, y es lo
  que queremos que haga en vez de inventar una respuesta. Por eso esto NO
  reescribe nada. El problema es que esa promesa no le llegaba a nadie.

  MEDIDO SOBRE 14 DÍAS, que es lo que decidió el umbral:
    - 616 promesas de consultar, unas 44 por día.
    - 484 (79%) no escalaron a una persona.
    - de esas, 120 (25%) nadie del local contestó nunca.
    - de las que sí contestaron, la mediana fue 14 minutos, pero 70 tardaron
      más de una hora.
    - de las 108 charlas que quedaron sin respuesta, 92 nunca terminaron en
      pedido.

  Con 30 minutos se avisa de unas 17 por día y se rescatan las 8,6 diarias que
  hoy se pierden calladas. A los 10 minutos serían 24 avisos diarios y se
  rescataría exactamente lo mismo: la diferencia es solo ruido sobre charlas que
  igual iban a contestar. El número lo eligió el local sabiendo eso.
*/

/** Sin tildes y con los espacios planchados, que es como se compara. */
function plano(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}

/*
  Las formas de prometer una consulta. Todas salieron de mensajes reales; con
  estas cinco se agarran las 616 del corpus.

  La cuarta y la quinta piden que se nombre CON QUIÉN se consulta, o que se
  prometa una respuesta en un plazo. Sin eso, "te confirmo" suelto aparece en
  frases que no prometen nada —"cuando mandes el comprobante te confirmo"— y el
  aviso se encendería de gusto.
*/
const PROMETE: RegExp[] = [
  // `ve[or]` y no `ver`: "dame un minuto que lo VEO con el local" es la forma
  // más común de las tres y se escapaba por una letra.
  /\b(dejame que|deja que|dame un|permitime)\b[^.!?]{0,40}\b(chequ|consult|pregunt|fij|ve[or])/,
  /\blo (chequeo|consulto|pregunto|averiguo)\b/,
  /\bte (confirmo|aviso|respondo|contesto)\b[^.!?]{0,30}\b(a la brevedad|en un rato|enseguida|ahora|ya mismo|en breve|en un ratito)\b/,
  /\b(consulto|chequeo|pregunto)\b[^.!?]{0,30}\bcon (la |el )?(cocina|encargada|local|equipo|chicas)\b/,
  /\b(lo )?chequeo (en la agenda|con el local|con cocina)\b/,
];

/**
 * ¿Este mensaje promete ir a preguntar algo y volver con la respuesta?
 *
 * Es la mitad de la pregunta. La otra mitad —si alguien contestó— no está en el
 * texto sino en la charla, y la responde el pipeline.
 */
export function prometeConsultar(texto: string): boolean {
  const t = plano(texto);
  return PROMETE.some((re) => re.test(t));
}

/*
  POR QUÉ EN EL ACTO Y NO DESPUÉS DE UN RATO.

  La primera versión esperaba treinta minutos, para que los que el local
  contesta rápido no encendieran nada: eran 19 avisos por día en vez de 45.

  El local corrigió el diagnóstico y tenía razón: "no es que los chicos no se
  dan cuenta, es que el bot nunca genera la primera alerta". Con eso, esperar
  media hora es media hora de la clienta esperando algo que nadie sabe que
  tiene que contestar.

  Y el costo de avisar al toque es chico, porque el aviso SE APAGA SOLO apenas
  alguien del local escribe en la charla —lo hace `sendAsOperator`—. De los 45
  diarios, los ~26 que se atienden en menos de un cuarto de hora aparecen y
  desaparecen sin que nadie haga nada; quedan encendidos los 8,8 que hoy se
  pierden callados, que son exactamente los que había que rescatar.
*/

/** El texto del aviso, que es lo único que ve quien abre la bandeja. */
export function motivoDeLaPromesa(texto: string): string {
  const frase = texto.replace(/\s+/g, ' ').trim().slice(0, 120);
  return (
    '[prometió consultar] El bot le dijo que iba a chequear algo y no puede contestarlo solo: ' +
    `"${frase}". Miralo y respondele vos.`
  );
}
