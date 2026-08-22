/** Entidades de negocio de Miska Muska. Independientes del canal y del LLM. */

import type { ChannelId, MessageAuthor } from './message.js';

export type ConversationMode =
  /** El bot responde automáticamente. */
  | 'bot'
  /** Una persona del local tomó la conversación; el bot calla. */
  | 'human'
  /** Silenciada: no se responde ni se notifica. */
  | 'muted';

export interface Contact {
  id: string;
  channel: ChannelId;
  externalId: string;
  displayName: string | null;
  username: string | null;
  phone: string | null;
  /** Nombre y apellido reales, cargados al tomar un pedido. */
  fullName: string | null;
  dni: string | null;
  /** Notas del CRM: ocasión del regalo, destinatario, preferencias. */
  notes: string | null;
  /** true para clientes históricos (habilita excepciones de pago). */
  isReturning: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

/**
 * Modificación de producto que tiene que contestar una persona del local.
 * Mientras `resueltoEn` es null el bot no cierra el pedido: la guarda vive en
 * `crear_pedido`, no solo en el prompt.
 *
 * No hay un enum 'aprobada' | 'rechazada' a propósito. El bot no traduce un
 * booleano a prosa: repite lo que dijo el equipo. Un "NO SE PUEDE" pelado lo
 * obligaría a inventar el motivo, que es justo lo que no queremos.
 */
export interface PendingReview {
  id: string;
  /** Producto sobre el que pide el cambio, como lo nombró el cliente. */
  producto: string;
  /** Qué cambio pide, en una línea. Si pide dos cosas, se acumulan acá. */
  pedido: string;
  /** La frase del cliente, tal cual, para que la persona no lea todo el chat. */
  textoCliente: string | null;
  abiertoEn: string;
  /** null = sigue esperando respuesta. Es el único indicador de "en pausa". */
  resueltoEn: string | null;
  /** Lo que contestó el equipo, con sus palabras. No es null si hay `resueltoEn`. */
  respuesta: string | null;
}

export interface Conversation {
  id: string;
  channel: ChannelId;
  externalId: string;
  contactId: string;
  mode: ConversationMode;
  /** Último intent detectado, para filtrar en el panel. */
  lastIntent: string | null;
  /** ISO del último mensaje entrante. Base de la ventana de 24 h de WhatsApp. */
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  /** Marcada por el bot al escalar, o por un operador. */
  needsAttention: boolean;
  attentionReason: string | null;
  /** Consulta de modificación abierta o recién contestada. null si no hay. */
  pendingReview: PendingReview | null;
  createdAt: string;
  updatedAt: string;
}

export type MessageDirection = 'in' | 'out';

export interface StoredMessage {
  id: string;
  conversationId: string;
  channel: ChannelId;
  channelMessageId: string | null;
  direction: MessageDirection;
  author: MessageAuthor;
  /** Kind del contenido canónico ('text', 'image', 'buttons', …). */
  contentKind: string;
  /** Representación en texto, para el panel y para el historial del prompt. */
  text: string;
  /**
   * Contenido canónico completo (`InboundContent` u `OutboundContent`).
   * Se guarda en una columna jsonb, así que llega ya parseado: no hay que
   * hacerle JSON.parse.
   */
  payload: unknown;
  intent: string | null;
  handler: string | null;
  /** Métricas del turno del LLM, cuando aplica. */
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  /** Costo real en dólares que informa OpenRouter para esa llamada. */
  costUsd: number | null;
  /** Modelo que efectivamente atendió el turno (OpenRouter puede rutear). */
  model: string | null;
  error: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export type ProductCategory =
  | 'cookies'
  | 'muffins'
  | 'mini-tortas'
  | 'cuadrados'
  | 'alfajores'
  | 'tabletas'
  | 'saladito'
  | 'tortas'
  | 'desayunos'
  | 'cursos'
  | 'merch';

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  /** Precio en pesos argentinos, sin decimales. */
  price: number;
  /** Disponible hoy. El bot solo ofrece lo que está en true. */
  availableToday: boolean;
  /** Producto de edición limitada: el bot debe invitar a consultar sabores. */
  limitedEdition: boolean;
  /** true si NO se puede enviar a domicilio (tortas: solo retiro o Uber). */
  pickupOnly: boolean;
  notes: string | null;
  /** Orden de aparición dentro de la categoría. */
  sortOrder: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

export type OrderStatus =
  /** El bot juntó los datos pero falta el comprobante. */
  | 'borrador'
  /** Comprobante recibido y validado por el local. */
  | 'confirmado'
  | 'en-preparacion'
  | 'listo'
  | 'entregado'
  | 'cancelado';

export type DeliveryMode = 'retira-local' | 'uber-cliente' | 'cadete-miska';

export interface OrderItem {
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  /**
   * Modificación pedida sobre este ítem ("sin jamón"). Es transporte al panel:
   * quien decide si se puede es una persona, y hasta que contesta el pedido no se
   * cierra. Vive en la columna `items` (jsonb), así que no necesita migración.
   */
  observation?: string;
}

export interface Order {
  id: string;
  /** Número correlativo visible para el cliente (como el "Pedido 3069"). */
  number: number;
  conversationId: string | null;
  contactId: string | null;
  customerName: string;
  customerDni: string | null;
  customerPhone: string | null;
  items: OrderItem[];
  total: number;
  /** Monto ya transferido. */
  paid: number;
  status: OrderStatus;
  deliveryMode: DeliveryMode;
  /** Fecha de retiro/entrega en formato YYYY-MM-DD. */
  deliveryDate: string | null;
  /** Franja horaria libre, ej. "16:00 a 17:00". */
  deliveryTime: string | null;
  /** Dirección, solo para envíos. */
  address: string | null;
  /** Quién recibe, cuando no es quien compra (desayuno sorpresa). */
  recipientName: string | null;
  /** Dedicatoria para desayunos y regalos. */
  dedication: string | null;
  /** Observaciones ("agregar velas", "no quiere foto"). */
  notes: string | null;
  /** Campaña a la que pertenece, si es un pedido de fecha especial. */
  campaignId: string | null;
  /** SKU de campaña cuyo stock se reservó para este pedido. */
  campaignSkuId: string | null;
  createdBy: MessageAuthor;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Campañas de fechas especiales (Día de la Madre, Navidad, …)
// ---------------------------------------------------------------------------

export interface CampaignSku {
  id: string;
  campaignId: string;
  name: string;
  price: number;
  /** Stock total producido. */
  stockTotal: number;
  /** Unidades ya comprometidas en pedidos. */
  stockUsed: number;
  sortOrder: number;
}

export interface Campaign {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  startsOn: string;
  endsOn: string;
  active: boolean;
  /** Mensaje que el bot usa para presentar la campaña. */
  pitch: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Mensajes rápidos (los canned messages que ya usa el equipo en WhatsApp)
// ---------------------------------------------------------------------------

export interface QuickReply {
  key: string;
  label: string;
  body: string;
  /** Palabras/frases que disparan sugerencia automática. */
  triggers: string[];
  /** Si true, el router puede responder con esto sin pasar por el LLM. */
  autoSend: boolean;
  usageCount: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Configuración operativa
// ---------------------------------------------------------------------------

export interface BotSettings {
  /** Interruptor general: si está en false, el bot no responde nada. */
  botEnabled: boolean;
  /** Nombre con el que se presenta el bot. */
  agentName: string;
  activeChannels: ChannelId[];
  /** Slug de modelo de OpenRouter, ej. `anthropic/claude-sonnet-5`. */
  model: string;
  /** minimal | low | medium | high | xhigh | max (parámetro `reasoning.effort`). */
  effort: string;
  /** Escalar a humano automáticamente si el LLM falla N veces seguidas. */
  escalateAfterErrors: number;
  /** Retardo simulado de tipeo, en ms por carácter (humaniza la respuesta). */
  typingMsPerChar: number;
  maxTypingMs: number;
  /** Horario del local, para avisar demoras fuera de hora. */
  openHour: number;
  closeHour: number;
  /** Datos que el bot cita textualmente. */
  address: string;
  transferAlias: string;
  transferHolder: string;
  webUrl: string;
  coursesUrl: string;
  breakfastsUrl: string;
}

export interface MetricPoint {
  day: string;
  inbound: number;
  outbound: number;
  conversations: number;
  handoffs: number;
  orders: number;
  inputTokens: number;
  outputTokens: number;
  /** Gasto real del día en dólares, según OpenRouter. */
  costUsd: number;
}
