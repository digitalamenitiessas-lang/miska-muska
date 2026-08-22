/**
 * Carga inicial: catálogo transcripto de la carta de pastelería y de la tienda
 * online, más los mensajes rápidos que el equipo ya usa en WhatsApp.
 *
 * Idempotente: se puede correr muchas veces (upsert por id/key). No toca la
 * disponibilidad del día si el producto ya existe, para no pisar lo que el
 * local marcó desde el panel.
 */

import { pathToFileURL } from 'node:url';
import { closeDb, migrate, nowIso, openDb } from './db.js';
import { createRepositories } from './repositories.js';
import type { Product, ProductCategory } from '../types/domain.js';
import { assertConfig, config } from '../../config.js';

type SeedProduct = {
  id: string;
  name: string;
  category: ProductCategory;
  price: number;
  limitedEdition?: boolean;
  pickupOnly?: boolean;
  notes?: string;
};

const CATALOG: SeedProduct[] = [
  // --- Cookies estilo New York -------------------------------------------
  { id: 'cookie-clasica', name: 'Cookie clásica', category: 'cookies', price: 4000 },
  { id: 'cookie-red-velvet', name: 'Cookie red velvet', category: 'cookies', price: 4000 },
  { id: 'cookie-vainilla-chips', name: 'Cookie vainilla con chips', category: 'cookies', price: 4000 },
  { id: 'cookie-pistacho', name: 'Cookie pistacho', category: 'cookies', price: 5000 },
  { id: 'cookie-nutella', name: 'Cookie nutella', category: 'cookies', price: 5000 },
  { id: 'cookie-kinder', name: 'Cookie kinder', category: 'cookies', price: 5000 },
  { id: 'cookie-dubai', name: 'Cookie dubai', category: 'cookies', price: 5000 },
  { id: 'cookie-ferrero', name: 'Cookie ferrero', category: 'cookies', price: 5000 },
  { id: 'cookie-nutella-oreo', name: 'Cookie nutella y oreo', category: 'cookies', price: 5000 },
  {
    id: 'box-cookies-limitada',
    name: 'Box de cookies edición limitada',
    category: 'cookies',
    price: 22000,
    limitedEdition: true,
    notes: 'Los sabores cambian: hay que consultar cuáles hay este mes.',
  },

  // --- Muffins ------------------------------------------------------------
  { id: 'muffin-vainilla-ddl', name: 'Muffin vainilla con chips y corazón de dulce de leche', category: 'muffins', price: 4100 },
  { id: 'muffin-choco-ddl', name: 'Muffin chocolate con corazón de dulce de leche', category: 'muffins', price: 4100 },
  { id: 'muffin-limon-arandanos', name: 'Muffin limón y arándanos', category: 'muffins', price: 4100 },
  { id: 'muffin-maracuya', name: 'Muffin maracuyá', category: 'muffins', price: 4100 },
  { id: 'muffin-pistacho', name: 'Muffin pistacho', category: 'muffins', price: 4800 },

  // --- Mini tortas --------------------------------------------------------
  { id: 'mini-matilda', name: 'Mini torta Matilda', category: 'mini-tortas', price: 10800 },
  { id: 'mini-chocotorta', name: 'Mini torta Chocotorta', category: 'mini-tortas', price: 10800 },
  { id: 'mini-oreo', name: 'Mini torta Oreo', category: 'mini-tortas', price: 10800 },
  { id: 'mini-kinder', name: 'Mini torta Kinder', category: 'mini-tortas', price: 10800 },
  { id: 'mini-tres-leches', name: 'Mini torta Tres leches', category: 'mini-tortas', price: 10800 },
  { id: 'mini-frutillas', name: 'Mini torta de frutillas', category: 'mini-tortas', price: 10800 },
  {
    id: 'mini-limitada',
    name: 'Mini torta de edición limitada',
    category: 'mini-tortas',
    price: 10800,
    limitedEdition: true,
    notes: 'El sabor cambia. Hay que consultar cuál está esta semana.',
  },

  // --- Cuadrados de la felicidad -----------------------------------------
  { id: 'brownie-clasico', name: 'Brownie clásico', category: 'cuadrados', price: 4200 },
  { id: 'brownie-oreo', name: 'Brownie Oreo', category: 'cuadrados', price: 4700 },
  { id: 'brockie', name: 'Brockie', category: 'cuadrados', price: 4700 },
  { id: 'brownie-nueces', name: 'Brownie con nueces', category: 'cuadrados', price: 4700 },
  { id: 'cuadrado-coco-ddl', name: 'Cuadrado de coco con dulce de leche', category: 'cuadrados', price: 4700 },
  { id: 'cuadrado-limon', name: 'Cuadrado de limón', category: 'cuadrados', price: 4700 },
  { id: 'brownie-pistacho', name: 'Brownie pistacho', category: 'cuadrados', price: 6300 },

  // --- Alfajores ----------------------------------------------------------
  { id: 'alfajor-brownie', name: 'Alfajor brownie', category: 'alfajores', price: 3500 },
  { id: 'alfajor-block', name: 'Alfajor block', category: 'alfajores', price: 3500 },
  { id: 'alfajor-tres-leches', name: 'Alfajor tres leches', category: 'alfajores', price: 3500 },
  { id: 'alfajor-pistacho-ddl', name: 'Alfajor pistacho y dulce de leche', category: 'alfajores', price: 4500 },
  { id: 'conito-ferrero-ddl', name: 'Conito de ferrero y dulce de leche', category: 'alfajores', price: 4500 },
  {
    id: 'caja-alfajores',
    name: 'Caja de alfajores',
    category: 'alfajores',
    price: 17000,
    limitedEdition: true,
    notes: 'Los sabores de la caja cambian cada mes: consultar cuáles trae.',
  },

  // --- Tabletas rellenas --------------------------------------------------
  { id: 'tableta-blanco-nutella-oreo', name: 'Tableta de chocolate blanco rellena de nutella y oreo', category: 'tabletas', price: 14000 },
  { id: 'tableta-leche-pistacho', name: 'Tableta de chocolate con leche y pistacho', category: 'tabletas', price: 14000 },
  { id: 'tableta-franui-nutella', name: 'Tableta de franui y nutella', category: 'tabletas', price: 14000 },

  // --- Lo saladito --------------------------------------------------------
  { id: 'chipa', name: 'Chipá (por unidad)', category: 'saladito', price: 2000 },
  { id: 'sanguchito-provenzal', name: 'Sanguchito de jamón y queso en pan de provenzal', category: 'saladito', price: 5500 },
  { id: 'sanguchito-chipa', name: 'Sanguchito de jamón y queso en pan de chipá', category: 'saladito', price: 7800 },

  // --- Tortas (SOLO retiro en local o Uber del cliente) -------------------
  { id: 'tarta-frutilla', name: 'Tarta de frutilla', category: 'tortas', price: 32000, pickupOnly: true },
  { id: 'frutimiska-chocolate', name: 'Frutimiska chocolate', category: 'tortas', price: 44000, pickupOnly: true },
  { id: 'frutimiska-vainilla', name: 'Frutimiska vainilla', category: 'tortas', price: 44000, pickupOnly: true },
  { id: 'torta-red-velvet', name: 'Torta red velvet', category: 'tortas', price: 46500, pickupOnly: true },
  { id: 'torta-chocoreo', name: 'Torta chocoreo', category: 'tortas', price: 54000, pickupOnly: true },

  // --- Desayunos y boxes (sí se envían a domicilio) -----------------------
  { id: 'desayuno-buen-dia', name: 'Desayuno "buen día"', category: 'desayunos', price: 46000 },
  { id: 'desayuno-miska-muska', name: 'Desayuno Miska Muska', category: 'desayunos', price: 39500 },
  { id: 'box-popurri', name: 'Box popurrí', category: 'desayunos', price: 33000 },
  { id: 'box-requete-feliz', name: 'Box requete feliz', category: 'desayunos', price: 23000 },
];

/**
 * Mensajes rápidos: los textos que el equipo ya usaba en WhatsApp, con el ajuste
 * de forma que pidió el local — sin signos de apertura, sin las fórmulas de
 * apertura ("muchas gracias por escribirnos", "muchas gracias por tu consulta") y
 * con un emoji por mensaje en vez de tres. Tampoco piden el DNI de rutina: eso lo
 * pide el equipo cuando lo necesita para un pedido puntual.
 *
 * Lo que NO se toca: los datos duros ({{alias}}, {{titular}}, {{direccion}},
 * links, precios), el registro informal del equipo ("amor", "porqe", "qe",
 * minúsculas al arrancar) y los emojis que hacen de viñeta de una lista, que son
 * estructura y no decoración.
 */
const QUICK_REPLIES = [
  {
    key: 'saludo',
    label: 'Saludo inicial (solo "hola")',
    autoSend: false,
    triggers: ['hola', 'holaa', 'buenas', 'buen dia', 'buenas tardes', 'buenas noches'],
    body:
      'Hola! como estas? 🫶🏻\n' +
      'soy {{agente}}, en que te puedo ayudar?',
  },
  {
    key: 'desayunos',
    label: 'Consulta por desayunos / boxes',
    autoSend: false,
    triggers: ['desayuno', 'desayunos', 'box', 'regalo sorpresa', 'merienda'],
    body:
      'Holaa! Tenemos 4 opciones de box para enviar como desayuno, merienda o regalo sorpresa 🥰 ' +
      'el envío lo hacemos nosotros, en el horario que necesites! Te paso el link donde podrás ver ' +
      'las 4 opciones, cualquier duda podes consultarme sin problema {{linkDesayunos}}',
  },
  {
    key: 'cookies-disponibles',
    label: 'Cookies disponibles hoy',
    autoSend: false,
    triggers: ['cookies', 'cookie', 'galletas', 'que cookies hay'],
    body:
      'nuestras cookies disponibles hoy son 👇🏼\n{{cookiesHoy}}\n\n' +
      'Te gustaría encargar alguna? 😍\n' +
      'podes abonar por transferencia y mandar un uber a retirar',
  },
  {
    key: 'mini-tortas-disponibles',
    label: 'Mini tortas disponibles hoy',
    autoSend: false,
    triggers: ['mini torta', 'mini tortas', 'minitorta', 'que minis hay'],
    body:
      'nuestras mini tortas disponibles hoy son:\n' +
      '{{miniTortasHoy}}\n\nsu precio es ${{precioMiniTorta}}\nte gustaria encargar alguna? 💕',
  },
  {
    key: 'datos-pedido',
    label: 'Datos para tomar un pedido para otro día',
    autoSend: false,
    triggers: ['encargar', 'encargo', 'para el sabado', 'para mañana', 'reservar'],
    body:
      'Para completar el pedido te pido estos datos por favor 🥰\n\n' +
      '▫️Nombre y apellido:\n▫️Número de tel:\n▫️producto:\n▫️fecha y hora de retiro:\n\n' +
      'Con los datos y comprobante queda el pedido tomado!\n\n' +
      'Alias: {{alias}}\n\nMercado Pago\n{{titular}}\n\n' +
      'Por favor enviar COMPROBANTE de la transferencia ☺️ gracias!',
  },
  {
    /*
      Los desayunos y boxes van siempre con nuestro cadete, así que necesitan datos
      que el mensaje de retiro no pide: quién recibe y la dirección. Van todos en un
      solo mensaje a propósito: pedirlos de a uno es lo que hacía que la charla se
      volviera un interrogatorio.
    */
    key: 'datos-envio-desayuno',
    label: 'Datos para un envío nuestro (desayuno o box)',
    autoSend: false,
    triggers: ['envio a domicilio', 'lo mandan', 'hacen envio', 'mandar a domicilio'],
    body:
      'Para el envío te pido estos datos 🥰\n\n' +
      '▫️Nombre y apellido tuyo:\n▫️Tu número de tel:\n▫️Nombre de quien lo recibe:\n' +
      '▫️Dirección con alguna referencia:\n▫️Día y franja horaria:\n▫️Dedicatoria:\n\n' +
      'Con los datos y el comprobante queda el pedido tomado!\n\n' +
      'Alias: {{alias}}\n\nMercado Pago\n{{titular}}',
  },
  {
    key: 'no-envio-tortas',
    label: 'No enviamos tortas',
    autoSend: false,
    triggers: ['envian tortas', 'envio de torta', 'mandan tortas', 'delivery de torta'],
    body:
      'no enviamos tortas amor, porqe queremos qe llegue en buenas condiciones, ' +
      'podes retirar del local, estamos en {{direccion}}, o pedir un uber auto y aca le entregamos 🙏🏻',
  },
  {
    /*
      La etiqueta es lo único que ve el modelo cuando decide qué mensaje traer, así
      que dice cuándo aplica: el Uber es para algo del momento o para una torta que
      no enviamos, nunca para un desayuno. `cadete` sale de los disparadores porque
      el cadete es NUESTRO y ese mensaje habla del Uber del cliente.
    */
    key: 'uber',
    label: 'Cómo mandar un Uber (solo para algo del momento, o torta)',
    autoSend: false,
    triggers: ['uber', 'uber envio', 'mando un uber', 'mando un auto', 'pedido ya', 'rappi'],
    body:
      'nuestra direccion es {{direccion}} 📍\n' +
      'podes pedir el uber envio, te recomendamos que le pongas pin para mas seguridad 🔒, ' +
      'decile al chofer tu nombre para retirar el pedido, mandanos captura con la info del conductor, ' +
      'y un mensajito cuando este afuera\nmuchas gracias por elegirnos!',
  },
  {
    key: 'curso-inscripcion',
    label: 'Confirmación de inscripción a curso (post pago)',
    autoSend: false,
    triggers: ['me anote', 'curso pagado', 'ya transferi el curso'],
    body:
      'Gracias por anotarte! 💖 Te contamos que el lugar ya quedo reservado una vez que hiciste el pago. ' +
      'Como los cupos son limitados, ese lugar queda guardado solo para vos, y te avisamos con ' +
      'anticipación que por este motivo no hacemos devoluciones ni cancelaciones en caso de que no ' +
      'puedas venir.\nTe mandamos un link para el grupo de wp, ahí pasaremos toda la info',
  },
  {
    key: 'cursos',
    label: 'Consulta por cursos',
    autoSend: false,
    triggers: ['curso', 'cursos', 'clases', 'taller'],
    body:
      'Tenemos cursos 🥰 te paso la info completa acá: {{linkCursos}}\n' +
      'La inscripción queda confirmada únicamente con el pago, porque los cupos son limitados. ' +
      'te gustaría que te reserve un lugar?',
  },
  {
    key: 'no-cafeteria',
    label: 'No enviamos cafetería',
    autoSend: false,
    triggers: ['cafe', 'cafeteria', 'capuchino', 'cortado'],
    body:
      'Cafetería no enviamos amor 🙏🏻 pero te esperamos en el local para tomar algo rico, ' +
      'estamos en {{direccion}}',
  },
  {
    key: 'web',
    label: 'Links (web y cursos)',
    autoSend: false,
    triggers: ['pagina', 'web', 'link', 'catalogo'],
    body: 'Página web: {{linkWeb}}\nPágina de cursos online: {{linkCursos}} 💕',
  },
] satisfies Array<{ key: string; label: string; body: string; triggers: string[]; autoSend: boolean }>;

export async function seed(): Promise<void> {
  const repos = createRepositories();

  const existing = new Map((await repos.products.list()).map((p) => [p.id, p]));
  for (const [index, p] of CATALOG.entries()) {
    const prev = existing.get(p.id);
    const product: Omit<Product, 'updatedAt'> = {
      id: p.id,
      name: p.name,
      category: p.category,
      price: p.price,
      // Respeta lo que el local haya marcado hoy; si es nuevo, entra disponible.
      availableToday: prev ? prev.availableToday : true,
      limitedEdition: p.limitedEdition ?? false,
      pickupOnly: p.pickupOnly ?? false,
      notes: p.notes ?? null,
      sortOrder: index,
    };
    await repos.products.upsert(product);
  }

  for (const q of QUICK_REPLIES) await repos.quickReplies.upsert(q);

  // Configuración por defecto si es la primera vez.
  await repos.settings.write({});

  // Campaña de ejemplo con la estructura real de "Día de la Madre":
  // tres SKUs con control de stock total / usado / disponible.
  if ((await repos.campaigns.listAll()).length === 0) {
    const campaign = await repos.campaigns.create({
      name: 'Día de la Madre',
      startsOn: '2026-10-05',
      endsOn: '2026-10-19',
      active: false,
      pitch:
        'Tenemos tres opciones para mamá: caja de alfajores, box mamá y desayuno mamá 💕 ' +
        'El pedido queda confirmado únicamente cuando se acredita el pago, y te recomendamos ' +
        'retirar en el local para que llegue impecable.',
    });
    const skus = [
      { name: 'Caja de alfajores mamá', price: 15500, stockTotal: 123 },
      { name: 'Box mamá', price: 39000, stockTotal: 150 },
      { name: 'Desayuno mamá', price: 40000, stockTotal: 150 },
    ];
    for (const [i, s] of skus.entries()) {
      await repos.campaigns.upsertSku({
        campaignId: campaign.id,
        name: s.name,
        price: s.price,
        stockTotal: s.stockTotal,
        stockUsed: 0,
        sortOrder: i,
      });
    }
  }

  const counts = {
    productos: (await repos.products.list()).length,
    mensajesRapidos: (await repos.quickReplies.list()).length,
    campanas: (await repos.campaigns.listAll()).length,
  };
  console.log(`[seed ${nowIso()}]`, counts);
}

// Permite `npm run seed`. Se usa `pathToFileURL` porque armar el `file://` a
// mano no coincide en Windows (una ruta con letra de unidad necesita tres barras).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertConfig();
  openDb({
    connectionString: config.database.url,
    password: config.database.password,
    ssl: config.database.ssl,
  });
  await migrate();
  await seed();
  await closeDb();
}
