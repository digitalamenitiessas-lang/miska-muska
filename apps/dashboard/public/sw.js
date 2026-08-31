/*
  Service worker del panel de Miska Muska.

  NO CACHEA NADA, y eso es una decisión y no una omisión. Existe por dos motivos:
  sin service worker no hay notificaciones push —ni en Android ni en iPhone—, y
  algunas versiones de Chrome piden que haya un manejador de 'fetch' para ofrecer
  el cartel de instalar.

  El manejador de 'fetch' está VACÍO a propósito y tiene que quedar así. Si no se
  llama a respondWith(), el navegador hace el pedido original tal cual. Cualquier
  respondWith() acá se mete en el medio del stream de eventos del panel y de las
  subidas de fotos — y peor: un panel que cachea es un panel que muestra pedidos
  de ayer sin que nadie se dé cuenta, que es exactamente lo que no puede pasar
  en la pantalla donde se atiende.
*/

self.addEventListener('install', () => {
  // No hay nada que precachear: no tiene sentido esperar en 'waiting'.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Por las dudas: si alguna versión anterior llegó a cachear algo, se borra.
      const nombres = await caches.keys();
      await Promise.all(nombres.map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

// Vacío a propósito. Ver el comentario de arriba antes de tocarlo.
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = { titulo: 'Miska Muska', cuerpo: event.data ? event.data.text() : '' };
  }

  const titulo = datos.titulo || 'Necesitan una mano';
  const opciones = {
    body: datos.cuerpo || 'Mirá la bandeja',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    /*
      Agrupar por conversación: si la misma charla vuelve a necesitar algo, se
      reemplaza el aviso viejo en vez de apilar dos por el mismo asunto. En
      iPhone esto no agrupa nada —lo ignora—, así que del lado del servidor se
      avisa una sola vez por charla igual.
    */
    tag: datos.conversacionId ? 'charla:' + datos.conversacionId : 'miska',
    data: { conversacionId: datos.conversacionId || null },
  };

  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    (async () => {
      const abiertas = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      /*
        Si el panel ya está abierto se lo trae al frente en vez de abrir otra
        pestaña. Sin esto, un sábado terminan con quince pestañas del panel.
      */
      for (const cliente of abiertas) {
        if (new URL(cliente.url).origin === self.location.origin) return cliente.focus();
      }
      return self.clients.openWindow('/');
    })(),
  );
});
