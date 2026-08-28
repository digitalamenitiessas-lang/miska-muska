/**
 * API de gestión que consume el panel. Traduce HTTP a llamadas de dominio.
 * Sin lógica de negocio propia: si algo hay que decidir, se decide en `core/`.
 */

import type { FastifyInstance } from 'fastify';
import type { ApiDeps } from './server.js';
import { bus } from '../core/events/bus.js';
import { config } from '../config.js';
import { matchQuickReplies } from '../core/pipeline/router.js';
import { renderQuickReply } from '../core/agent/persona.js';
import type { ConversationMode, OrderStatus, Product, ProductCategory } from '../core/types/domain.js';
import type { ChannelId } from '../core/types/message.js';

export async function registerManagementRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const { repos, pipeline, channels } = deps;

  // --- Conversaciones -----------------------------------------------------

  app.get('/api/conversations', async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const list = await repos.conversations.list({
      mode: query.mode as ConversationMode | undefined,
      channel: query.channel as ChannelId | undefined,
      needsAttention: query.needsAttention === '1',
      limit: query.limit ? Number(query.limit) : 100,
    });
    // Se adjunta el contacto para que el panel no tenga que pedirlo uno por uno.
    return Promise.all(
      list.map(async (conversation) => ({
        ...conversation,
        contact: await repos.contacts.get(conversation.contactId),
      })),
    );
  });

  app.get('/api/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const conversation = await repos.conversations.get(id);
    if (!conversation) return reply.code(404).send({ error: 'No existe' });
    const [contact, messages, orders, quickReplies] = await Promise.all([
      repos.contacts.get(conversation.contactId),
      repos.messages.history(id, 200),
      repos.orders.list({ conversationId: id, limit: 20 }),
      repos.quickReplies.list(),
    ]);
    const lastInbound = [...messages].reverse().find((m) => m.direction === 'in');
    return {
      conversation,
      contact,
      messages,
      orders,
      /** Sugerencias de mensaje rápido para el último mensaje del cliente. */
      suggestions: lastInbound ? matchQuickReplies(lastInbound.text, quickReplies).slice(0, 4) : [],
    };
  });

  app.post('/api/conversations/:id/read', async (req) => {
    const { id } = req.params as { id: string };
    await repos.conversations.markRead(id);
    const conversation = await repos.conversations.get(id);
    if (conversation) bus.emit({ type: 'conversation', conversation });
    return { ok: true };
  });

  /** Tomar / devolver la conversación (handoff humano). */
  app.post('/api/conversations/:id/mode', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { mode } = req.body as { mode: ConversationMode };
    if (!['bot', 'human', 'muted'].includes(mode)) {
      return reply.code(400).send({ error: 'Modo inválido' });
    }
    await repos.conversations.setMode(id, mode);
    pipeline.marcarCambioDeModo(id, mode);
    /*
      Al devolverla al bot se limpia la alerta, porque ya fue atendida. Pero si
      quedó una modificación sin contestar, la alerta se MANTIENE: el bot ya está
      frenado por la guarda de `crear_pedido`, y la alerta es lo único que le
      recuerda al equipo que hay alguien esperando una respuesta. Sin esto, el
      movimiento natural ("ahí te confirmo" + devolver al bot) deja la conversación
      sin ningún rastro, que es el caso real del sanguchito.

      Los reclamos siguen igual: no tienen consulta abierta, así que la alerta se
      limpia como hasta ahora.
    */
    const actual = await repos.conversations.get(id);
    const consultaAbierta = Boolean(actual?.pendingReview && !actual.pendingReview.resueltoEn);
    if (mode === 'bot' && !consultaAbierta) {
      await repos.conversations.setAttention(id, false, null);
    }
    const conversation = await repos.conversations.get(id);
    if (conversation) bus.emit({ type: 'conversation', conversation });
    return { ok: true, conversation };
  });

  /** Respuesta del equipo a una consulta de modificación. */
  app.post('/api/conversations/:id/review', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { respuesta, devolverAlBot } = req.body as {
      respuesta?: string;
      devolverAlBot?: boolean;
    };
    /*
      Se exige texto: el bot repite lo que dijo el equipo. Un sí o un no pelados lo
      obligarían a inventar el motivo del rechazo, que es justamente lo que no
      queremos. El panel ofrece dos textos precargados, así que sigue siendo un clic.
    */
    const texto = (respuesta ?? '').trim();
    if (!texto) return reply.code(400).send({ error: 'Falta la respuesta para el bot' });
    const resolved = await repos.conversations.answerReview(id, texto);
    // null = no había consulta abierta, o la contestó otro un segundo antes.
    if (!resolved) return reply.code(409).send({ error: 'Acá no hay ninguna consulta abierta' });
    if (devolverAlBot !== false) {
      await repos.conversations.setMode(id, 'bot');
      pipeline.marcarCambioDeModo(id, 'bot');
      /*
        El cliente quedó esperando: el bot retoma él mismo con la respuesta del
        equipo, en vez de esperar a que la persona vuelva a escribir.

        La alerta NO se apaga acá. Se apaga cuando el bot logró transmitir la
        respuesta, en el pipeline. Si el turno de retomada falla, la charla tiene
        que seguir marcada: si no, el equipo tipeó una respuesta que el cliente
        nunca recibió y nada en el panel lo dice.
      */
      await pipeline.resumeAfterReview(id);
    }
    const conversation = await repos.conversations.get(id);
    if (conversation) bus.emit({ type: 'conversation', conversation });
    return { ok: true, conversation };
  });

  /** La consulta ya no aplica: el cliente se arrepintió, o se resolvió por teléfono. */
  app.delete('/api/conversations/:id/review', async (req) => {
    const { id } = req.params as { id: string };
    await repos.conversations.clearReview(id);
    /*
      La alerta se apaga con la consulta: era su único motivo. La charla queda en
      modo humano a propósito — si se descartó, alguien la está atendiendo — y por
      eso el botón del panel dice "Descartar y sigo yo".
    */
    await repos.conversations.setAttention(id, false, null);
    const conversation = await repos.conversations.get(id);
    if (conversation) bus.emit({ type: 'conversation', conversation });
    return { ok: true };
  });

  app.post('/api/conversations/:id/attention', async (req) => {
    const { id } = req.params as { id: string };
    const { needsAttention, reason } = req.body as { needsAttention: boolean; reason?: string };
    await repos.conversations.setAttention(id, needsAttention, reason ?? null);
    const conversation = await repos.conversations.get(id);
    if (conversation) bus.emit({ type: 'conversation', conversation });
    return { ok: true };
  });

  /** Mensaje escrito por una persona del local. */
  app.post('/api/conversations/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { text, quickReplyKey } = req.body as { text?: string; quickReplyKey?: string };
    if (quickReplyKey) {
      const ok = await pipeline.sendQuickReply(id, quickReplyKey);
      return ok ? { ok: true } : reply.code(404).send({ error: 'Mensaje rápido inexistente' });
    }
    if (!text?.trim()) return reply.code(400).send({ error: 'Texto vacío' });
    await pipeline.sendAsOperator(id, text.trim());
    return { ok: true };
  });

  app.patch('/api/contacts/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    await repos.contacts.update(id, {
      fullName: typeof body.fullName === 'string' ? body.fullName : undefined,
      dni: typeof body.dni === 'string' ? body.dni : undefined,
      phone: typeof body.phone === 'string' ? body.phone : undefined,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      isReturning: typeof body.isReturning === 'boolean' ? body.isReturning : undefined,
    });
    return { ok: true, contact: await repos.contacts.get(id) };
  });

  // --- Catálogo -----------------------------------------------------------

  app.get('/api/products', async (req) => {
    const query = req.query as Record<string, string | undefined>;
    return repos.products.list({
      category: query.category as ProductCategory | undefined,
      onlyAvailable: query.onlyAvailable === '1',
    });
  });

  app.patch('/api/products/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = await repos.products.get(id);
    if (!current) return reply.code(404).send({ error: 'No existe' });
    const body = req.body as Partial<Product>;
    return repos.products.upsert({
      id: current.id,
      name: body.name ?? current.name,
      category: body.category ?? current.category,
      price: body.price ?? current.price,
      availableToday: body.availableToday ?? current.availableToday,
      limitedEdition: body.limitedEdition ?? current.limitedEdition,
      pickupOnly: body.pickupOnly ?? current.pickupOnly,
      notes: body.notes ?? current.notes,
      // Cadena vacía = "sacale la foto"; undefined = "no la toques".
      imageUrl: body.imageUrl === undefined ? current.imageUrl : body.imageUrl || null,
      sortOrder: body.sortOrder ?? current.sortOrder,
    });
  });

  app.post('/api/products', async (req) => {
    const body = req.body as Partial<Product> & {
      name: string;
      category: ProductCategory;
      price: number;
    };
    const id =
      body.id ??
      body.name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return repos.products.upsert({
      id,
      name: body.name,
      category: body.category,
      price: body.price,
      availableToday: body.availableToday ?? true,
      limitedEdition: body.limitedEdition ?? false,
      pickupOnly: body.pickupOnly ?? false,
      notes: body.notes ?? null,
      imageUrl: body.imageUrl ?? null,
      sortOrder: body.sortOrder ?? 999,
    });
  });

  app.delete('/api/products/:id', async (req) => {
    const { id } = req.params as { id: string };
    await repos.products.remove(id);
    return { ok: true };
  });

  /** Marca disponible/agotado varios de una sola vez (uso típico de la mañana). */
  app.post('/api/products/availability', async (req) => {
    const { ids, available } = req.body as { ids: string[]; available: boolean };
    const updated = await repos.products.setAvailabilityMany(ids ?? [], available);
    return { ok: true, updated };
  });

  /**
   * Sube una foto y devuelve su dirección pública.
   *
   * La URL se arma con `PUBLIC_URL`, que es la que ve el mundo: el servidor
   * escucha en 127.0.0.1 detrás de un proxy con un prefijo de ruta, así que el
   * host del request no alcanza para reconstruirla. Sin `PUBLIC_URL` la foto se
   * guarda igual pero la dirección solo sirve en la misma máquina, y eso se
   * avisa en vez de devolver un link roto.
   */
  app.post('/api/media', async (req, reply) => {
    const tipo = String(req.headers['content-type'] ?? '').split(';')[0].trim();
    if (!Buffer.isBuffer(req.body)) {
      return reply.code(415).send({
        error: `No puedo con archivos de tipo "${tipo || 'desconocido'}". Tiene que ser una ` +
          'imagen jpg, png o webp.',
      });
    }
    if (!req.body.length) return reply.code(400).send({ error: 'El archivo vino vacío' });

    const filename = String(req.headers['x-filename'] ?? '').slice(0, 120) || null;
    const { id } = await repos.media.insert({ mimeType: tipo, filename, bytes: req.body });

    const base = config.publicUrl.replace(/\/$/, '');
    return {
      id,
      url: base ? `${base}/media/${id}` : `/media/${id}`,
      advertencia: base
        ? undefined
        : 'Falta PUBLIC_URL: la dirección es relativa y WhatsApp no va a poder descargarla.',
    };
  });

  // --- Pedidos ------------------------------------------------------------

  app.get('/api/orders', async (req) => {
    const query = req.query as Record<string, string | undefined>;
    return repos.orders.list({
      status: query.status as OrderStatus | undefined,
      limit: query.limit ? Number(query.limit) : 200,
    });
  });

  app.post('/api/orders', async (req) => {
    const body = req.body as Record<string, unknown>;
    const order = await repos.orders.create({
      conversationId: (body.conversationId as string) ?? null,
      contactId: (body.contactId as string) ?? null,
      customerName: String(body.customerName ?? 'Sin nombre'),
      customerDni: (body.customerDni as string) ?? null,
      customerPhone: (body.customerPhone as string) ?? null,
      items: Array.isArray(body.items) ? (body.items as never[]) : [],
      total: Number(body.total ?? 0),
      paid: Number(body.paid ?? 0),
      status: (body.status as OrderStatus) ?? 'borrador',
      deliveryMode: (body.deliveryMode as never) ?? 'retira-local',
      deliveryDate: (body.deliveryDate as string) ?? null,
      deliveryTime: (body.deliveryTime as string) ?? null,
      address: (body.address as string) ?? null,
      recipientName: (body.recipientName as string) ?? null,
      dedication: (body.dedication as string) ?? null,
      notes: (body.notes as string) ?? null,
      campaignId: (body.campaignId as string) ?? null,
      campaignSkuId: (body.campaignSkuId as string) ?? null,
      createdBy: 'human',
    });
    bus.emit({ type: 'order', order });
    return order;
  });

  app.patch('/api/orders/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = await repos.orders.update(id, req.body as never);
    if (!order) return reply.code(404).send({ error: 'No existe' });
    bus.emit({ type: 'order', order });
    return order;
  });

  // --- Campañas -----------------------------------------------------------

  app.get('/api/campaigns', async () => {
    const list = await repos.campaigns.listAll();
    return Promise.all(
      list.map(async (campaign) => ({
        ...campaign,
        skus: await repos.campaigns.skus(campaign.id),
      })),
    );
  });

  app.post('/api/campaigns', async (req) => {
    const body = req.body as Record<string, unknown>;
    const today = new Date().toISOString().slice(0, 10);
    return repos.campaigns.create({
      name: String(body.name ?? 'Campaña'),
      startsOn: String(body.startsOn ?? today),
      endsOn: String(body.endsOn ?? today),
      active: body.active !== false,
      pitch: (body.pitch as string) ?? null,
    });
  });

  app.post('/api/campaigns/:id/active', async (req) => {
    const { id } = req.params as { id: string };
    const { active } = req.body as { active: boolean };
    await repos.campaigns.setActive(id, active);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/skus', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    return repos.campaigns.upsertSku({
      id: body.id as string | undefined,
      campaignId: id,
      name: String(body.name ?? 'SKU'),
      price: Number(body.price ?? 0),
      stockTotal: Number(body.stockTotal ?? 0),
      stockUsed: Number(body.stockUsed ?? 0),
      sortOrder: Number(body.sortOrder ?? 0),
    });
  });

  // --- Cursos -------------------------------------------------------------

  app.get('/api/courses', async () => repos.courses.list());

  app.post('/api/courses', async (req) => {
    const body = req.body as Record<string, unknown>;
    return repos.courses.upsert({
      id: body.id as string | undefined,
      name: String(body.name ?? 'Curso'),
      description: (body.description as string) ?? null,
      price: Number(body.price ?? 0),
      location: (body.location as string) ?? null,
      modality: body.modality === 'online' ? 'online' : 'presencial',
      imageUrl: (body.imageUrl as string) || null,
      active: body.active !== false,
    });
  });

  app.patch('/api/courses/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const actual = await repos.courses.get(id);
    if (!actual) return reply.code(404).send({ error: 'No existe' });
    const body = req.body as Record<string, unknown>;
    return repos.courses.upsert({
      id: actual.id,
      name: (body.name as string) ?? actual.name,
      description: body.description === undefined ? actual.description : (body.description as string),
      price: body.price === undefined ? actual.price : Number(body.price),
      location: body.location === undefined ? actual.location : (body.location as string),
      modality: (body.modality as 'presencial' | 'online') ?? actual.modality,
      // Cadena vacía = "sacale la foto"; undefined = "no la toques".
      imageUrl: body.imageUrl === undefined ? actual.imageUrl : (body.imageUrl as string) || null,
      active: body.active === undefined ? actual.active : body.active !== false,
    });
  });

  app.delete('/api/courses/:id', async (req) => {
    const { id } = req.params as { id: string };
    await repos.courses.remove(id);
    return { ok: true };
  });

  app.post('/api/courses/:id/sessions', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    return repos.courses.upsertSession({
      id: body.id as string | undefined,
      courseId: id,
      label: String(body.label ?? ''),
      capacity: Number(body.capacity ?? 0),
      sortOrder: Number(body.sortOrder ?? 0),
    });
  });

  app.delete('/api/courses/sessions/:id', async (req) => {
    const { id } = req.params as { id: string };
    await repos.courses.removeSession(id);
    return { ok: true };
  });

  /** La planilla de inscriptos de un curso. */
  app.get('/api/courses/:id/signups', async (req) => {
    const { id } = req.params as { id: string };
    return repos.courses.signups(id);
  });

  /** Alta a mano: alguien que se anotó por Instagram o en el mostrador. */
  app.post('/api/courses/:id/signups', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const curso = await repos.courses.get(id);
    return repos.courses.createSignup({
      courseId: id,
      sessionId: (body.sessionId as string) ?? null,
      contactId: null,
      conversationId: null,
      fullName: String(body.fullName ?? 'Sin nombre'),
      contactInfo: (body.contactInfo as string) ?? null,
      total: Number(body.total ?? curso?.price ?? 0),
      paid: Number(body.paid ?? 0),
      status: (body.status as never) ?? 'pendiente',
      notes: (body.notes as string) ?? null,
      createdBy: 'human',
    });
  });

  app.patch('/api/courses/signups/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const antes = await repos.courses.signup(id);
    if (!antes) return reply.code(404).send({ error: 'No existe' });

    const patch = req.body as Record<string, unknown>;
    const signup = await repos.courses.updateSignup(id, patch as never);
    if (!signup) return reply.code(404).send({ error: 'No existe' });

    /*
      Marcar a alguien como inscripto es el momento en que se le avisa: es lo que
      pidió el local, y es el único mensaje del flujo de cursos que sale sin que
      el cliente haya escrito. Va una sola vez —solo en la transición— y solo si
      la persona se anotó por el chat: quien se anotó por Instagram no tiene
      conversación a la que escribirle.
    */
    const seInscribioAhora = antes.status !== 'inscripto' && signup.status === 'inscripto';
    if (seInscribioAhora && signup.conversationId) {
      const enviado = await pipeline.sendQuickReply(signup.conversationId, 'curso-inscripcion');
      if (!enviado) {
        bus.emit({
          type: 'log',
          level: 'warn',
          message: 'No existe el mensaje rápido curso-inscripcion: no se avisó la inscripción',
        });
      }
    }
    return signup;
  });

  app.delete('/api/courses/signups/:id', async (req) => {
    const { id } = req.params as { id: string };
    await repos.courses.removeSignup(id);
    return { ok: true };
  });

  // --- Mensajes rápidos ---------------------------------------------------

  app.get('/api/quick-replies', async () => {
    const [settings, products, list] = await Promise.all([
      repos.settings.read(),
      repos.products.list(),
      repos.quickReplies.list(),
    ]);
    return list.map((qr) => ({
      ...qr,
      /** Cómo queda el texto con los datos de hoy ya interpolados. */
      preview: renderQuickReply(qr.body, settings, products),
    }));
  });

  app.post('/api/quick-replies', async (req) => {
    const body = req.body as Record<string, unknown>;
    return repos.quickReplies.upsert({
      key: String(body.key),
      label: String(body.label ?? body.key),
      body: String(body.body ?? ''),
      triggers: Array.isArray(body.triggers) ? (body.triggers as string[]) : [],
      autoSend: body.autoSend === true,
    });
  });

  app.delete('/api/quick-replies/:key', async (req) => {
    const { key } = req.params as { key: string };
    await repos.quickReplies.remove(key);
    return { ok: true };
  });

  // --- Métricas y ajustes -------------------------------------------------

  app.get('/api/metrics', async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const days = query.days ? Number(query.days) : 14;
    const [summary, daily, intents, quickReplies] = await Promise.all([
      repos.metrics.summary(),
      repos.metrics.daily(days),
      repos.metrics.intents(days),
      repos.quickReplies.list(),
    ]);
    return {
      summary,
      daily,
      intents,
      quickReplies: quickReplies
        .map((qr) => ({ key: qr.key, label: qr.label, usageCount: qr.usageCount }))
        .sort((a, b) => b.usageCount - a.usageCount),
    };
  });

  app.get('/api/settings', async () => ({
    settings: await repos.settings.read(),
    channels: await channels.healthAll(),
  }));

  app.patch('/api/settings', async (req) => {
    const settings = await repos.settings.write(req.body as never);
    bus.emit({ type: 'log', level: 'info', message: 'Ajustes actualizados desde el panel' });
    return settings;
  });
}
