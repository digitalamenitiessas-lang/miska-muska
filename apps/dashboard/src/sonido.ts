/**
 * El sonido de "acá te necesitan", para quien tiene el panel abierto.
 *
 * Existe aparte de las notificaciones del sistema por un motivo práctico: en el
 * local atienden con el panel abierto todo el día en la computadora del
 * mostrador, y una notificación del sistema operativo cuando la ventana ya está
 * a la vista es justo la que menos se ve. Lo que se nota ahí es el sonido.
 *
 * Se genera con WebAudio en vez de reproducir un archivo. No es una pirueta:
 * un mp3 es un asset que hay que servir, que puede tardar o fallar la primera
 * vez —y la primera vez es justo cuando hace falta—, y son unas notas. Así no
 * depende de la red ni de nada que se pueda romper en el medio.
 *
 * SUENA SOLO CUANDO UNA CHARLA PASA A NECESITAR ATENCIÓN. No con cada mensaje.
 * Eso es lo que permite que sea un aviso fuerte y no un tintineo: no va a sonar
 * cincuenta veces por día, va a sonar cuando alguien tiene que dejar lo que
 * está haciendo.
 */

const RECUERDO = 'miska.sonido';

/** El sonido arranca ENCENDIDO: es lo que pidieron, y se apaga con un clic. */
export function sonidoEncendido(): boolean {
  try {
    return window.localStorage.getItem(RECUERDO) !== 'no';
  } catch {
    // Modo privado, o el navegador con el almacenamiento bloqueado. Que no se
    // pueda recordar la preferencia no es motivo para quedarse mudo.
    return true;
  }
}

export function ponerSonido(encendido: boolean): void {
  try {
    window.localStorage.setItem(RECUERDO, encendido ? 'si' : 'no');
  } catch {
    // Ver arriba: si no se puede guardar, vale para esta sesión y listo.
  }
}

/*
  Un AudioContext por pestaña y no uno por sonido: crear uno cada vez deja
  contextos colgados que el navegador termina cortando, y a partir de ahí no
  suena más nada.
*/
let contexto: AudioContext | null = null;

function traerContexto(): AudioContext | null {
  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  contexto ??= new Ctor();
  return contexto;
}

/*
  POR QUÉ SUENA ASÍ.

  El local avisó que el sonido anterior —dos notas de seno, a 880 y 1318 Hz, con
  ganancia 0.16— se perdía entre el ruido del salón. Subirle el volumen solo no
  alcanzaba, y estas tres cosas importan más que el volumen:

  1. LA FRECUENCIA. El oído humano es más sensible entre 2 y 4 kHz, por la
     resonancia del propio conducto auditivo; es la razón por la que las alarmas
     de humo y los timbres de teléfono viven ahí. A 880 Hz hay que empujar mucho
     más aire para que se escuche lo mismo, y encima ahí es donde están las
     voces de la gente que habla en el salón.

  2. EL TIMBRE. Una onda de seno pone TODA su energía en una sola frecuencia: si
     el ruido del ambiente pisa esa frecuencia, el sonido desaparece entero. Una
     onda cuadrada reparte energía en muchos armónicos, así que para taparla hay
     que tapar todo el espectro a la vez, y eso no pasa.

  3. EL RITMO. Tres pulsos cortos se detectan mucho mejor entre ruido que un
     tono largo: el oído está hecho para notar lo que cambia, no lo que se
     sostiene. Un patrón repetido además se distingue de cualquier ruido del
     local, que no tiene ritmo.

  El compresor del final es para que las voces sumadas no recorten: sin él,
  subir la ganancia produce chasquidos en vez de volumen.
*/
const PULSOS = [0, 0.17, 0.34];
const GRAVE = 2637; // mi7
const AGUDA = 3520; // la7

/** Un pulso: dos voces, cuadrada y triangular, con ataque rápido y cola corta. */
function pulso(ctx: AudioContext, destino: AudioNode, hz: number, empiezaEn: number): void {
  const t = ctx.currentTime + empiezaEn;
  const dura = 0.13;

  const gan = ctx.createGain();
  gan.connect(destino);
  gan.gain.setValueAtTime(0, t);
  /*
    Ataque casi instantáneo: es lo que le da el "golpe" que se nota. Pero no
    cero, porque un salto seco chasquea.

    0.9 y no más: medido con un render fuera de línea, con este valor el pico
    queda en 0.755 —casi cinco veces el del sonido anterior— y no recorta. Con
    ganancia de compensación después del compresor se pasa de 1.0, y lo que se
    escucha ahí no es más volumen sino distorsión.
  */
  gan.gain.linearRampToValueAtTime(0.9, t + 0.006);
  gan.gain.exponentialRampToValueAtTime(0.0001, t + dura);

  for (const [tipo, ratio, nivel] of [
    ['square', 1, 0.6],
    ['triangle', 1.5, 0.4],
  ] as Array<[OscillatorType, number, number]>) {
    const osc = ctx.createOscillator();
    const mezcla = ctx.createGain();
    mezcla.gain.value = nivel;
    osc.type = tipo;
    osc.frequency.value = hz * ratio;
    osc.connect(mezcla);
    mezcla.connect(gan);
    osc.start(t);
    osc.stop(t + dura + 0.02);
  }
}

/**
 * El aviso: tres pulsos cortos y ascendentes, en la zona donde mejor oye el oído.
 *
 * Dura menos de medio segundo. Se escucha con ruido de fondo y no se parece a
 * nada más que suene en un local.
 */
export function sonarAviso(): void {
  if (!sonidoEncendido()) return;
  try {
    const ctx = traerContexto();
    if (!ctx) return;
    /*
      Los navegadores dejan el audio suspendido hasta que alguien toca algo de
      la página. Quien atiende hace clic todo el tiempo, así que para el segundo
      aviso ya está despierto; el primero puede perderse y no es grave.
    */
    if (ctx.state === 'suspended') void ctx.resume();

    /*
      Un compresor antes de la salida. Con tres pulsos de dos voces cada uno, los
      picos se suman y pasan de 1.0, y lo que se escucha ahí no es más volumen:
      es distorsión. Con esto la señal llega fuerte y limpia.
    */
    const techo = ctx.createDynamicsCompressor();
    techo.threshold.value = -8;
    techo.ratio.value = 12;
    techo.attack.value = 0.002;
    techo.release.value = 0.12;
    techo.connect(ctx.destination);

    PULSOS.forEach((cuando, i) => {
      pulso(ctx, techo, i === PULSOS.length - 1 ? AGUDA : GRAVE, cuando);
    });
  } catch {
    // Un aviso que no suena no puede tumbar el panel.
  }
}
