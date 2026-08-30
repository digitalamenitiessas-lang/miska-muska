/**
 * Datos de demostración para mostrar el panel funcionando sin conectar canales.
 * `npm run demo` — escribe directo en la base, no toca Telegram ni WhatsApp.
 * Los diálogos son reescrituras de consultas reales del WhatsApp del local.
 */

import { pathToFileURL } from 'node:url';
import { closeDb, migrate, nowIso, openDb } from './db.js';
import { createRepositories } from './repositories.js';
import { seed } from './seed.js';
import { assertConfig, config } from '../../config.js';
import type { ChannelId, MessageAuthor } from '../types/message.js';

interface DemoTurn {
  dir: 'in' | 'out';
  text: string;
  author?: MessageAuthor;
  intent?: string;
  handler?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
}

interface DemoChat {
  channel: ChannelId;
  externalId: string;
  name: string;
  phone?: string;
  mode?: 'bot' | 'human';
  attention?: string;
  notes?: string;
  returning?: boolean;
  minutesAgo: number;
  turns: DemoTurn[];
}

const bot = (
  text: string,
  intent = 'chat',
  extra: Partial<DemoTurn> = {},
): DemoTurn => ({
  dir: 'out',
  author: 'bot',
  text,
  intent,
  handler: 'agent',
  latencyMs: 1800 + Math.floor(Math.random() * 2600),
  inputTokens: 4200 + Math.floor(Math.random() * 900),
  outputTokens: 90 + Math.floor(Math.random() * 160),
  cacheReadTokens: 3800,
  // Precio real de anthropic/claude-sonnet-5 en OpenRouter: la mayor parte de la
  // entrada se lee de caché, así que un turno cuesta centavos de centavo.
  costUsd: 0.0009 + Math.random() * 0.0011,
  ...extra,
});

const CHATS: DemoChat[] = [
  {
    channel: 'telegram',
    externalId: '5510001',
    name: 'Agustina Resino',
    phone: '+5493815550101',
    minutesAgo: 4,
    notes: 'Le compra a la mamá todos los meses. Prefiere retirar los sábados a la mañana.',
    returning: true,
    turns: [
      { dir: 'in', text: 'holaa! que cookies tenes hoy?' },
      bot(
        'Holaa! Cómo estás? 🥰 Hoy tenemos cookie clásica y red velvet a $4000, y ferrero, kinder, nutella, dubai y pistacho a $5000',
        'disponibilidad_hoy',
      ),
      bot('Te gustaría encargar alguna? Podés abonar por transferencia y mandar un Uber a retirar'),
      { dir: 'in', text: 'dame 2 de kinder y 1 de ferrero' },
      bot(
        'Listo, 2 kinder y 1 ferrero: $15.000 en total. Por $14.000 te gustaría agregar una tableta rellena? Aprovechás el mismo viaje 😍',
        'buscar_catalogo',
      ),
      { dir: 'in', text: 'siii la de franui y nutella' },
      bot(
        'Total $29.000. Te paso el alias MISKATUC (MISKA MUSKA SAS, Mercado Pago) y con el comprobante te lo dejo listo 💕',
        'crear_pedido',
      ),
    ],
  },
  {
    channel: 'telegram',
    externalId: '5510002',
    name: 'Martín Aguirre',
    minutesAgo: 22,
    notes: 'Vive en España. Le manda regalos a la mamá en Tucumán.',
    turns: [
      { dir: 'in', text: 'buenas! estoy viviendo en españa y queria mandarle algo a mi mama' },
      bot(
        'Un regalo desde tan lejos siempre pega fuerte 🥰 Contame qué tenías pensado y vemos algo que la sorprenda',
        'registrar_nota_cliente',
      ),
      { dir: 'in', text: 'un desayuno estaria genial, es su cumple el viernes' },
      bot(
        'Tenemos cuatro opciones de box para enviar como desayuno, y los llevamos nosotros. Te paso el link así los ves y cualquier duda me consultás sin problema https://miskamuska.com.ar/product-category/desayunos/',
        'mensaje_rapido',
        { handler: 'agent' },
      ),
      { dir: 'in', text: 'el desayuno miska muska. le puedo poner una dedicatoria?' },
      bot(
        'Obvio que sí 🫶🏻 Si querés te tiro tres opciones y elegís la que más suene a vos. Necesito también tu teléfono, la dirección con alguna referencia, el nombre de tu mamá y en qué franja horaria le va mejor — se lo mandamos como sorpresa',
      ),
    ],
  },
  {
    channel: 'telegram',
    externalId: '5510003',
    name: 'Romina Iñigo',
    phone: '+5493816157001',
    mode: 'human',
    attention: '[excepcion_pago] Quiere pagar la mitad ahora y la mitad al retirar. Son 6 boxes.',
    minutesAgo: 47,
    turns: [
      { dir: 'in', text: 'hola! necesito 6 box de alfajores para el sabado' },
      bot(
        'Holaa! Seis cajas de alfajores para el sábado, te las anoto. Son $17.000 cada una 💕',
        'buscar_catalogo',
      ),
      { dir: 'in', text: 'puedo señar la mitad y el resto cuando retiro?' },
      bot(
        'Dejame que lo consulto con la encargada un segundito 🙏🏻 En un rato te escribe para verlo bien',
        'escalar_a_humano',
        { handler: 'escalate' },
      ),
      {
        dir: 'out',
        author: 'human',
        text: 'Hola Romi! Soy Mica. Como sos clienta de siempre te lo hacemos: señá 3 cajas ahora y el resto el sábado 🫶🏻',
        handler: 'operator',
      },
    ],
  },
  {
    channel: 'telegram',
    externalId: '5510004',
    name: 'Fabricio Leones',
    minutesAgo: 96,
    turns: [
      { dir: 'in', text: 'hacen envio de tortas a domicilio?' },
      bot(
        'No enviamos tortas amor 🙏🏻 es porque queremos que te llegue en buenas condiciones. Podés retirarla del local, estamos en Marcos Paz 473, o pedir un Uber auto y acá se lo entregamos',
        'mensaje_rapido',
      ),
      { dir: 'in', text: 'ah ok. y una torta de lilo y stitch para nena hacen?' },
      bot(
        'Uy en eso no te puedo ayudar: trabajamos solamente con las tortas del catálogo, no hacemos temáticas. Pero la chocoreo y la red velvet siempre andan muy bien en los cumples, te muestro?',
        'buscar_catalogo',
      ),
    ],
  },
  {
    channel: 'telegram',
    externalId: '5510005',
    name: 'Cecilia Cumin',
    minutesAgo: 210,
    turns: [
      { dir: 'in', text: 'hola, queria saber por los cursos' },
      bot(
        'Holaa! Cómo estás? 🫶🏻 Tenemos cursos, te paso toda la info acá: https://www.cursos.miskamuska.com.ar',
        'mensaje_rapido',
      ),
      bot(
        'La inscripción queda confirmada únicamente con el pago porque los cupos son limitados. Querés que te reserve un lugar?',
      ),
      { dir: 'in', text: 'si dale, ya transferi' },
      bot(
        'Gracias por anotarte! 💖 El lugar ya quedó reservado. Como los cupos son limitados te avisamos que no hacemos devoluciones ni cancelaciones. Te mando el link del grupo de wp, ahí pasamos toda la info',
        'mensaje_rapido',
      ),
    ],
  },
];

export async function loadDemoData(): Promise<void> {
  await seed();
  const repos = createRepositories();

  if ((await repos.conversations.list({ limit: 1 })).length > 0) {
    console.log('Ya hay conversaciones en la base: no cargo la demo para no mezclar datos.');
    console.log('Si querés empezar de cero, vaciá las tablas y volvé a correrlo.');
    return;
  }

  const products = new Map((await repos.products.list()).map((p) => [p.id, p]));

  for (const chat of CHATS) {
    const contact = await repos.contacts.upsert(chat.channel, {
      externalId: chat.externalId,
      displayName: chat.name,
      phone: chat.phone,
    });
    await repos.contacts.update(contact.id, {
      fullName: chat.name,
      phone: chat.phone,
      isReturning: chat.returning ?? false,
    });
    if (chat.notes) await repos.contacts.appendNote(contact.id, chat.notes);

    const conversation = await repos.conversations.ensure(
      chat.channel,
      chat.externalId,
      contact.id,
    );

    // Los turnos se reparten hacia atrás desde `minutesAgo`, 90 s entre mensajes.
    const base = Date.now() - chat.minutesAgo * 60_000;
    for (const [index, turn] of chat.turns.entries()) {
      await repos.messages.insert({
        conversationId: conversation.id,
        channel: chat.channel,
        channelMessageId: `demo-${chat.externalId}-${index}`,
        direction: turn.dir,
        author: turn.dir === 'in' ? 'human' : (turn.author ?? 'bot'),
        contentKind: 'text',
        text: turn.text,
        payload: { kind: 'text', text: turn.text },
        intent: turn.intent ?? null,
        handler: turn.handler ?? null,
        latencyMs: turn.latencyMs ?? null,
        inputTokens: turn.inputTokens ?? null,
        outputTokens: turn.outputTokens ?? null,
        cacheReadTokens: turn.cacheReadTokens ?? null,
        costUsd: turn.costUsd ?? null,
        model: turn.dir === 'out' && turn.author !== 'human' ? 'anthropic/claude-sonnet-5' : null,
        error: null,
        createdAt: new Date(base + index * 90_000).toISOString(),
      });
    }

    const last = chat.turns[chat.turns.length - 1];
    if (last.dir === 'in') await repos.conversations.markInbound(conversation.id, last.text, null);
    else await repos.conversations.markOutbound(conversation.id, last.text);

    if (chat.mode) await repos.conversations.setMode(conversation.id, chat.mode);
    if (chat.attention) {
      await repos.conversations.setAttention(conversation.id, true, chat.attention);
    }
  }

  // Un par de pedidos con la forma del "Pedido 3069" real.
  const agustina = (await repos.conversations.list({ limit: 50 })).find(
    (c) => c.externalId === '5510001',
  );
  const cookieKinder = products.get('cookie-kinder');
  const cookieFerrero = products.get('cookie-ferrero');
  const tableta = products.get('tableta-franui-nutella');
  if (agustina && cookieKinder && cookieFerrero && tableta) {
    await repos.orders.create({
      conversationId: agustina.id,
      contactId: agustina.contactId,
      customerName: 'Agustina Resino',
      customerDni: '41234567',
      customerPhone: '+5493815550101',
      items: [
        { productId: cookieKinder.id, description: cookieKinder.name, quantity: 2, unitPrice: cookieKinder.price },
        { productId: cookieFerrero.id, description: cookieFerrero.name, quantity: 1, unitPrice: cookieFerrero.price },
        { productId: tableta.id, description: tableta.name, quantity: 1, unitPrice: tableta.price },
      ],
      total: cookieKinder.price * 2 + cookieFerrero.price + tableta.price,
      paid: 0,
      status: 'borrador',
      deliveryMode: 'uber-cliente',
      deliveryDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      deliveryTime: '17:00 a 18:00',
      address: null,
      recipientName: null,
      dedication: null,
      notes: 'Mandar con papel extra, viaja en Uber',
      campaignId: null,
      campaignSkuId: null,
      createdBy: 'bot',
    });
  }

  const chocoreo = products.get('torta-chocoreo');
  if (chocoreo) {
    await repos.orders.create({
      conversationId: null,
      contactId: null,
      customerName: 'Victoria Antonelli',
      customerDni: '38512400',
      customerPhone: '+5493815124000',
      items: [{ productId: chocoreo.id, description: chocoreo.name, quantity: 1, unitPrice: chocoreo.price }],
      total: chocoreo.price,
      paid: chocoreo.price,
      status: 'confirmado',
      deliveryMode: 'retira-local',
      deliveryDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
      deliveryTime: '16:18',
      address: null,
      recipientName: null,
      dedication: 'Feliz cumple mami!',
      notes: 'Agregar velas, sumar notita con dedicatoria',
      campaignId: null,
      campaignSkuId: null,
      createdBy: 'human',
    });
  }

  const orders = await repos.orders.list();
  console.log(
    `[demo ${nowIso()}] cargadas ${CHATS.length} conversaciones y ${orders.length} pedidos.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertConfig();
  openDb({
    connectionString: config.database.url,
    password: config.database.password,
    ssl: config.database.ssl,
  });
  await migrate();
  await loadDemoData();
  await closeDb();
}
