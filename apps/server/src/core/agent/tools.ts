/**
 * Herramientas que el modelo puede invocar. Cada una es una función sobre los
 * repositorios: nada de HTTP, nada de canales.
 *
 * El formato es el de "function calling" de OpenAI, que es el que habla
 * OpenRouter para todos los modelos (Claude, GPT, Gemini, Llama…). Los nombres y
 * descripciones están en español porque el modelo conversa en español y eso
 * mejora la elección de herramienta.
 */

import type { Repositories } from '../store/repositories.js';
import type {
  BotSettings,
  Conversation,
  Contact,
  Order,
  PendingReview,
  Product,
  ProductCategory,
} from '../types/domain.js';
import {
  itemsQueTocanLaConsulta,
  normalizarNombre,
  notaDeUsoMensajeRapido,
  validateOrder,
  type OrderDraft,
} from '../policies/rules.js';
import { renderQuickReply } from './persona.js';
import { sinSaludoInicial } from '../policies/writing.js';
import { bus, log } from '../events/bus.js';

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolContext {
  repos: Repositories;
  conversation: Conversation;
  contact: Contact;
  settings: BotSettings;
  /** Efectos que el pipeline aplica después del turno. */
  effects: {
    escalate?: { reason: string; summary: string };
    quickReplyUsed?: string;
    createdOrder?: Order;
    /**
     * Consulta abierta en ESTE turno. La guarda de `crear_pedido` la mira primero,
     * porque el modelo puede pedir la consulta y el pedido en el mismo turno y el
     * modo 'human' recién se escribe cuando el turno terminó.
     */
    pendingReview?: PendingReview;
    /**
     * Fotos que el modelo pidió mandar en este turno. El pipeline las convierte
     * en contenido de imagen después de las burbujas de texto.
     *
     * Van como efecto y no dentro del texto porque una foto NO es un link: el
     * modelo canónico tiene un contenido `image` propio, y cada canal lo manda
     * como corresponde (Telegram con sendPhoto, WhatsApp con image.link). Si
     * mañana aparece un canal sin imágenes, el degradado la convierte en texto
     * solo ahí, sin tocar nada de esto.
     */
    photos?: Array<{ url: string; caption?: string }>;
  };
}

/** Cuántas fotos como mucho por turno: más que esto es spam, no atención. */
const MAX_FOTOS_POR_TURNO = 2;

/*
  Meta solo descarga imágenes por HTTPS público, y falla en silencio con
  cualquier otra cosa: sin esto, una URL http:// o un archivo local se vería bien
  en el panel y no le llegaría nunca al cliente de WhatsApp. Telegram es más
  permisivo, pero se valida igual para que el mismo dato sirva en los dos canales.
*/
const FOTO_VALIDA = /^https:\/\/\S+$/i;

/** Cuánto tiempo el pedido de esta charla sigue siendo "el pedido de esta charla". */
const PEDIDO_ABIERTO_MS = 24 * 60 * 60 * 1000;

const CATEGORIES: ProductCategory[] = [
  'cookies', 'muffins', 'mini-tortas', 'cuadrados', 'alfajores',
  'tabletas', 'saladito', 'tortas', 'desayunos', 'cursos', 'merch',
];

const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): ToolDefinition => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  },
});

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  tool(
    'buscar_catalogo',
    'Busca productos por nombre o por categoría y devuelve precio y disponibilidad de hoy. ' +
      'Usala SIEMPRE antes de decir un precio. Nunca cites precios de memoria.',
    {
      consulta: {
        type: 'string',
        description: 'Texto libre a buscar en el nombre del producto, ej. "kinder", "brownie".',
      },
      categoria: { type: 'string', enum: CATEGORIES, description: 'Filtra por categoría.' },
      incluir_no_disponibles: {
        type: 'boolean',
        description: 'true para ver también lo agotado (útil para saber si existe pero se acabó).',
      },
    },
  ),

  tool(
    'disponibilidad_hoy',
    'Lista todo lo que está disponible hoy, agrupado por categoría, con precios. ' +
      'Usala cuando pregunten "qué cookies hay", "qué minis tenés", "qué hay hoy".',
    { categoria: { type: 'string', enum: CATEGORIES, description: 'Opcional: una sola categoría.' } },
  ),

  tool(
    'mensaje_rapido',
    'Trae uno de los mensajes ya escritos y probados por el equipo (desayunos, datos para tomar ' +
      'un pedido, cómo mandar un Uber cuando quiere algo para ya, cursos, etc.), con los datos ' +
      'actuales ya interpolados. Usalo como base de tu respuesta. Si ya trae saludo, no le ' +
      'agregues otro arriba, y no cambies los datos duros ni los emojis que eligió el equipo. ' +
      'Si el resultado trae `nota_de_uso`, esa nota es para vos: te dice cuándo NO va.',
    {
      clave: {
        type: 'string',
        description: 'Clave del mensaje. Las disponibles te las paso en el contexto del día.',
      },
    },
    ['clave'],
  ),

  tool(
    'crear_pedido',
    'Carga un pedido en el sistema. Solo llamala cuando ya tengas nombre y apellido, teléfono, ' +
      'los productos, y la fecha y hora de retiro o entrega. Queda en estado "borrador" hasta que ' +
      'llegue el comprobante de la transferencia: avisale eso al cliente. ' +
      'Mandá SIEMPRE el pedido COMPLETO (todos los ítems acordados, el principal primero), no el ' +
      'último cambio. Cada producto tiene que llevar precio: el producto_id del catálogo, o ' +
      'a_medida con precio_unitario si no está en el catálogo. Un pedido sin precio se rechaza. ' +
      'Un pedido se carga UNA sola vez por charla: si después el cliente suma algo, volvé a ' +
      'llamarla con TODOS los ítems (los de antes y el nuevo) y sumar_al_pedido_existente en ' +
      'true, y se agregan al pedido que ya existe. Nunca la uses para sacar ni cambiar algo de un pedido ya cargado: eso lo decide ' +
      'una persona del local. Si en este mismo turno consultaste una modificación con ' +
      '`consultar_modificacion`, NO llames esta herramienta: el pedido está en pausa.',
    {
      nombre_apellido: { type: 'string', description: 'Nombre y apellido del cliente.' },
      dni: { type: 'string', description: 'DNI, si lo dio.' },
      telefono: { type: 'string', description: 'Teléfono de contacto.' },
      items: {
        type: 'array',
        description: 'Productos del pedido.',
        items: {
          type: 'object',
          properties: {
            producto_id: {
              type: 'string',
              description:
                'Id del catálogo (lo devuelve buscar_catalogo). Es OBLIGATORIO para todo lo que ' +
                'esté en el catálogo: es lo que hace que se apliquen el precio real y las ' +
                'reglas de envío. Omitilo solo con a_medida en true.',
            },
            descripcion: { type: 'string', description: 'Cómo lo pidió el cliente.' },
            cantidad: { type: 'integer', minimum: 1 },
            precio_unitario: {
              type: 'number',
              description:
                'Precio por unidad, en pesos. Con producto_id no hace falta: sale del catálogo. ' +
                'Para algo a medida es OBLIGATORIO, porque es el único lugar donde queda ' +
                'registrado el precio que acordaste con el cliente.',
            },
            a_medida: {
              type: 'boolean',
              description:
                'true solo si el producto NO está en el catálogo (por ejemplo un SKU de ' +
                'campaña). Entonces precio_unitario es obligatorio.',
            },
            observacion: {
              type: 'string',
              description:
                'Modificación pedida sobre ESTE ítem ("sin jamón"). No cambia el producto ni el ' +
                'precio, y no la decidís vos: va por consultar_modificacion.',
            },
          },
          required: ['descripcion', 'cantidad'],
          additionalProperties: false,
        },
      },
      modalidad: {
        type: 'string',
        enum: ['retira-local', 'uber-cliente', 'cadete-miska'],
        description:
          'Cómo lo recibe. Las tortas y tartas nunca van con cadete-miska. Los desayunos y los ' +
          'boxes de regalo nunca van con uber-cliente: van con cadete-miska (los llevamos ' +
          'nosotros) o retira-local.',
      },
      fecha_retiro: { type: 'string', description: 'AAAA-MM-DD.' },
      hora_retiro: { type: 'string', description: 'Franja horaria libre, ej. "16:00 a 17:00".' },
      direccion: { type: 'string', description: 'Solo si es envío con cadete.' },
      quien_recibe: {
        type: 'string',
        description:
          'Nombre de quien recibe el pedido. Si lo recibe quien compra, repetí su nombre.',
      },
      dedicatoria: { type: 'string', description: 'Para desayunos y regalos.' },
      sumar_al_pedido_existente: {
        type: 'boolean',
        description:
          'true SOLO si estos ítems se SUMAN a lo que ya está cargado en esta charla. Si el ' +
          'cliente quiere reemplazar o sacar algo, no la pongas: eso lo decide una persona.',
      },
      observaciones: { type: 'string', description: 'Ej. "agregar velas", "no quiere foto".' },
    },
    ['nombre_apellido', 'items', 'modalidad'],
  ),

  tool(
    'buscar_cursos',
    'Lista los cursos abiertos, con su precio, sus turnos y cuántos lugares quedan en cada uno. ' +
      'Usala SIEMPRE que pregunten por cursos: los presenciales cambian cada semana, así que no ' +
      'los cites de memoria ni supongas que sigue abierto el de la vez pasada.',
    {},
  ),

  tool(
    'inscribir_a_curso',
    'Anota a una persona en un turno de un curso. Llamala cuando ya te haya dicho a qué curso ' +
      'quiere ir, en qué turno, su nombre y apellido, y un contacto (celular o Instagram). ' +
      'Queda anotada como PENDIENTE: el lugar se reserva recién con el pago total por ' +
      'transferencia, así que después de anotarla pasale el alias y pedile el comprobante. ' +
      'No le digas que ya está inscripta: eso lo confirma el local cuando ve la transferencia.',
    {
      curso_id: { type: 'string', description: 'Id del curso (lo devuelve buscar_cursos).' },
      turno_id: {
        type: 'string',
        description: 'Id del turno elegido. Si el curso tiene un solo turno, igual mandalo.',
      },
      nombre_apellido: { type: 'string', description: 'Nombre y apellido de quien se anota.' },
      contacto: {
        type: 'string',
        description: 'Celular o usuario de Instagram, como lo haya dado.',
      },
    },
    ['curso_id', 'turno_id', 'nombre_apellido'],
  ),

  tool(
    'mandar_foto',
    'Le manda al cliente la foto de un producto del catálogo, como imagen de verdad. ' +
      'Usala cuando quiera VER algo antes de decidir: una torta, un box, o el curso ' +
      'presencial de esta semana. Solo funciona con productos que tienen foto cargada: eso te ' +
      'lo dice el campo tiene_foto de buscar_catalogo y disponibilidad_hoy. Si no tiene foto, ' +
      'no la inventes ni pegues un link: describí el producto con palabras. Mandá una foto por ' +
      'vez, y no más de dos en un mismo turno.',
    {
      producto_id: {
        type: 'string',
        description: 'Id del producto cuya foto querés mandar (lo devuelve buscar_catalogo).',
      },
      curso_id: {
        type: 'string',
        description:
          'Id del curso cuyo flyer querés mandar (lo devuelve buscar_cursos). Mandá este o ' +
          'producto_id, no los dos.',
      },
      texto: {
        type: 'string',
        description:
          'Lo que va escrito junto a la foto, una línea. Opcional: si el mensaje anterior ya ' +
          'lo explicó, dejalo vacío en vez de repetir.',
      },
    },
    [],
  ),

  tool(
    'consultar_modificacion',
    'Usala SIEMPRE que pidan cambiar algo de un producto: sacar o cambiar un ingrediente, ' +
      'cambiar el bizcochuelo, reemplazar algo de un desayuno, otro tamaño, otra presentación. ' +
      'No importa si te parece obvio que se puede o que no se puede: no lo decidís vos. Vale ' +
      'para TODOS los productos y también en fechas especiales. Después de llamarla, contale que ' +
      'lo estás consultando en cocina y NO sigas con el pedido: la herramienta te dice cómo ' +
      'seguir. NO son modificaciones y no van por acá: la cantidad, la fecha, el horario, la ' +
      'modalidad de entrega, la dedicatoria, ni AGREGAR otro producto al pedido — un agregado se ' +
      'suma al principal y se cobra aparte, no lo reemplaza.',
    {
      producto: {
        type: 'string',
        description: 'Producto sobre el que pide el cambio, como lo nombró el cliente.',
      },
      modificacion: {
        type: 'string',
        description: 'Qué cambio pide, en una línea. Ej. "sacarle el queso al sanguchito".',
      },
      texto_cliente: {
        type: 'string',
        description: 'La frase del cliente tal cual, para que la persona no lea todo el chat.',
      },
    },
    ['producto', 'modificacion'],
  ),

  tool(
    'consultar_pedido',
    'Busca pedidos ya cargados: por número, o los de esta conversación si no pasás número. ' +
      'Usala cuando el cliente pregunte por el estado de algo que ya encargó.',
    { numero: { type: 'integer', description: 'Número de pedido, ej. 3069.' } },
  ),

  tool(
    'registrar_nota_cliente',
    'Guarda contexto sobre esta persona para atenderla mejor la próxima vez: la ocasión, para ' +
      'quién es el regalo, que vive en el exterior, preferencias. Usala cada vez que te cuenten ' +
      'algo personal relevante. No guardes detalles de salud: alcanza con "está pasando un ' +
      'momento difícil".',
    {
      nota: { type: 'string', description: 'Una línea, en tus palabras.' },
      nombre_completo: { type: 'string', description: 'Si te dio su nombre y apellido.' },
      telefono: { type: 'string' },
    },
    ['nota'],
  ),

  tool(
    'escalar_a_humano',
    'Pasa la conversación a una persona del local y silencia al bot. Usala para excepciones de ' +
      'pago o precio, reclamos, pedidos corporativos, cuando pidan hablar con alguien, o cuando ' +
      'no sepas algo y no esté en las herramientas. Si lo que piden es CAMBIAR algo de un ' +
      'producto, no uses esta: usá `consultar_modificacion`, que además deja el pedido en pausa. ' +
      'Después de llamarla, avisale al cliente con naturalidad que ya le escribe alguien del local.',
    {
      motivo: {
        type: 'string',
        enum: ['excepcion_pago', 'reclamo', 'pedido_grande', 'pidio_humano', 'no_se', 'otro'],
      },
      resumen: {
        type: 'string',
        description: 'Dos o tres líneas de qué necesita, para que la persona no lea todo el chat.',
      },
    },
    ['motivo', 'resumen'],
  ),
];

// ---------------------------------------------------------------------------
// Ejecutores
// ---------------------------------------------------------------------------

type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

const productView = (p: Product) => ({
  id: p.id,
  nombre: p.name,
  categoria: p.category,
  precio: p.price,
  disponible_hoy: p.availableToday,
  edicion_limitada: p.limitedEdition,
  solo_retiro: p.pickupOnly,
  // Solo si la hay: la URL no le sirve al modelo (no la puede mandar como texto)
  // y ocuparía tokens en cada búsqueda.
  tiene_foto: Boolean(p.imageUrl),
  nota: p.notes ?? undefined,
});

const orderView = (o: Order) => ({
  numero: o.number,
  cliente: o.customerName,
  telefono: o.customerPhone ?? undefined,
  items: o.items.map((i) => ({
    descripcion: i.description,
    cantidad: i.quantity,
    precio: i.unitPrice,
    observacion: i.observation,
  })),
  total: o.total,
  pagado: o.paid,
  estado: o.status,
  modalidad: o.deliveryMode,
  fecha_retiro: o.deliveryDate,
  hora_retiro: o.deliveryTime,
  direccion: o.address ?? undefined,
  quien_recibe: o.recipientName ?? undefined,
  dedicatoria: o.dedication ?? undefined,
  observaciones: o.notes,
});

/** La consulta que está esperando respuesta, o null si ya se contestó o no hay. */
const pendienteDe = (c: Conversation): PendingReview | null =>
  c.pendingReview && !c.pendingReview.resueltoEn ? c.pendingReview : null;

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { repos, settings } = ctx;

  try {
    switch (name) {
      case 'buscar_catalogo': {
        const consulta = typeof input.consulta === 'string' ? input.consulta : '';
        const categoria = input.categoria as ProductCategory | undefined;
        const onlyAvailable = input.incluir_no_disponibles !== true;
        let found: Product[];
        if (consulta) found = await repos.products.search(consulta, onlyAvailable);
        else found = await repos.products.list({ category: categoria, onlyAvailable });
        if (categoria && consulta) found = found.filter((p) => p.category === categoria);
        return { ok: true, data: { productos: found.map(productView), total: found.length } };
      }

      case 'disponibilidad_hoy': {
        const categoria = input.categoria as ProductCategory | undefined;
        const products = await repos.products.list({ category: categoria, onlyAvailable: true });
        const grouped: Record<string, Array<{ nombre: string; precio: number; id: string }>> = {};
        for (const p of products) {
          grouped[p.category] ??= [];
          grouped[p.category].push({ id: p.id, nombre: p.name, precio: p.price });
        }
        return { ok: true, data: { por_categoria: grouped } };
      }

      case 'mensaje_rapido': {
        const clave = String(input.clave ?? '');
        const qr = await repos.quickReplies.get(clave);
        if (!qr) {
          const all = await repos.quickReplies.list();
          return {
            ok: false,
            error: `No existe el mensaje rápido "${clave}". Disponibles: ${all.map((x) => x.key).join(', ')}`,
          };
        }
        /*
          El saludo inicial es para el saludo inicial. Sin esta guarda el modelo lo
          traía en el turno cinco y la charla arrancaba de nuevo, con la
          presentación incluida, que es exactamente lo que hay que sacar.
          `lastOutboundAt` alcanza para saber si la charla ya está empezada.
        */
        if (clave === 'saludo' && ctx.conversation.lastOutboundAt) {
          return {
            ok: false,
            error:
              'Esta charla ya está empezada: no vuelvas a saludar ni a presentarte. Contestá lo ' +
              'que te preguntaron, siguiendo desde donde venían.',
          };
        }

        /*
          "No pedir la transferencia con una consulta abierta" también tiene guarda.
          Mira el CUERPO y no la clave, porque estos textos los edita el equipo
          desde el panel y mañana el alias puede estar en otro mensaje.
        */
        if (pendienteDe(ctx.conversation) && qr.body.includes('{{alias}}')) {
          return {
            ok: false,
            error:
              `"${clave}" pide la transferencia, y hay una consulta sin responder. Ese mensaje ` +
              'va recién cuando contesten de cocina. Por ahora contale que lo estás consultando.',
          };
        }

        const products = await repos.products.list();
        await repos.quickReplies.countUse(clave);
        ctx.effects.quickReplyUsed = clave;
        const renderizado = renderQuickReply(qr.body, settings, products);
        return {
          ok: true,
          data: {
            clave,
            // Si la charla ya empezó, se le saca el saludo con el que arranca.
            // El equipo escribió estos textos para abrir una conversación, y a
            // mitad de charla ese "Holaa!" hace que el bot parezca reiniciarse.
            texto: ctx.conversation.lastOutboundAt ? sinSaludoInicial(renderizado) : renderizado,
            nota_de_uso: notaDeUsoMensajeRapido(clave),
          },
        };
      }

      case 'crear_pedido': {
        /*
          Con una modificación esperando respuesta, el pedido no se carga. La
          guarda va acá y no solo en el prompt porque es lo que costó plata: el
          caso real cerró un pedido de $7.800, con el desayuno perdido y el cambio
          nunca autorizado.

          Se mira PRIMERO el efecto del turno en curso: `consultar_modificacion` y
          `crear_pedido` pueden venir en el mismo turno, y el modo 'human' recién
          se escribe cuando el turno terminó.
        */
        const consulta = ctx.effects.pendingReview ?? pendienteDe(ctx.conversation);

        /*
          Antes era `(input.modalidad as Order['deliveryMode']) ?? 'retira-local'`.
          Dos problemas: un valor fuera del enum ("uber") esquivaba las guardas y
          moría en el CHECK de la base con un error que el modelo no entiende; y
          una modalidad omitida convertía un desayuno para enviar en un "retira en
          el local" que nadie iba a ir a buscar.
        */
        const MODALIDADES: Order['deliveryMode'][] = [
          'retira-local',
          'uber-cliente',
          'cadete-miska',
        ];
        const modalidad = MODALIDADES.find((m) => m === input.modalidad);
        if (!modalidad) {
          return {
            ok: false,
            error:
              'Falta la modalidad, o vino con un valor que no existe. Tiene que ser exactamente ' +
              'retira-local, uber-cliente o cadete-miska. Preguntale al cliente cómo lo recibe ' +
              '(y si es un desayuno o un box de regalo, va con cadete-miska: lo llevamos nosotros).',
          };
        }

        const rawItems = Array.isArray(input.items) ? input.items : [];
        const catalogo = await repos.products.list();
        const productsById = new Map(catalogo.map((p) => [p.id, p]));

        /*
          Índice por nombre además de por id. El modelo manda muy seguido la
          descripción tal cual la dijo el cliente y omite producto_id, y hasta acá
          eso hacía que un producto que SÍ está en el catálogo entrara a precio 0
          sin que nadie se enterara.

          Ahora, además, si el ítem no resuelve a nada del catálogo y no viene
          declarado como a medida, se rechaza: sin producto_id no se aplican el
          precio real, "no enviamos tortas", "hoy no hay" ni la regla de que los
          desayunos los llevamos nosotros. Adivinar es cómo un desayuno se
          convirtió en un sanguchito.
        */
        const productsByName = new Map(catalogo.map((p) => [normalizarNombre(p.name), p]));
        const problemasItems: string[] = [];

        const items = rawItems.map((raw, index) => {
          const item = raw as Record<string, unknown>;
          const declaredId = typeof item.producto_id === 'string' ? item.producto_id : null;
          const description = String(item.descripcion ?? '').trim();
          const nombre = description || `ítem ${index + 1}`;

          if (declaredId && !productsById.has(declaredId)) {
            problemasItems.push(
              `"${nombre}": el producto_id "${declaredId}" no existe en el catálogo. ` +
                'Buscalo con buscar_catalogo y mandá el id que devuelve.',
            );
          }
          const product =
            (declaredId ? productsById.get(declaredId) : undefined) ??
            productsByName.get(normalizarNombre(description));
          if (!product && item.a_medida !== true) {
            problemasItems.push(
              `"${nombre}": no sé qué producto del catálogo es. Buscalo con buscar_catalogo y ` +
                'mandá su producto_id. Si de verdad no está en el catálogo, mandalo con ' +
                'a_medida en true y su precio_unitario.',
            );
          }

          const declaredPrice = Number(item.precio_unitario);
          const cantidad = Math.trunc(Number(item.cantidad ?? 1));
          if (!Number.isFinite(cantidad) || cantidad < 1) {
            problemasItems.push(`"${nombre}": la cantidad tiene que ser un número entero de 1 o más.`);
          }
          const observation =
            typeof item.observacion === 'string' && item.observacion.trim()
              ? item.observacion.trim()
              : undefined;

          return {
            productId: product ? product.id : null,
            description: description || product?.name || 'producto',
            quantity: Number.isFinite(cantidad) && cantidad >= 1 ? cantidad : 1,
            // El catálogo manda: es el precio real y vigente. El declarado por el
            // modelo solo cubre lo que no está en el catálogo (tortas a medida).
            unitPrice: product?.price ?? (Number.isFinite(declaredPrice) ? declaredPrice : 0),
            ...(observation ? { observation } : {}),
          };
        });

        if (problemasItems.length) {
          return {
            ok: false,
            error:
              'No pude cargar el pedido:\n' +
              problemasItems.map((p) => `- ${p}`).join('\n') +
              '\nCorregí eso y reintentá. No inventes precios ni cambies el producto.',
          };
        }

        /*
          La pausa por consulta frena SOLO el producto que se está consultando, no
          la charla entera. Empezó bloqueando todo, y con eso el cliente que dejó
          un desayuno esperando respuesta y quiso comprar una cookie para ese
          momento se encontró con que el bot no podía cargarle nada. Una consulta
          sobre un sanguchito no tiene por qué frenar la venta de una cookie.
        */
        if (consulta) {
          const frenados = itemsQueTocanLaConsulta(consulta.producto, items, productsById);
          if (frenados.length) {
            return {
              ok: false,
              error:
                `Hay una consulta sin responder sobre ${consulta.producto}: ${consulta.pedido}. ` +
                `Hasta que alguien del local la conteste no se puede cargar ` +
                `${frenados.map((i) => i.description).join(', ')}. No confirmes ese producto, no ` +
                'digas que quedó reservado, no pidas la transferencia por él y no vuelvas a ' +
                'llamar esta herramienta en este turno con ese ítem. Si el cliente quiere ' +
                'comprar OTRA cosa, eso sí se puede cargar: llamá de nuevo solo con esos ítems.',
            };
          }
        }

        /*
          Una modificación sobre un ítem NO la autoriza el bot. La descripción del
          campo `observacion` ya lo dice, pero un prompt puede fallar: sin esta
          guarda, "sacale el jamón y sumame una cookie" entraba como un ítem con la
          observación adentro, el local lo producía así y nadie había autorizado
          nada. Solo pasa si el equipo ya contestó una consulta en esta charla.
        */
        const consultaResuelta = ctx.conversation.pendingReview?.resueltoEn
          ? ctx.conversation.pendingReview
          : null;
        const conObservacion = items.filter((i) => i.observation);
        if (conObservacion.length && !consultaResuelta) {
          const primero = conObservacion[0];
          return {
            ok: false,
            error:
              `"${primero.description}" viene con una modificación ("${primero.observation}") que ` +
              'no autorizó nadie. Eso no lo decidís vos: llamá a consultar_modificacion, contale ' +
              'que lo estás consultando y no cargues el pedido.',
          };
        }

        /*
          UN PEDIDO POR CHARLA, Y SOLO PUEDE CRECER.

          El modelo no tiene herramienta para modificar un pedido: `crear_pedido`
          es su único verbo de escritura. Así que cuando el cliente suma, saca o
          cambia algo, lo único que puede hacer es volver a llamar acá, y hasta
          ahora eso insertaba una fila nueva. El desayuno quedaba en un pedido y el
          sanguchito en otro: el local producía uno y cobraba el otro, y en el
          panel aparecían dos.

          La búsqueda va ANTES de validar porque el pedido abierto es la fuente de
          los datos que el modelo no repite. Validar primero hacía que un agregado
          sin la fecha rebotara con "todavía falta el día", y el bot volvía a
          preguntar algo que el cliente ya había dicho.
        */
        const claveItem = (i: { productId: string | null; description: string }) =>
          i.productId ?? normalizarNombre(i.description);

        const sumarPorClave = (lista: Order['items']) => {
          const mapa = new Map<
            string,
            { quantity: number; unitPrice: number; observation: string | null }
          >();
          for (const i of lista) {
            const previo = mapa.get(claveItem(i));
            mapa.set(claveItem(i), {
              quantity: (previo?.quantity ?? 0) + i.quantity,
              unitPrice: i.unitPrice,
              observation: i.observation ?? null,
            });
          }
          return mapa;
        };

        const fusionable = (o: Order) =>
          // Solo un borrador que cargó el bot. Si lo cargó una persona, o ya está
          // confirmado (o sea, pagado), el bot no lo toca.
          o.createdBy === 'bot' &&
          o.status === 'borrador' &&
          Date.now() - Date.parse(o.createdAt) < PEDIDO_ABIERTO_MS;

        const recientes = await repos.orders.list({
          conversationId: ctx.conversation.id,
          limit: 10,
        });
        const abierto = recientes.find(fusionable);

        const fechaDeclarada = typeof input.fecha_retiro === 'string' ? input.fecha_retiro : null;
        const horaDeclarada = typeof input.hora_retiro === 'string' ? input.hora_retiro : null;
        const direccionDeclarada = typeof input.direccion === 'string' ? input.direccion : null;
        const recibeDeclarado = typeof input.quien_recibe === 'string' ? input.quien_recibe : null;

        const draft: OrderDraft = {
          items,
          deliveryMode: modalidad,
          // Lo que el modelo omite se hereda del pedido abierto; lo declarado
          // manda. Los valores declarados se guardan aparte porque son los únicos
          // que sirven para decidir si esto es el mismo pedido o es otro.
          deliveryDate: fechaDeclarada ?? abierto?.deliveryDate ?? null,
          deliveryTime: horaDeclarada ?? abierto?.deliveryTime ?? null,
          customerName: String(input.nombre_apellido ?? '').trim(),
          customerDni: typeof input.dni === 'string' ? input.dni : null,
          customerPhone:
            (typeof input.telefono === 'string' ? input.telefono : null) ?? ctx.contact.phone,
          address: direccionDeclarada ?? abierto?.address ?? null,
          recipientName: recibeDeclarado ?? abierto?.recipientName ?? null,
        };

        const problems = validateOrder(draft, productsById);
        if (problems.length) {
          return {
            ok: false,
            error:
              'No pude cargar el pedido:\n' +
              problems.map((p) => `- ${p.message}`).join('\n') +
              '\nExplicale al cliente con tus palabras y resolvé lo que falta antes de reintentar.',
          };
        }

        /** Cierre común a los dos caminos de escritura. */
        const cerrarPedido = async (): Promise<void> => {
          // Completa la ficha del contacto con lo que acaba de dar.
          await repos.contacts.update(ctx.contact.id, {
            fullName: draft.customerName,
            dni: draft.customerDni ?? undefined,
            phone: draft.customerPhone ?? undefined,
          });
          // La consulta murió con el pedido: si quedó una ya contestada, se limpia
          // para que el contexto del día no siga pidiendo anunciarla.
          if (ctx.conversation.pendingReview) {
            await repos.conversations.clearReview(ctx.conversation.id);
          }
        };

        if (abierto) {
          const previos = sumarPorClave(abierto.items);
          const entrantes = sumarPorClave(items);

          /*
            La fecha y la modalidad son identidad del pedido: otro día u otra forma
            de entrega es otro pedido, y ese lo carga una persona. La modalidad
            además no se puede relajar acá: en la rama de agregado suelto la lista
            fusionada no se vuelve a validar, así que un cambio de modalidad
            metería una torta en nuestro cadete.

            La franja horaria NO es identidad: cambiar el horario no es una
            modificación (lo dice la descripción de consultar_modificacion), así que
            se actualiza en vez de escalar. Se compara normalizado porque es texto
            libre y "16 a 17" no debería pelearse con "16:00 a 17:00".
          */
          const mismaLogistica =
            abierto.deliveryMode === modalidad &&
            (fechaDeclarada ?? abierto.deliveryDate) === abierto.deliveryDate;

          const perdidos = [...previos.keys()].filter((k) => !entrantes.has(k));
          const cambiados = [...previos.entries()].filter(([k, previo]) => {
            const entrante = entrantes.get(k);
            return (
              entrante &&
              // Solo una BAJA la decide una persona. Una SUBA del precio del
              // catálogo entre dos llamadas no es un cambio que pidió el cliente.
              (entrante.quantity < previo.quantity ||
                entrante.unitPrice < previo.unitPrice ||
                entrante.observation !== previo.observation)
            );
          });

          /*
            Ninguno de los ítems de antes vino en la llamada. Puede ser el agregado
            que llega solo ("dale, sumame el sanguchito") o un reemplazo ("en vez
            del desayuno quiero una torta"), y desde acá los dos se ven igual. Por
            eso el modelo tiene que declararlo: sin la bandera, se trata como un
            reemplazo y lo mira una persona.

            Un ítem a medida nunca entra por esta rama: su clave es la prosa que
            redacta el modelo, así que "torta 2 pisos" y "torta dos pisos" se leen
            como dos productos y el pedido se cobraría dos veces.
          */
          const entranteAMedida = items.some((i) => !i.productId);
          const esAgregadoSuelto =
            input.sumar_al_pedido_existente === true &&
            !entranteAMedida &&
            previos.size > 0 &&
            perdidos.length === previos.size;

          if (!mismaLogistica || (!esAgregadoSuelto && (perdidos.length || cambiados.length))) {
            /*
              Escala la guarda, no el prompt. Pedirle al modelo que llame a
              `escalar_a_humano` no alcanza: el mismo archivo le dice que ante un
              error reintente, y con seis rondas puede terminar sin contestarle
              nada al cliente.
            */
            ctx.effects.escalate = {
              reason: 'cambio_de_pedido',
              summary:
                `Quiere cambiar el pedido #${abierto.number} ` +
                `(${abierto.items.map((i) => `${i.quantity}x ${i.description}`).join(', ')}, ` +
                `$${abierto.total}). Pidió: ` +
                `${items.map((i) => `${i.quantity}x ${i.description}`).join(', ')}. ` +
                'No le confirmé ni le rechacé nada.',
            };
            log('info', `Cambio de pedido derivado a una persona (#${abierto.number})`);
            // ok:true a propósito: con ok:false el modelo reintenta, y acá no hay
            // nada que reintentar.
            return {
              ok: true,
              data: {
                ...orderView(abierto),
                pendiente_de_validacion: true,
                instruccion:
                  'No cargues ni modifiques nada y no vuelvas a llamar esta herramienta. ' +
                  'Decile con naturalidad que lo consultás en cocina y que en un rato le ' +
                  'escribe alguien del local. No confirmes ni rechaces el cambio, no le digas ' +
                  'que quedó reservado y no le pidas el pago todavía.',
              },
            };
          }

          /*
            Los datos que las propias reglas dicen que NO son modificaciones
            (dirección, quién recibe, dedicatoria, observaciones, franja) tienen
            que poder actualizarse. El update escribía solo items y total, así que
            un "perdón, la dirección es otra" no se escribía en ninguna parte y el
            cadete salía a la dirección vieja.
          */
          const patch: Partial<Order> = {};
          if (direccionDeclarada && direccionDeclarada !== abierto.address) {
            patch.address = direccionDeclarada;
          }
          if (recibeDeclarado && recibeDeclarado !== abierto.recipientName) {
            patch.recipientName = recibeDeclarado;
          }
          if (
            horaDeclarada &&
            normalizarNombre(horaDeclarada) !== normalizarNombre(abierto.deliveryTime ?? '')
          ) {
            patch.deliveryTime = horaDeclarada;
          }
          const dedicatoria = typeof input.dedicatoria === 'string' ? input.dedicatoria.trim() : '';
          if (dedicatoria && dedicatoria !== abierto.dedication) patch.dedication = dedicatoria;
          const observaciones =
            typeof input.observaciones === 'string' ? input.observaciones.trim() : '';
          if (observaciones && observaciones !== abierto.notes) patch.notes = observaciones;

          const sumados = [...entrantes.entries()].filter(
            ([k, e]) => !previos.has(k) || e.quantity > (previos.get(k)?.quantity ?? 0),
          );

          if (!sumados.length && !Object.keys(patch).length) {
            // Duplicado exacto: el turno anterior ya lo cargó, o murió después de
            // cargarlo y el modelo no tiene rastro de su propia llamada.
            return {
              ok: true,
              data: {
                ...orderView(abierto),
                duplicado: true,
                instruccion:
                  `Este pedido ya estaba cargado como #${abierto.number} con ` +
                  `${abierto.items.map((i) => `${i.quantity}x ${i.description}`).join(', ')}. ` +
                  'Si el cliente pidió OTRA unidad de algo que ya está en el pedido, volvé a ' +
                  'llamarla con la cantidad TOTAL (2, no 1). Si no pidió nada nuevo, seguí la ' +
                  'charla desde donde estaba y no se lo anuncies de nuevo.',
              },
            };
          }

          /*
            El precio que vale es el que se le cotizó al cliente. Si el local subió
            un precio desde el panel entre las dos llamadas, el total no puede
            subir solo: el bot ya le dijo un número.
          */
          const cotizado = new Map(abierto.items.map((i) => [claveItem(i), i.unitPrice]));
          const aPrecioCotizado = (lista: Order['items']) =>
            lista.map((i) => {
              const previo = cotizado.get(claveItem(i));
              return previo !== undefined ? { ...i, unitPrice: previo } : i;
            });

          // Nada perdido y nada bajado: el total solo puede subir.
          const fusionados = esAgregadoSuelto
            ? [...abierto.items, ...items]
            : aPrecioCotizado(items);
          const totalFusionado = fusionados.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

          const actualizado = await repos.orders.update(abierto.id, {
            ...patch,
            items: fusionados,
            total: totalFusionado,
          });
          if (!actualizado) {
            return {
              ok: false,
              error: `No encontré el pedido #${abierto.number} para actualizarlo.`,
            };
          }
          await cerrarPedido();
          ctx.effects.createdOrder = actualizado;
          bus.emit({ type: 'order', order: actualizado });
          log('info', `Pedido ${actualizado.number} actualizado por el bot`, {
            total: totalFusionado,
            items: fusionados.length,
          });
          return {
            ok: true,
            data: {
              ...orderView(actualizado),
              ampliado: sumados.length > 0,
              instruccion: sumados.length
                ? `Se sumó al pedido #${actualizado.number}, que ahora queda en ` +
                  `$${totalFusionado.toLocaleString('es-AR')}. Confirmale el total nuevo. ` +
                  'Sigue en borrador hasta el comprobante.'
                : `Actualicé los datos del pedido #${actualizado.number}. El total no cambió: ` +
                  `$${totalFusionado.toLocaleString('es-AR')}. No se lo anuncies como un pedido ` +
                  'nuevo, confirmale solo lo que cambió.',
            },
          };
        }

        /*
          No hay borrador para ampliar, pero puede haber uno CERRADO (pagado,
          confirmado o vencido). El contexto del día lo sigue listando, y aplicarle
          "mandá TODOS los ítems" es el pedido duplicado entrando por la otra
          puerta: el desayuno se cobraría y se produciría dos veces. Si la llamada
          reenvía todo lo que ese pedido ya tiene, no es un cliente que vuelve a
          encargar lo mismo: es un agregado sobre algo cerrado, y eso lo ve una
          persona.
        */
        const cerrado = recientes.find((o) => o.createdBy === 'bot' && !fusionable(o));
        if (cerrado) {
          const entrantes = sumarPorClave(items);
          const reenviaTodo = [...sumarPorClave(cerrado.items).keys()].every((k) =>
            entrantes.has(k),
          );
          /*
            Con ventana, y no solo por la firma de los ítems: acá hay clientes que
            le compran a la mamá el mismo desayuno todos los meses. Sin el corte,
            ese pedido repetido se leía como un agregado sobre el de la vez pasada
            y terminaba esperando a una persona en vez de cargarse.
          */
          const reciente = Date.now() - Date.parse(cerrado.createdAt) < 48 * 60 * 60 * 1000;
          if (reenviaTodo && reciente) {
            ctx.effects.escalate = {
              reason: 'agregado_sobre_pedido_cerrado',
              summary:
                `Quiere sumar algo al pedido #${cerrado.number}, que ya está ${cerrado.status}. ` +
                `Pidió: ${items.map((i) => `${i.quantity}x ${i.description}`).join(', ')}. ` +
                'No cargué nada.',
            };
            log('info', `Agregado sobre pedido cerrado derivado (#${cerrado.number})`);
            return {
              ok: true,
              data: {
                ...orderView(cerrado),
                pendiente_de_validacion: true,
                instruccion:
                  `El pedido #${cerrado.number} ya está cerrado y no se amplía. No cargues nada ` +
                  'y no vuelvas a llamar esta herramienta. Decile que lo ve una persona del ' +
                  'local, sin confirmarle el agregado y sin pedirle el pago.',
              },
            };
          }
        }

        const total = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
        const order = await repos.orders.create({
          conversationId: ctx.conversation.id,
          contactId: ctx.contact.id,
          customerName: draft.customerName,
          customerDni: draft.customerDni,
          customerPhone: draft.customerPhone,
          items,
          total,
          paid: 0,
          status: 'borrador',
          deliveryMode: draft.deliveryMode,
          deliveryDate: draft.deliveryDate,
          deliveryTime: draft.deliveryTime,
          address: draft.address,
          recipientName: draft.recipientName,
          dedication: typeof input.dedicatoria === 'string' ? input.dedicatoria : null,
          notes: typeof input.observaciones === 'string' ? input.observaciones : null,
          campaignId: null,
          campaignSkuId: null,
          createdBy: 'bot',
        });

        await cerrarPedido();
        ctx.effects.createdOrder = order;
        bus.emit({ type: 'order', order });
        log('info', `Pedido ${order.number} creado por el bot`, { total, items: items.length });

        return {
          ok: true,
          data: {
            ...orderView(order),
            recordatorio:
              'Queda en borrador hasta el comprobante. Pasale el alias ' +
              `${settings.transferAlias} (${settings.transferHolder}) y pedile la captura.`,
          },
        };
      }

      case 'consultar_pedido': {
        if (typeof input.numero === 'number') {
          const order = await repos.orders.byNumber(input.numero);
          return order
            ? { ok: true, data: orderView(order) }
            : { ok: false, error: `No encontré el pedido ${input.numero}.` };
        }
        const own = await repos.orders.list({ conversationId: ctx.conversation.id, limit: 10 });
        const list = own.length
          ? own
          : await repos.orders.list({ contactId: ctx.contact.id, limit: 10 });
        return { ok: true, data: { pedidos: list.map(orderView) } };
      }

      case 'registrar_nota_cliente': {
        const nota = String(input.nota ?? '').trim();
        if (!nota) return { ok: false, error: 'La nota vino vacía.' };
        await repos.contacts.appendNote(ctx.contact.id, nota);
        const patch: Parameters<Repositories['contacts']['update']>[1] = {};
        if (typeof input.nombre_completo === 'string') patch.fullName = input.nombre_completo;
        if (typeof input.telefono === 'string') patch.phone = input.telefono;
        if (Object.keys(patch).length) await repos.contacts.update(ctx.contact.id, patch);
        return { ok: true, data: { guardado: true } };
      }

      case 'buscar_cursos': {
        const cursos = await repos.courses.list({ onlyActive: true });
        return {
          ok: true,
          data: {
            cursos: cursos.map(({ course, sessions }) => ({
              id: course.id,
              nombre: course.name,
              descripcion: course.description ?? undefined,
              precio: course.price,
              modalidad: course.modality,
              donde: course.location ?? undefined,
              tiene_foto: Boolean(course.imageUrl),
              turnos: sessions.map((t) => ({
                id: t.id,
                cuando: t.label,
                lugares_libres: Math.max(0, t.capacity - (t.taken ?? 0)),
                cupos: t.capacity,
              })),
            })),
          },
        };
      }

      case 'inscribir_a_curso': {
        const cursoId = String(input.curso_id ?? '').trim();
        const turnoId = String(input.turno_id ?? '').trim();
        const nombre = String(input.nombre_apellido ?? '').trim();
        const contacto = typeof input.contacto === 'string' ? input.contacto.trim() : '';

        const curso = cursoId ? await repos.courses.get(cursoId) : null;
        if (!curso || !curso.active) {
          return {
            ok: false,
            error:
              `No hay ningún curso abierto con el id "${cursoId}". Mirá cuáles hay con ` +
              'buscar_cursos y usá el id que devuelve.',
          };
        }
        const turno = turnoId ? await repos.courses.session(turnoId) : null;
        if (!turno || turno.courseId !== curso.id) {
          return {
            ok: false,
            error:
              `Ese turno no es de ${curso.name}. Preguntale a cuál quiere ir y usá el id del ` +
              'turno que devuelve buscar_cursos.',
          };
        }
        if (nombre.length < 3) {
          return { ok: false, error: 'Falta el nombre y apellido de quien se anota.' };
        }

        /*
          El cupo se verifica al anotar, no solo en el prompt: vender el lugar
          trece de doce es una conversación imposible de arreglar después. Se
          cuenta acá, contra la base, y no contra lo que el modelo leyó hace tres
          mensajes.
        */
        const libres = turno.capacity - (turno.taken ?? 0);
        if (libres <= 0) {
          return {
            ok: false,
            error:
              `El turno "${turno.label}" de ${curso.name} está completo. Ofrecele otro turno si ` +
              'hay, y si no hay, decile que lo anotás para el próximo y escalá para que el ' +
              'local vea si puede abrir un lugar. No lo anotes igual.',
          };
        }

        const inscripto = await repos.courses.createSignup({
          courseId: curso.id,
          sessionId: turno.id,
          contactId: ctx.contact.id,
          conversationId: ctx.conversation.id,
          fullName: nombre,
          contactInfo: contacto || ctx.contact.phone,
          total: curso.price,
          paid: 0,
          status: 'pendiente',
          notes: null,
          createdBy: 'bot',
        });

        await repos.contacts.update(ctx.contact.id, { fullName: nombre });
        log('info', `Inscripción a curso creada (${curso.name} — ${turno.label})`, nombre);

        return {
          ok: true,
          data: {
            inscripto: nombre,
            curso: curso.name,
            turno: turno.label,
            precio: curso.price,
            lugares_libres_ahora: libres - 1,
            instruccion:
              `Quedó anotada en la planilla, PENDIENTE de pago. Pasale el alias ` +
              `${settings.transferAlias} (${settings.transferHolder}) por el total de ` +
              `${curso.price.toLocaleString('es-AR')} y pedile el comprobante. Avisale que el ` +
              'lugar queda reservado recién con el pago, porque los cupos son limitados, y que ' +
              'por eso no hay devoluciones ni cancelaciones — eso se dice ANTES de que ' +
              'transfiera. NO le digas que ya está inscripta: eso lo confirma el local cuando ' +
              've la transferencia.',
          },
        };
      }

      case 'mandar_foto': {
        const productoId = String(input.producto_id ?? '').trim();
        const cursoId = String(input.curso_id ?? '').trim();
        if (!productoId && !cursoId) {
          return { ok: false, error: 'Decime qué foto mandar: producto_id o curso_id.' };
        }

        const item = cursoId
          ? await repos.courses.get(cursoId)
          : await repos.products.get(productoId);
        if (!item) {
          return {
            ok: false,
            error:
              `No existe "${cursoId || productoId}". Buscalo con ` +
              `${cursoId ? 'buscar_cursos' : 'buscar_catalogo'} y usá el id que devuelve.`,
          };
        }
        const producto = item as { name: string; id: string; imageUrl: string | null };
        if (!producto.imageUrl) {
          return {
            ok: false,
            error:
              `${producto.name} no tiene foto cargada. No inventes una ni le pegues un link: ` +
              'describilo con palabras, que para eso están los datos que sí tenés.',
          };
        }
        if (!FOTO_VALIDA.test(producto.imageUrl)) {
          log('warn', `Foto inválida en ${producto.id}`, producto.imageUrl);
          return {
            ok: false,
            error:
              `La foto de ${producto.name} está mal cargada y no se puede mandar. Seguí sin ` +
              'ella y describí lo que estabas contando con palabras.',
          };
        }

        ctx.effects.photos ??= [];
        if (ctx.effects.photos.length >= MAX_FOTOS_POR_TURNO) {
          return {
            ok: false,
            error:
              'Ya mandaste las fotos de este turno. Seguí con texto, y si hace falta mostrale ' +
              'otra cosa, esperá al próximo mensaje del cliente.',
          };
        }
        const texto = typeof input.texto === 'string' ? input.texto.trim() : '';
        ctx.effects.photos.push({ url: producto.imageUrl, caption: texto || undefined });

        return {
          ok: true,
          data: {
            enviada: producto.name,
            instruccion:
              'La foto sale sola después de lo que escribas: no le pegues el link ni le digas ' +
              '"mirá la imagen de arriba". Seguí la charla normalmente.',
          },
        };
      }

      case 'consultar_modificacion': {
        const producto = String(input.producto ?? '').trim();
        const modificacion = String(input.modificacion ?? '').trim();
        if (!producto || !modificacion) {
          return {
            ok: false,
            error: 'Necesito qué producto y qué cambio pide, una línea cada uno.',
          };
        }

        /*
          Se guarda YA en la base, no como efecto diferido. Si el turno se cae
          después (el modelo se queda sin burbujas, o agota las rondas de
          herramientas), un efecto diferido se pierde justo cuando más importa.
        */
        const review = await repos.conversations.openReview(ctx.conversation.id, {
          producto,
          pedido: modificacion,
          textoCliente:
            typeof input.texto_cliente === 'string' ? input.texto_cliente.trim() || null : null,
        });
        ctx.effects.pendingReview = review;
        ctx.effects.escalate = {
          reason: 'consulta_modificacion',
          summary:
            `${review.pedido} (${producto})` +
            (review.textoCliente ? ` — dijo: "${review.textoCliente}"` : ''),
        };

        /*
          Fecha especial: el dato se le PASA al modelo, no se decide acá. Que en
          estas fechas se produce en serie es verdad y se puede decir, es el motivo
          real. Pero el "no" lo da una persona: el bot ya rechazó por su cuenta el
          cambio de bizcochuelo de una Frutimiska, y eso es lo que hay que arreglar.
        */
        const enCurso = (await repos.campaigns.listActive()).map((c) => c.name);

        /*
          Si el modelo ya cargó un pedido antes en este mismo turno, no se puede
          deshacer: al menos queda avisado en el pedido, que es donde lo va a ver
          el equipo.
        */
        const yaCargado = ctx.effects.createdOrder;
        if (yaCargado) {
          const actualizado = await repos.orders.update(yaCargado.id, {
            notes:
              `${yaCargado.notes ? `${yaCargado.notes}\n` : ''}` +
              `OJO: consulta sin responder — ${modificacion} (${producto})`,
          });
          // Sin este emit el panel muestra el pedido sin el aviso hasta recargar.
          if (actualizado) bus.emit({ type: 'order', order: actualizado });
        }

        log('info', `Consulta de modificación abierta (${ctx.conversation.id})`, review.pedido);

        return {
          ok: true,
          data: {
            resultado: 'en_consulta',
            pedido_ya_cargado: yaCargado?.number,
            instruccion:
              'Quedó la consulta para cocina. Contale con naturalidad que lo estás ' +
              'consultando y que en un rato le confirman. NO confirmes el cambio, NO lo ' +
              'rechaces, NO digas que quedó reservado, NO pidas la transferencia y NO cargues ' +
              'el pedido: eso se retoma cuando una persona conteste. Y no agregues preguntas ' +
              'que no te hicieron.' +
              (enCurso.length
                ? ` Estamos en plena ${enCurso.join(' y ')}: podés aclararle que en estas fechas ` +
                  'se produce todo en serie para que salga a tiempo, así que es muy probable que ' +
                  'no se pueda. Aclararlo sí; cerrarlo vos, no.'
                : ''),
          },
        };
      }

      case 'escalar_a_humano': {
        ctx.effects.escalate = {
          reason: String(input.motivo ?? 'otro'),
          summary: String(input.resumen ?? '').trim(),
        };
        return {
          ok: true,
          data: {
            escalado: true,
            instruccion:
              'Ya avisé al local. Cerrá el turno diciéndole con naturalidad que en un rato le ' +
              'escribe alguien del equipo. No prometas un tiempo exacto.',
          },
        };
      }

      default:
        return { ok: false, error: `Herramienta desconocida: ${name}` };
    }
  } catch (err) {
    log('error', `Error ejecutando la herramienta ${name}`, err);
    return { ok: false, error: `Falló la herramienta: ${(err as Error).message}` };
  }
}
