/**
 * Dónde está colgado el panel.
 *
 * Hasta el 19 de octubre de 2026 el panel vivía en la raíz de un dominio de
 * Vercel, así que `/logo.png` y `/sw.js` funcionaban. Ese día se cayó el plan y
 * pasó a la VPS, servido bajo `/miska-panel/` al lado del bot. Todo lo que
 * estaba escrito con la barra adelante apuntó de golpe a la raíz del dominio,
 * que es otro servicio: el logo dejaba de cargar y —lo caro— el service worker
 * no se registraba, o sea que se caían las notificaciones al celular.
 *
 * Vite reescribe las rutas del `index.html` cuando se buildea con `--base`,
 * pero NO las que están escritas adentro del JavaScript ni las del manifest:
 * esas son strings y nadie las toca. Para esas está esto.
 *
 * `BASE_URL` lo pone Vite y ya viene con la barra final: "/" en desarrollo,
 * "/miska-panel/" en la VPS.
 */
export function desdeLaBase(archivo: string): string {
  return `${import.meta.env.BASE_URL}${archivo.replace(/^\//, '')}`;
}
