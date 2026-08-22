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
  normalizarNombre,
  notaDeUsoMensajeRapido,
  validateOrder,
  type OrderDraft,
} from '../policies/rules.js';
import { renderQuickReply } from './persona.js';
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
  };
}

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
      'llamarla con TODOS los ítems (los de antes y el nuevo) y se agregan al pedido que ya ' +
      'existe. Nunca la uses para sacar ni cambiar algo de un pedido ya cargado: eso lo decide ' +
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
        description: 'Nombre de quien recibe, cuando no es quien compra (desayuno sorpresa).',
      },
      dedicatoria: { type: 'string', description: 'Para desayunos y regalos.' },
      observaciones: { type: 'string', description: 'Ej. "agregar velas", "no quiere foto".' },
    },
    ['nombre_apellido', 'items', 'modalidad'],
  ),

  tool(
    'consultar_modificacion',
    'Usala SIEMPRE que pidan cambiar algo de un producto: sacar o cambiar un ingrediente, ' +
      'cambiar el bizcochuelo, reemplazar algo de un desayuno, otro tamaño, otra presentación. ' +
      'No importa si te parece obvio que se puede o que no se puede: no lo decidís vos. Vale ' +
      'para TODOS los productos y también en fechas especiales. Después de llamarla, contale que ' +
      'lo estás consultando con el equipo y NO sigas con el pedido: la herramienta te dice cómo ' +
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
              'va recién cuando el equipo conteste. Por ahora contale que lo estás consultando.',
          };
        }

        const products = await repos.products.list();
        await repos.quickReplies.countUse(clave);
        ctx.effects.quickReplyUsed = clave;
        return {
          ok: true,
          data: {
            clave,
            texto: renderQuickReply(qr.body, settings, products),
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
        if (consulta) {
          return {
            ok: false,
            error:
              `Hay una consulta sin responder: ${consulta.pedido} (${consulta.producto}). ` +
              'Hasta que alguien del local la conteste, el pedido no se carga. No confirmes el ' +
              'producto, no digas que quedó reservado, no pidas la transferencia y no vuelvas a ' +
              'llamar esta herramienta en este turno. Cerrá diciéndole que lo estás consultando ' +
              'y que en un rato le confirman, sin repetir lo que ya le dijiste.',
          };
        }

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

        const horaRetiro = typeof input.hora_retiro === 'string' ? input.hora_retiro : null;
        const draft: OrderDraft = {
          items,
          deliveryMode: modalidad,
          deliveryDate: typeof input.fecha_retiro === 'string' ? input.fecha_retiro : null,
          deliveryTime: horaRetiro,
          customerName: String(input.nombre_apellido ?? '').trim(),
          customerDni: typeof input.dni === 'string' ? input.dni : null,
          customerPhone:
            (typeof input.telefono === 'string' ? input.telefono : null) ?? ctx.contact.phone,
          address: typeof input.direccion === 'string' ? input.direccion : null,
          recipientName: typeof input.quien_recibe === 'string' ? input.quien_recibe : null,
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

        /*
          UN PEDIDO POR CHARLA, Y SOLO PUEDE CRECER.

          El modelo no tiene herramienta para modificar un pedido: `crear_pedido`
          es su único verbo de escritura. Así que cuando el cliente suma, saca o
          cambia algo, lo único que puede hacer es volver a llamar acá, y hasta
          ahora eso insertaba una fila nueva. El desayuno quedaba en un pedido y el
          sanguchito en otro: el local producía uno y cobraba el otro, y en el
          panel aparecían dos.

          Cuatro caminos, y ninguno puede perder plata:
            - mismos ítems                 -> no se escribe nada (era un duplicado)
            - mismos ítems + algo          -> se suma al pedido que ya existe
            - ítems nuevos, ninguno de los de antes -> se AGREGAN a los de antes
              (es el caso del agregado que llega solo: el desayuno no se pierde)
            - falta o cambió algo de lo que había -> no se escribe y decide una persona
        */
        const claveItem = (i: { productId: string | null; description: string }) =>
          i.productId ?? normalizarNombre(i.description);

        const sumarPorClave = (lista: Order['items']) => {
          const mapa = new Map<string, { quantity: number; unitPrice: number }>();
          for (const i of lista) {
            const previo = mapa.get(claveItem(i));
            mapa.set(claveItem(i), {
              quantity: (previo?.quantity ?? 0) + i.quantity,
              unitPrice: i.unitPrice,
            });
          }
          return mapa;
        };

        const recientes = await repos.orders.list({
          conversationId: ctx.conversation.id,
          limit: 5,
        });
        const abierto = recientes.find(
          (o) =>
            // Solo un borrador que cargó el bot. Si lo cargó una persona, o ya
            // está confirmado (o sea, pagado), el bot no lo toca.
            o.createdBy === 'bot' &&
            o.status === 'borrador' &&
            Date.now() - Date.parse(o.createdAt) < PEDIDO_ABIERTO_MS,
        );

        if (abierto) {
          const previos = sumarPorClave(abierto.items);
          const entrantes = sumarPorClave(items);

          // Un pedido para otra fecha, otro horario u otra modalidad no es este
          // pedido: es otro, y otro lo carga una persona desde el panel. Lo que el
          // modelo omite se hereda; lo que declara distinto, no.
          const mismaLogistica =
            abierto.deliveryMode === draft.deliveryMode &&
            (draft.deliveryDate ?? abierto.deliveryDate) === abierto.deliveryDate &&
            (horaRetiro ?? abierto.deliveryTime) === abierto.deliveryTime;

          const perdidos = [...previos.keys()].filter((k) => !entrantes.has(k));
          const cambiados = [...previos.entries()].filter(([k, previo]) => {
            const entrante = entrantes.get(k);
            return (
              entrante &&
              (entrante.quantity < previo.quantity || entrante.unitPrice !== previo.unitPrice)
            );
          });

          /*
            Ninguno de los ítems de antes vino en la llamada: es el agregado que
            llega solo ("dale, sumame el sanguchito"), no un reemplazo. Se suman
            los dos y se le confirma el total nuevo, que es lo que pidió la dueña.
            Si en realidad quería reemplazar, va a decirlo cuando vea el total, y
            ese sí es un cambio que decide una persona.
          */
          const esAgregadoSuelto = previos.size > 0 && perdidos.length === previos.size;
          const fusionados = esAgregadoSuelto ? [...abierto.items, ...items] : items;

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
                  'Decile con naturalidad que lo consultás con el equipo y que en un rato le ' +
                  'escribe alguien del local. No confirmes ni rechaces el cambio, no le digas ' +
                  'que quedó reservado y no le pidas el pago todavía.',
              },
            };
          }

          const sumados = [...entrantes.entries()].filter(
            ([k, e]) => !previos.has(k) || e.quantity > (previos.get(k)?.quantity ?? 0),
          );

          if (!sumados.length) {
            // Duplicado exacto: el turno anterior ya lo cargó, o murió después de
            // cargarlo y el modelo no tiene rastro de su propia llamada.
            return {
              ok: true,
              data: {
                ...orderView(abierto),
                duplicado: true,
                instruccion:
                  `Este pedido ya estaba cargado como #${abierto.number}. No lo vuelvas a ` +
                  'cargar ni se lo anuncies de nuevo: seguí la charla desde donde estaba.',
              },
            };
          }

          // Nada perdido y nada bajado: el total solo puede subir.
          const totalFusionado = fusionados.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
          const actualizado = await repos.orders.update(abierto.id, {
            items: fusionados,
            total: totalFusionado,
          });
          if (!actualizado) {
            return {
              ok: false,
              error: `No encontré el pedido #${abierto.number} para actualizarlo.`,
            };
          }
          ctx.effects.createdOrder = actualizado;
          bus.emit({ type: 'order', order: actualizado });
          log('info', `Pedido ${actualizado.number} ampliado por el bot`, {
            total: totalFusionado,
            items: fusionados.length,
          });
          return {
            ok: true,
            data: {
              ...orderView(actualizado),
              ampliado: true,
              instruccion:
                `Se sumó al pedido #${actualizado.number}, que ahora queda en ` +
                `$${totalFusionado.toLocaleString('es-AR')}. Confirmale el total nuevo. ` +
                'Sigue en borrador hasta el comprobante.',
            },
          };
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

        // Completa la ficha del contacto con lo que acaba de dar.
        await repos.contacts.update(ctx.contact.id, {
          fullName: draft.customerName,
          dni: draft.customerDni ?? undefined,
          phone: draft.customerPhone ?? undefined,
        });

        ctx.effects.createdOrder = order;
        // La consulta murió con el pedido: si quedó una ya contestada, se limpia
        // para que no siga apareciendo en el contexto la semana que viene.
        if (ctx.conversation.pendingReview) {
          await repos.conversations.clearReview(ctx.conversation.id);
        }
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
              'Quedó la consulta para el equipo. Contale con naturalidad que lo estás ' +
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
