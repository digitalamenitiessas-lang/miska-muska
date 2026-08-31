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
  /**
   * true si una persona la contestó ESCRIBIÉNDOLE al cliente en el chat, en vez
   * de usar el botón del panel. Cambia lo que tiene que hacer el bot: la
   * respuesta ya la recibió el cliente, así que no se repite.
   */
  respondidaEnElChat?: boolean;
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

/**
 * Las categorías con las que arrancó el catálogo. Siguen escritas una por una
 * porque hay código que las nombra: la regla de envío propio mira 'desayunos', y
 * las variables de los mensajes rápidos miran 'cookies' y 'mini-tortas'.
 *
 * El gemelo en tiempo de ejecución está en `policies/rules.ts`
 * (`CATEGORIAS_DE_FABRICA`): esto es un tipo y no existe después de compilar.
 */
export type CategoriaDeFabrica =
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

/**
 * Categoría del catálogo. Texto libre, NO una lista cerrada.
 *
 * Era cerrada, y eso significaba que una categoría nueva —"panes", "tartas
 * saladas", lo que el local decida empezar a vender— pedía tocar el código y
 * volver a desplegar. Ahora se crea desde el panel, al cargar el primer producto
 * que la usa: la columna en la base siempre fue `text`, así que lo único que
 * sobraba era el candado.
 *
 * `(string & {})` y no `string` pelado para no perder el autocompletado ni el
 * chequeo de tipeo sobre las de fábrica.
 */
export type ProductCategory = CategoriaDeFabrica | (string & {});

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
  /**
   * Foto del producto, como URL pública HTTPS. El bot la manda cuando el cliente
   * quiere ver algo antes de comprarlo, y es lo que hace falta para los cursos
   * presenciales, que cambian cada semana.
   *
   * URL y no archivo: Telegram y WhatsApp descargan el link ellos mismos, así que
   * lo mismo sirve en los dos y no hay que resubir nada al cambiar de canal.
   */
  imageUrl: string | null;
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
  /**
   * Quién autorizó esa modificación y con qué palabras.
   *
   * La observación sola dice "sin jamón" y no dice si alguien lo aprobó. La
   * consulta que sí lo dice vive en `conversations.pending_review` y se BORRA
   * apenas el bot le transmite la respuesta al cliente, o sea días antes de que
   * el pedido se produzca. Copiarla acá es lo único que hace que en la mesa de
   * producción se pueda saber que el cambio se aprobó, cuándo, y qué se contestó.
   *
   * Vive en la columna `items` (jsonb), como `observation`: sin migración.
   */
  authorization?: { pedido: string; respuesta: string; en: string };
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
  /**
   * Horario del local tal cual se lo cuenta al cliente. Es texto libre porque el
   * horario real no entra en dos números: es partido, cambia los domingos, y
   * entre las 13 y las 16 atienden por el carrito de adelante.
   */
  scheduleText: string;
  /**
   * Franja gruesa, solo para decidir si el local está cerrado y no prometer
   * entregas inmediatas. No es lo que el bot cita: para eso está `scheduleText`.
   */
  openHour: number;
  closeHour: number;
  /** Datos que el bot cita textualmente. */
  address: string;
  transferAlias: string;
  transferHolder: string;
  /**
   * El alias de los CURSOS, que no es el mismo que el de los pedidos.
   *
   * Son dos cuentas distintas y la plata de los cursos va a la suya. Mandar el
   * alias de pedidos para una inscripción es un cobro en la cuenta equivocada,
   * que después alguien tiene que ir a buscar a mano.
   *
   * Si queda vacío, el bot usa el de pedidos: es preferible cobrar en la cuenta
   * de al lado que quedarse sin alias en medio de una inscripción.
   */
  transferAliasCursos: string;
  transferHolderCursos: string;
  webUrl: string;
  coursesUrl: string;
  breakfastsUrl: string;
  /**
   * La carta de pastelería, como imagen. Es lo que el local venía mandando a
   * mano por WhatsApp cuando le piden "la carta", y es lo que la clienta espera.
   *
   * Ojo con lo que es: una SEGUNDA fuente de precios, en un archivo que no se
   * actualiza solo. El catálogo del panel es el que cobra; esta foto es la que
   * el cliente lee. Si se separan, gana la foto — porque es lo que él vio. Por
   * eso se guarda cuándo se subió: el panel avisa si alguien tocó un precio
   * después, que es exactamente cómo se desincronizan.
   */
  cartaUrl: string;
  /** ISO 8601 de cuándo se subió la carta, para detectar que quedó vieja. */
  cartaSubidaEn: string;
  /**
   * Lo que el local sabe y el bot no puede deducir de ninguna tabla.
   *
   * Es texto libre y va tal cual al prompt. Existe porque la mitad de las
   * correcciones que llegan no son un bug ni un precio: son un dato que el bot
   * no tenía (de qué es el bizcochuelo de la Matilda, qué cafés hay, que no
   * vendemos porciones). Ninguna de esas cosas entra en el catálogo —no se
   * venden por mensaje, o son una descripción y no un SKU— y todas se contestan
   * mal si no están escritas en algún lado.
   *
   * Deliberadamente NO es una tabla con campos: si hubiera que agregar una
   * columna cada vez que el local quiere que el bot sepa algo, el bot iba a
   * saber solo lo que un programador tuvo tiempo de modelar. Acá lo escriben
   * ellos, en Ajustes, y está en el próximo mensaje.
   *
   * Lo que NO va acá: precios, disponibilidad y stock. Eso vive en el catálogo,
   * que es lo que cobra. Un precio escrito acá es una segunda fuente de verdad
   * que nadie actualiza, así que el prompt lo dice y el panel también.
   */
  conocimiento: string;
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

// ---------------------------------------------------------------------------
// Cursos
// ---------------------------------------------------------------------------

/**
 * Los cursos viven aparte del catálogo. Un producto es algo que se vende N
 * veces; un curso es una fecha con doce lugares, y el mismo curso puede darse
 * el viernes o el sábado. Eso son los turnos.
 */
export interface Course {
  id: string;
  name: string;
  description: string | null;
  price: number;
  /** Dónde se da: "Barrio Norte", o vacío si es online. */
  location: string | null;
  modality: 'presencial' | 'online';
  /** El flyer del curso, como URL pública. El bot lo manda como imagen. */
  imageUrl: string | null;
  /** Apagado: el bot no lo ofrece. Es el interruptor de la carta, para cursos. */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Un turno del curso, con sus cupos. */
export interface CourseSession {
  id: string;
  courseId: string;
  /** Como lo dice el equipo: "viernes 11/9, 17 hs". Es lo que ve el cliente. */
  label: string;
  capacity: number;
  sortOrder: number;
  /** Inscriptos que no cancelaron. Lo calcula el repositorio, no está en la tabla. */
  taken?: number;
}

export type SignupStatus = 'pendiente' | 'inscripto' | 'cancelado';

/** Una fila de la planilla de inscriptos. Es el ticket del curso. */
export interface CourseSignup {
  id: string;
  courseId: string;
  sessionId: string | null;
  contactId: string | null;
  conversationId: string | null;
  fullName: string;
  /**
   * De dónde salió la inscripción. Las del bot lo traen solo, con el canal y el
   * número o usuario ("WhatsApp · 5493815…"); las que se anotan a mano lo
   * escribe el equipo ("Instagram @…", "mostrador").
   */
  contactInfo: string | null;
  total: number;
  paid: number;
  status: SignupStatus;
  notes: string | null;
  createdBy: MessageAuthor;
  createdAt: string;
  updatedAt: string;
}
