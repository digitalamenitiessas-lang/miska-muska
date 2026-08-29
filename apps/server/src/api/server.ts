/**
 * Capa HTTP. Tres cosas y bien separadas:
 *  - /webhooks/*  entrada de los canales (sin auth propia: cada canal valida lo suyo)
 *  - /api/stream  SSE con los eventos del bus, para que el panel se vea en vivo
 *  - /api/*       API de gestión del panel (protegida por ADMIN_TOKEN si está)
 *
 * `core/` no importa nada de acá. Esta capa traduce HTTP ↔ dominio y nada más.
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { config, originAllowed } from '../config.js';
import { bus, log } from '../core/events/bus.js';
import type { Repositories } from '../core/store/repositories.js';
import type { Pipeline } from '../core/pipeline/index.js';
import type { ChannelRegistry } from '../channels/registry.js';
import { WhatsAppAdapter } from '../channels/whatsapp/adapter.js';
import { registerManagementRoutes } from './routes.js';

export interface ApiDeps {
  repos: Repositories;
  pipeline: Pipeline;
  channels: ChannelRegistry;
}

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export async function buildServer(deps: ApiDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });

  // La firma HMAC de WhatsApp se calcula sobre el cuerpo CRUDO. Si dejamos que
  // Fastify parsee y después re-serializamos, la firma nunca coincide.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req: FastifyRequest, body: string, done) => {
      req.rawBody = body;
      try {
        done(null, body.length ? JSON.parse(body) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  /*
    Las fotos que sube el panel llegan como cuerpo binario crudo, con el
    content-type del archivo. Sin multipart y sin dependencia nueva: el panel
    manda UN archivo por request, así que el sobre de multipart no aporta nada.
    El límite de 5 MB de arriba es también el máximo que acepta Meta por imagen.
  */
  app.addContentTypeParser(
    ['image/jpeg', 'image/png', 'image/webp'],
    { parseAs: 'buffer' },
    (_req: FastifyRequest, body: Buffer, done) => done(null, body),
  );

  // CORS a mano: una dependencia menos, y con el panel en Vercel el origen es
  // otro dominio, así que esto pasa a ser necesario y no decorativo.
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (originAllowed(origin)) {
      reply.header('access-control-allow-origin', origin!);
      reply.header('vary', 'Origin');
      reply.header('access-control-allow-headers', 'content-type, authorization, x-filename');
      reply.header('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      reply.header('access-control-max-age', '600');
    }
    if (req.method === 'OPTIONS') {
      reply.code(204).send();
    }
  });

  // Auth simple del panel. Se aplica solo a /api y solo si hay token definido.
  app.addHook('onRequest', async (req, reply) => {
    if (!config.adminToken) return;
    if (!req.url.startsWith('/api/')) return;
    // El EventSource del navegador no manda headers: se permite ?token=
    const query = req.query as Record<string, string | undefined>;
    const header = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const provided = header ?? query.token;
    if (provided !== config.adminToken) {
      reply.code(401).send({ error: 'No autorizado' });
    }
  });

  /*
    Las fotos se sirven FUERA de /api, y por lo tanto sin el token del panel.
    Tiene que ser así: quien las descarga no es el navegador del equipo sino
    Telegram y los servidores de Meta, que no tienen forma de autenticarse. Lo
    que se expone es una foto de producto con un id imposible de adivinar, no
    datos de nadie.
  */
  app.get('/media/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const file = await deps.repos.media.get(id);
    if (!file) return reply.code(404).send({ error: 'No existe' });
    /*
      Dos encabezados que importan desde que esto también sirve lo que MANDA el
      cliente y no solo lo que sube el equipo.

      `nosniff`: sin esto, un navegador puede decidir por su cuenta que un archivo
      es HTML aunque el content-type diga otra cosa, y ejecutarlo.

      `attachment` para todo lo que no sea una imagen conocida: un PDF o un audio
      se bajan, no se abren en una pestaña de nuestro dominio. El tipo se guarda ya
      filtrado contra una lista blanca, así que esto es la segunda vuelta de llave.
    */
    const esImagen = /^image\/(jpeg|png|webp|gif|heic|heif)$/.test(file.mimeType);
    /*
      El nombre se sanea antes de mandarlo: viaja en un encabezado y lo eligió
      quien mandó el archivo, así que una comilla o un salto de línea ahí adentro
      es una forma conocida de partir la respuesta en dos.
    */
    const nombre = (file.filename ?? '').replace(/[^\w. -]/g, '').slice(0, 80);
    const disposicion =
      (esImagen ? 'inline' : 'attachment') + (nombre ? `; filename="${nombre}"` : '');
    return reply
      .header('content-type', file.mimeType)
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', disposicion)
      // El contenido de un id nunca cambia: se puede cachear para siempre, y así
      // Meta no vuelve a descargarla en cada mensaje.
      .header('cache-control', 'public, max-age=31536000, immutable')
      .send(file.bytes);
  });

  app.get('/health', async () => ({
    ok: true,
    channels: await deps.channels.healthAll(),
    subscribers: bus.subscriberCount,
  }));

  // --- Webhooks -----------------------------------------------------------

  app.post('/webhooks/telegram', async (req: FastifyRequest, reply: FastifyReply) => {
    const adapter = deps.channels.get('telegram');
    if (!adapter) return reply.code(503).send({ error: 'Canal no disponible' });
    // Se responde 200 de inmediato: Telegram reintenta si tardamos.
    reply.code(200).send({ ok: true });
    const headers = req.headers as Record<string, string | undefined>;
    for (const message of adapter.parseWebhook(req.body, headers)) {
      deps.pipeline.handleInbound(message).catch((err) => log('error', 'Pipeline (telegram)', err));
    }
  });

  app.get('/webhooks/whatsapp', async (req: FastifyRequest, reply: FastifyReply) => {
    const adapter = deps.channels.get('whatsapp');
    const challenge = adapter?.verifyWebhook?.(req.query as Record<string, string | undefined>);
    if (challenge === null || challenge === undefined) {
      return reply.code(403).send('Token de verificación inválido');
    }
    return reply.code(200).type('text/plain').send(challenge);
  });

  app.post('/webhooks/whatsapp', async (req: FastifyRequest, reply: FastifyReply) => {
    const adapter = deps.channels.get('whatsapp');
    if (!(adapter instanceof WhatsAppAdapter)) {
      return reply.code(503).send({ error: 'Canal no disponible' });
    }
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    if (!adapter.verifySignature(req.rawBody ?? '', signature)) {
      log('warn', 'Webhook de WhatsApp con firma inválida: descartado.');
      return reply.code(401).send({ error: 'Firma inválida' });
    }
    reply.code(200).send({ ok: true });
    for (const message of adapter.parseWebhook(req.body)) {
      deps.pipeline.handleInbound(message).catch((err) => log('error', 'Pipeline (whatsapp)', err));
    }
  });

  // --- SSE ----------------------------------------------------------------

  app.get('/api/stream', (req: FastifyRequest, reply: FastifyReply) => {
    // `writeHead` escribe directo en el socket y se saltea el hook de CORS, así
    // que el encabezado se repite acá — pero validando el origen, no reflejando
    // cualquiera que llegue.
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // nginx y Caddy honran esto para no bufferear el stream.
      'x-accel-buffering': 'no',
      ...(originAllowed(req.headers.origin)
        ? { 'access-control-allow-origin': req.headers.origin!, vary: 'Origin' }
        : {}),
    });

    const write = (data: unknown) => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    write({ type: 'hello', at: new Date().toISOString() });
    for (const event of bus.recent().slice(-40)) write(event);

    const unsubscribe = bus.subscribe(write);
    // Ping para que proxies y navegadores no cierren la conexión por inactividad.
    const ping = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n');
    }, 25_000);

    const cleanup = () => {
      clearInterval(ping);
      unsubscribe();
    };
    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
  });

  // --- API de gestión -----------------------------------------------------

  await registerManagementRoutes(app, deps);

  return app;
}
