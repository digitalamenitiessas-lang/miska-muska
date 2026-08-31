/**
 * El sonidito de "acá te necesitan", para quien tiene el panel abierto.
 *
 * Existe aparte de las notificaciones del sistema por un motivo práctico: en el
 * local atienden con el panel abierto todo el día en la computadora del
 * mostrador, y una notificación del sistema operativo cuando la ventana ya está
 * a la vista es justo la que menos se ve. Lo que se nota ahí es el sonido.
 *
 * Se genera con WebAudio en vez de reproducir un archivo. No es una pirueta:
 * un mp3 es un asset que hay que servir, que puede tardar o fallar la primera
 * vez —y la primera vez es justo cuando hace falta—, y son dos notas. Así no
 * depende de la red ni de nada que se pueda romper en el medio.
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
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  contexto ??= new Ctor();
  return contexto;
}

/** Una nota corta, con entrada y salida suaves para que no chasquee. */
function nota(ctx: AudioContext, hz: number, empiezaEn: number, dura: number, volumen: number) {
  const osc = ctx.createOscillator();
  const gan = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = hz;
  osc.connect(gan);
  gan.connect(ctx.destination);

  const t = ctx.currentTime + empiezaEn;
  gan.gain.setValueAtTime(0, t);
  gan.gain.linearRampToValueAtTime(volumen, t + 0.012);
  gan.gain.exponentialRampToValueAtTime(0.0001, t + dura);
  osc.start(t);
  osc.stop(t + dura + 0.02);
}

/**
 * Dos notas cortas, ascendentes y a volumen bajo.
 *
 * Suena en un local con gente, así que tiene que escucharse; pero lo va a
 * escuchar la misma persona cincuenta veces por día, así que no puede ser una
 * alarma. Una quinta hacia arriba (La–Mi) se reconoce enseguida y no cansa.
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
    nota(ctx, 880, 0, 0.14, 0.16);
    nota(ctx, 1318.5, 0.13, 0.22, 0.13);
  } catch {
    // Un aviso que no suena no puede tumbar el panel.
  }
}
