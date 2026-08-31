/**
 * Los avisos al celular, del lado del navegador.
 *
 * Todo lo raro de esta función es culpa de iPhone, así que conviene tenerlo
 * junto y explicado en vez de desparramado por la vista:
 *
 *  - En iOS las notificaciones web SOLO funcionan si la página está agregada a
 *    la pantalla de inicio. Abierta en Safari, `Notification` puede ni existir,
 *    y si existe, pedir permiso no sirve de nada. Por eso antes de ofrecer el
 *    botón hay que saber si está instalada.
 *  - El permiso se pide UNA sola vez por dispositivo. Si dicen que no, el
 *    navegador se lo acuerda para siempre y no hay forma de volver a preguntar
 *    desde el código: hay que ir a la configuración del navegador. Por eso el
 *    botón no se ofrece de arranque ni al entrar: lo aprieta alguien que ya sabe
 *    para qué es.
 */

import { api } from './api';

export type EstadoAvisos =
  | 'no-soportado'
  | 'falta-instalar'
  | 'sin-claves'
  | 'apagados'
  | 'bloqueados'
  | 'encendidos';

/** true si la página se está viendo como app instalada y no en el navegador. */
export function instalada(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // Safari en iOS no soporta display-mode y usa esto, que no está en el tipo.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

const esIOS = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPad moderno se hace pasar por Mac; el touch lo delata.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function estadoDeAvisos(): Promise<EstadoAvisos> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    // En iOS esto es lo que devuelve Safari sin instalar: conviene decir por qué.
    return esIOS() && !instalada() ? 'falta-instalar' : 'no-soportado';
  }
  if (esIOS() && !instalada()) return 'falta-instalar';

  const { clave } = await api.claveDeAvisos().catch(() => ({ clave: '' }));
  if (!clave) return 'sin-claves';

  if (Notification.permission === 'denied') return 'bloqueados';

  const registro = await navigator.serviceWorker.getRegistration();
  const suscripcion = await registro?.pushManager.getSubscription();
  return suscripcion ? 'encendidos' : 'apagados';
}

/**
 * El navegador quiere la clave pública como bytes, no como texto.
 *
 * Viene en base64url —con `-` y `_` en vez de `+` y `/`, y sin relleno— que es
 * como la escupe la librería del servidor y como la espera el estándar. `atob`
 * no entiende esa variante, así que primero se traduce.
 */
function claveABytes(base64: string): ArrayBuffer {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const crudo = window.atob(normal);
  const bytes = new Uint8Array(crudo.length);
  for (let i = 0; i < crudo.length; i += 1) bytes[i] = crudo.charCodeAt(i);
  return bytes.buffer;
}

/** Un nombre para distinguir este dispositivo de los otros en la base. */
function etiquetaDelDispositivo(): string {
  const ua = navigator.userAgent;
  const sistema = /iphone|ipad/i.test(ua)
    ? 'iPhone'
    : /android/i.test(ua)
      ? 'Android'
      : /mac/i.test(ua)
        ? 'Mac'
        : /windows/i.test(ua)
          ? 'Windows'
          : 'otro';
  return `${sistema}${instalada() ? ' (app)' : ''}`;
}

export async function encenderAvisos(): Promise<EstadoAvisos> {
  const registro = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return permiso === 'denied' ? 'bloqueados' : 'apagados';

  const { clave } = await api.claveDeAvisos();
  if (!clave) return 'sin-claves';

  const suscripcion = await registro.pushManager.subscribe({
    // Obligatorio: el navegador no acepta suscripciones silenciosas.
    userVisibleOnly: true,
    applicationServerKey: claveABytes(clave),
  });

  const json = suscripcion.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  await api.suscribirAvisos({
    endpoint: json.endpoint ?? '',
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    etiqueta: etiquetaDelDispositivo(),
  });

  return 'encendidos';
}

export async function apagarAvisos(): Promise<EstadoAvisos> {
  const registro = await navigator.serviceWorker.getRegistration();
  const suscripcion = await registro?.pushManager.getSubscription();
  if (suscripcion) {
    await api.desuscribirAvisos(suscripcion.endpoint).catch(() => undefined);
    await suscripcion.unsubscribe();
  }
  return 'apagados';
}
