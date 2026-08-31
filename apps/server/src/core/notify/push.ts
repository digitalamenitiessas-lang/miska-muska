/**
 * AVISOS AL CELULAR.
 *
 * El panel ya marca las charlas que necesitan a una persona —un reclamo, un
 * comprobante que hay que mirar, el bot que se cayó— y esa marca ordena la
 * bandeja. El problema es que para verla hay que estar mirando la pantalla, y en
 * una pastelería un sábado nadie está mirando la pantalla.
 *
 * Esto manda ese mismo aviso al celular. No agrega ninguna regla nueva sobre
 * cuándo hace falta una persona: se cuelga de la marca que ya existe, así que si
 * mañana cambia el criterio de escalado, esto lo sigue solo.
 *
 * SE AVISA EN EL FLANCO DE SUBIDA, no cada vez que la charla cambia. Una charla
 * marcada que recibe tres mensajes más emite tres eventos de conversación, y sin
 * esto serían tres notificaciones por el mismo asunto. Se avisa cuando pasa de
 * "no necesita" a "necesita", y nada más.
 *
 * El estado anterior vive en memoria, igual que el resto del pipeline, y por la
 * misma razón: el bot corre en una sola instancia. Al arrancar se siembra con lo
 * que ya está marcado en la base, porque si no el primer evento de cada charla
 * pendiente se leería como recién marcada y sonarían todos los celulares juntos
 * después de cada despliegue.
 */

import webpush from 'web-push';
import { bus, log } from '../events/bus.js';
import { config } from '../../config.js';
import type { Repositories } from '../store/repositories.js';

/** Códigos con los que el servicio de push dice que esa suscripción murió. */
const MUERTA = new Set([404, 410]);

let repos: Repositories | null = null;
/** Charlas que YA estaban marcadas: sirve para detectar el flanco. */
const marcadas = new Set<string>();

export function pushConfigurado(): boolean {
  return Boolean(config.push.publicKey && config.push.privateKey);
}

/**
 * Arranca los avisos. Sin claves VAPID no hace nada y lo dice una vez: es una
 * instalación válida, solo que sin notificaciones.
 */
export async function iniciarAvisos(r: Repositories): Promise<void> {
  if (!pushConfigurado()) {
    log('info', 'Avisos al celular apagados: faltan las claves VAPID.');
    return;
  }

  repos = r;
  webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);

  // La foto del arranque, para no avisar por lo que ya estaba marcado.
  const pendientes = await r.conversations.list({ needsAttention: true, limit: 200 });
  for (const c of pendientes) marcadas.add(c.id);

  bus.subscribe((evento) => {
    if (evento.type !== 'conversation') return;
    const { id, needsAttention, attentionReason } = evento.conversation;

    if (!needsAttention) {
      marcadas.delete(id);
      return;
    }
    if (marcadas.has(id)) return;
    marcadas.add(id);

    void avisar(id, attentionReason);
  });

  const cuantos = (await r.push.list()).length;
  log('info', `Avisos al celular listos. ${cuantos} dispositivo(s) suscripto(s).`);
}

/**
 * Lo que se lee en la pantalla bloqueada.
 *
 * El motivo interno viene como "[consulta_modificacion] sacarle el jamón
 * (Desayuno Miska)": los corchetes son para el panel, no para un celular sobre
 * el mostrador. Se traduce a algo que se entienda de un vistazo y que no exponga
 * de más — la notificación la puede leer cualquiera que pase por al lado.
 */
function titular(motivo: string | null): { titulo: string; cuerpo: string } {
  const m = motivo ?? '';
  const detalle = m.replace(/^\[[^\]]*\]\s*/, '').trim();

  if (m.startsWith('[comprobante]')) {
    return { titulo: 'Llegó un comprobante', cuerpo: 'Miralo y confirmá el pago 💸' };
  }
  if (m.startsWith('[consulta_modificacion]')) {
    return { titulo: 'Una consulta para cocina', cuerpo: detalle.slice(0, 120) };
  }
  if (m.startsWith('[reclamo]')) {
    return { titulo: 'Un reclamo', cuerpo: 'Necesita que le conteste una persona' };
  }
  if (m.startsWith('[excepcion_pago]') || m.startsWith('[pedido_grande]')) {
    return { titulo: 'Algo para la encargada', cuerpo: detalle.slice(0, 120) };
  }
  if (m.startsWith('[pidio_humano]')) {
    return { titulo: 'Piden hablar con alguien', cuerpo: 'Están esperando en la bandeja' };
  }
  return { titulo: 'Necesitan una mano', cuerpo: detalle.slice(0, 120) || 'Mirá la bandeja' };
}

async function avisar(conversationId: string, motivo: string | null): Promise<void> {
  if (!repos) return;
  const { titulo, cuerpo } = titular(motivo);
  const carga = JSON.stringify({ titulo, cuerpo, conversacionId: conversationId });

  const destinos = await repos.push.list();
  if (!destinos.length) return;

  /*
    En paralelo y sin que uno arrastre a los otros: un celular que se rompió no
    tiene por qué demorar el aviso al resto. Son dos o tres dispositivos, así que
    no hace falta ninguna cola.
  */
  await Promise.all(
    destinos.map(async (d) => {
      try {
        await webpush.sendNotification(
          { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
          carga,
        );
        await repos!.push.marcarOk(d.endpoint);
      } catch (err) {
        const codigo = (err as { statusCode?: number }).statusCode;
        if (codigo && MUERTA.has(codigo)) {
          /*
            Desinstalaron la app, revocaron el permiso, o cambiaron de celular.
            La suscripción no vuelve a servir nunca: se borra en vez de dejarla
            fallando en cada aviso para siempre.
          */
          await repos!.push.borrar(d.endpoint);
          log('info', `Suscripción muerta borrada (${codigo}).`);
          return;
        }
        log('error', `No pude avisar a un dispositivo (${codigo ?? 'sin código'})`, err);
      }
    }),
  );
}
