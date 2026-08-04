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
import type { BotSettings, Conversation, Contact, Order, Product, ProductCategory } from '../types/domain.js';
import { validateOrder, type OrderDraft } from '../policies/rules.js';
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
  };
}

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
      'un pedido, instrucciones del Uber, cursos, etc.), con los datos actuales ya interpolados. ' +
      'Usalo como base de tu respuesta: podés agregar una línea empática arriba, pero no cambies ' +
      'los datos duros.',
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
      'Cada producto tiene que llevar precio: el producto_id del catálogo, o precio_unitario si ' +
      'es a medida. Un pedido sin precio se rechaza.',
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
              description: 'Id del catálogo (lo devuelve buscar_catalogo). Omitilo si es a medida.',
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
          },
          required: ['descripcion', 'cantidad'],
          additionalProperties: false,
        },
      },
      modalidad: {
        type: 'string',
        enum: ['retira-local', 'uber-cliente', 'cadete-miska'],
        description: 'Cómo lo recibe. Las tortas nunca van con cadete.',
      },
      fecha_retiro: { type: 'string', description: 'AAAA-MM-DD.' },
      hora_retiro: { type: 'string', description: 'Franja horaria libre, ej. "16:00 a 17:00".' },
      direccion: { type: 'string', description: 'Solo si es envío con cadete.' },
      dedicatoria: { type: 'string', description: 'Para desayunos y regalos.' },
      observaciones: { type: 'string', description: 'Ej. "agregar velas", "no quiere foto".' },
    },
    ['nombre_apellido', 'items', 'modalidad'],
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
      'no sepas algo y no esté en las herramientas. Después de llamarla, avisale al cliente con ' +
      'naturalidad que ya le escribe alguien del local.',
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
  items: o.items.map((i) => ({ descripcion: i.description, cantidad: i.quantity, precio: i.unitPrice })),
  total: o.total,
  pagado: o.paid,
  estado: o.status,
  modalidad: o.deliveryMode,
  fecha_retiro: o.deliveryDate,
  hora_retiro: o.deliveryTime,
  observaciones: o.notes,
});

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
        const products = await repos.products.list();
        await repos.quickReplies.countUse(clave);
        ctx.effects.quickReplyUsed = clave;
        return { ok: true, data: { clave, texto: renderQuickReply(qr.body, settings, products) } };
      }

      case 'crear_pedido': {
        const rawItems = Array.isArray(input.items) ? input.items : [];
        const catalogo = await repos.products.list();
        const productsById = new Map(catalogo.map((p) => [p.id, p]));

        /*
          Índice por nombre además de por id. El modelo manda muy seguido la
          descripción tal cual la dijo el cliente y omite producto_id —
          producto_id es opcional—, y hasta acá eso hacía que un producto que SÍ
          está en el catálogo entrara a precio 0 sin que nadie se enterara.
        */
        const normalizar = (s: string) =>
          s
            .toLowerCase()
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
        const productsByName = new Map(catalogo.map((p) => [normalizar(p.name), p]));

        const items = rawItems.map((raw) => {
          const item = raw as Record<string, unknown>;
          const declaredId = typeof item.producto_id === 'string' ? item.producto_id : null;
          const description = String(item.descripcion ?? '').trim();
          const product =
            (declaredId ? productsById.get(declaredId) : undefined) ??
            productsByName.get(normalizar(description));
          const declaredPrice = Number(item.precio_unitario);
          return {
            productId: product ? product.id : null,
            description: description || product?.name || 'producto',
            quantity: Math.max(1, Number(item.cantidad ?? 1)),
            // El catálogo manda: es el precio real y vigente. El declarado por el
            // modelo solo cubre lo que no está en el catálogo (tortas a medida).
            unitPrice: product?.price ?? (Number.isFinite(declaredPrice) ? declaredPrice : 0),
          };
        });

        const draft: OrderDraft = {
          items,
          deliveryMode: (input.modalidad as Order['deliveryMode']) ?? 'retira-local',
          deliveryDate: typeof input.fecha_retiro === 'string' ? input.fecha_retiro : null,
          customerName: String(input.nombre_apellido ?? '').trim(),
          customerDni: typeof input.dni === 'string' ? input.dni : null,
          customerPhone:
            (typeof input.telefono === 'string' ? input.telefono : null) ?? ctx.contact.phone,
          address: typeof input.direccion === 'string' ? input.direccion : null,
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
          deliveryTime: typeof input.hora_retiro === 'string' ? input.hora_retiro : null,
          address: draft.address,
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
