/** Cliente HTTP del panel + tipos espejo del servidor. */

export type ChannelId = 'telegram' | 'whatsapp';
export type ConversationMode = 'bot' | 'human' | 'muted';
export type OrderStatus =
  | 'borrador' | 'confirmado' | 'en-preparacion' | 'listo' | 'entregado' | 'cancelado';

export interface Contact {
  id: string;
  channel: ChannelId;
  externalId: string;
  displayName: string | null;
  username: string | null;
  phone: string | null;
  fullName: string | null;
  dni: string | null;
  notes: string | null;
  isReturning: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Modificacion de producto que tiene que contestar una persona del local. */
export interface PendingReview {
  id: string;
  producto: string;
  pedido: string;
  textoCliente: string | null;
  abiertoEn: string;
  /** null = todavia esperando respuesta del equipo. */
  resueltoEn: string | null;
  respuesta: string | null;
}

export interface Conversation {
  id: string;
  channel: ChannelId;
  externalId: string;
  contactId: string;
  mode: ConversationMode;
  lastIntent: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  needsAttention: boolean;
  attentionReason: string | null;
  pendingReview: PendingReview | null;
  createdAt: string;
  updatedAt: string;
  contact?: Contact | null;
}

export interface Message {
  id: string;
  conversationId: string;
  channel: ChannelId;
  channelMessageId: string | null;
  direction: 'in' | 'out';
  author: 'bot' | 'human' | 'system';
  contentKind: string;
  text: string;
  /** Contenido canónico completo. Para las imágenes trae la url. */
  payload?: unknown;
  intent: string | null;
  handler: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  /** Costo real del turno en dólares, según OpenRouter. */
  costUsd: number | null;
  /** Modelo que respondió (OpenRouter puede rutear a un respaldo). */
  model: string | null;
  error: string | null;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  availableToday: boolean;
  limitedEdition: boolean;
  pickupOnly: boolean;
  notes: string | null;
  /** Foto del producto, como URL pública HTTPS. El bot la manda como imagen. */
  imageUrl: string | null;
  sortOrder: number;
  /** Cuando se toco por ultima vez. Sirve para saber si la carta quedo vieja. */
  updatedAt: string;
}

export interface OrderItem {
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  /** Modificacion pedida sobre este item. La decide una persona. */
  observation?: string;
  /** Quién autorizó esa modificación y con qué palabras, copiado al cerrar. */
  authorization?: { pedido: string; respuesta: string; en: string };
}

export interface Order {
  id: string;
  number: number;
  conversationId: string | null;
  contactId: string | null;
  customerName: string;
  customerDni: string | null;
  customerPhone: string | null;
  items: OrderItem[];
  total: number;
  paid: number;
  status: OrderStatus;
  deliveryMode: 'retira-local' | 'uber-cliente' | 'cadete-miska';
  deliveryDate: string | null;
  deliveryTime: string | null;
  address: string | null;
  recipientName: string | null;
  dedication: string | null;
  notes: string | null;
  campaignId: string | null;
  campaignSkuId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Course {
  id: string;
  name: string;
  description: string | null;
  price: number;
  location: string | null;
  modality: 'presencial' | 'online';
  imageUrl: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CourseSession {
  id: string;
  courseId: string;
  /** Como lo dice el equipo: "viernes 11/9, 17 hs". */
  label: string;
  capacity: number;
  sortOrder: number;
  /** Inscriptos que no cancelaron. Lo calcula el servidor. */
  taken?: number;
}

export type SignupStatus = 'pendiente' | 'inscripto' | 'cancelado';

/** Una fila de la planilla de inscriptos. */
export interface CourseSignup {
  id: string;
  courseId: string;
  sessionId: string | null;
  contactId: string | null;
  conversationId: string | null;
  fullName: string;
  contactInfo: string | null;
  total: number;
  paid: number;
  status: SignupStatus;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CursoConTurnos {
  course: Course;
  sessions: CourseSession[];
}

export interface CampaignSku {
  id: string;
  campaignId: string;
  name: string;
  price: number;
  stockTotal: number;
  stockUsed: number;
  sortOrder: number;
}

export interface Campaign {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  active: boolean;
  pitch: string | null;
  skus: CampaignSku[];
}

export interface QuickReply {
  key: string;
  label: string;
  body: string;
  triggers: string[];
  autoSend: boolean;
  usageCount: number;
  preview?: string;
}

export interface Settings {
  botEnabled: boolean;
  activeChannels: ChannelId[];
  model: string;
  effort: string;
  escalateAfterErrors: number;
  typingMsPerChar: number;
  maxTypingMs: number;
  /** Horario tal cual lo cuenta el bot. Texto libre: el real es partido y cambia los domingos. */
  scheduleText: string;
  openHour: number;
  closeHour: number;
  address: string;
  transferAlias: string;
  transferHolder: string;
  webUrl: string;
  coursesUrl: string;
  breakfastsUrl: string;
  /** La carta de pastelería como imagen, que el bot manda cuando la piden. */
  cartaUrl: string;
  /** Cuándo se subió, para avisar si quedó vieja frente a los precios. */
  cartaSubidaEn: string;
}

export interface ChannelHealth {
  channel: ChannelId;
  configured: boolean;
  ok: boolean;
  detail?: string;
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
  costUsd: number;
}

export interface Metrics {
  summary: {
    conversations: number;
    humanMode: number;
    needsAttention: number;
    inbound: number;
    outbound: number;
    orders: number;
    draftOrders: number;
    avgLatencyMs: number;
    costUsd: number;
    errors: number;
  };
  daily: MetricPoint[];
  intents: Array<{ intent: string; count: number }>;
  quickReplies: Array<{ key: string; label: string; usageCount: number }>;
}

/** Gasto acumulado del modelo, en dólares. */
export interface Gasto {
  hoy: number;
  mes: number;
  historico: number;
}

export interface ConversationDetail {
  conversation: Conversation;
  contact: Contact | null;
  messages: Message[];
  orders: Order[];
  suggestions: QuickReply[];
}

// ---------------------------------------------------------------------------

/**
 * Base de la API.
 *
 * En desarrollo queda vacía y el proxy de Vite manda `/api` al servidor local.
 * En Vercel el panel es estático y el bot vive en otro dominio, así que hay que
 * definir `VITE_API_URL` (ej. https://bot.miskamuska.com.ar) al hacer el build.
 * Se deja sin barra final para poder concatenar rutas que ya empiezan con `/`.
 */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

const url = (path: string): string => `${API_BASE}${path}`;

/** true cuando el panel está publicado pero no sabe a qué servidor hablarle. */
export const apiBaseFaltante =
  !API_BASE && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

const AYUDA_API_BASE =
  'El panel no sabe a qué servidor hablarle: se construyó sin VITE_API_URL, ' +
  'así que está pidiéndose la API a sí mismo y recibe su propio HTML.\n\n' +
  'En Vercel: Settings → Environment Variables → VITE_API_URL = https://tu-bot.dominio.com\n' +
  'Después hay que VOLVER A DESPLEGAR: Vite incrusta las variables al construir, ' +
  'no las lee en tiempo de ejecución.';

/** Token opcional del panel; se guarda en localStorage. */
export function getToken(): string {
  return localStorage.getItem('miska.token') ?? '';
}

export function setToken(token: string): void {
  if (token) localStorage.setItem('miska.token', token);
  else localStorage.removeItem('miska.token');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Si no sabemos a dónde apuntar, no tiene sentido pedir nada: la petición
  // caería en el propio hosting del panel y volvería su index.html.
  if (apiBaseFaltante) throw new Error(AYUDA_API_BASE);

  const token = getToken();
  const res = await fetch(url(path), {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }
  if (res.status === 204) return undefined as T;

  // Si vuelve HTML donde esperábamos JSON, la petición no llegó al bot: la
  // atendió el hosting del panel y devolvió su index.html. El error nativo sería
  // "Unexpected token '<'", que no le dice nada a nadie.
  const tipo = res.headers.get('content-type') ?? '';
  if (!tipo.includes('json')) {
    throw new Error(apiBaseFaltante ? AYUDA_API_BASE : `Respuesta no-JSON desde ${url(path)} (${tipo || 'sin content-type'}).`);
  }

  return (await res.json()) as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

export const api = {
  conversations: (params: Record<string, string> = {}) =>
    get<Conversation[]>(`/api/conversations?${new URLSearchParams(params)}`),
  conversation: (id: string) => get<ConversationDetail>(`/api/conversations/${id}`),
  markRead: (id: string) => post<{ ok: true }>(`/api/conversations/${id}/read`),
  setMode: (id: string, mode: ConversationMode) =>
    post<{ ok: true }>(`/api/conversations/${id}/mode`, { mode }),
  setAttention: (id: string, needsAttention: boolean, reason?: string) =>
    post<{ ok: true }>(`/api/conversations/${id}/attention`, { needsAttention, reason }),
  answerReview: (id: string, respuesta: string, devolverAlBot = true) =>
    post<{ ok: true; conversation: Conversation }>(`/api/conversations/${id}/review`, {
      respuesta,
      devolverAlBot,
    }),
  clearReview: (id: string) => del<{ ok: true }>(`/api/conversations/${id}/review`),

  sendMessage: (id: string, text: string) =>
    post<{ ok: true }>(`/api/conversations/${id}/messages`, { text }),
  sendQuickReply: (id: string, quickReplyKey: string) =>
    post<{ ok: true }>(`/api/conversations/${id}/messages`, { quickReplyKey }),
  updateContact: (id: string, patchBody: Partial<Contact>) =>
    patch<{ ok: true; contact: Contact }>(`/api/contacts/${id}`, patchBody),

  products: () => get<Product[]>('/api/products'),
  updateProduct: (id: string, body: Partial<Product>) => patch<Product>(`/api/products/${id}`, body),
  createProduct: (body: Partial<Product>) => post<Product>('/api/products', body),
  deleteProduct: (id: string) => del<{ ok: true }>(`/api/products/${id}`),
  bulkAvailability: (ids: string[], available: boolean) =>
    post<{ ok: true }>('/api/products/availability', { ids, available }),

  orders: (params: Record<string, string> = {}) =>
    get<Order[]>(`/api/orders?${new URLSearchParams(params)}`),
  updateOrder: (id: string, body: Partial<Order>) => patch<Order>(`/api/orders/${id}`, body),

  campaigns: () => get<Campaign[]>('/api/campaigns'),
  setCampaignActive: (id: string, active: boolean) =>
    post<{ ok: true }>(`/api/campaigns/${id}/active`, { active }),
  upsertSku: (campaignId: string, body: Partial<CampaignSku>) =>
    post<CampaignSku>(`/api/campaigns/${campaignId}/skus`, body),

  /**
   * Sube una foto y devuelve su dirección pública, para guardarla en el producto.
   * Va como cuerpo binario con el content-type del archivo: un archivo por
   * request, así que el sobre de multipart no aportaría nada.
   */
  uploadMedia: (file: File) =>
    request<{ id: string; url: string; advertencia?: string }>('/api/media', {
      method: 'POST',
      body: file,
      headers: {
        'content-type': file.type,
        // encodeURIComponent porque un encabezado HTTP no admite acentos.
        'x-filename': encodeURIComponent(file.name),
      },
    }),

  courses: () => get<CursoConTurnos[]>('/api/courses'),
  createCourse: (body: Partial<Course>) => post<Course>('/api/courses', body),
  updateCourse: (id: string, body: Partial<Course>) =>
    patch<Course>(`/api/courses/${id}`, body),
  deleteCourse: (id: string) => del<{ ok: true }>(`/api/courses/${id}`),
  upsertSession: (courseId: string, body: Partial<CourseSession>) =>
    post<CourseSession>(`/api/courses/${courseId}/sessions`, body),
  deleteSession: (id: string) => del<{ ok: true }>(`/api/courses/sessions/${id}`),
  courseSignups: (courseId: string) =>
    get<CourseSignup[]>(`/api/courses/${courseId}/signups`),
  createSignup: (courseId: string, body: Partial<CourseSignup>) =>
    post<CourseSignup>(`/api/courses/${courseId}/signups`, body),
  updateSignup: (id: string, body: Partial<CourseSignup>) =>
    patch<CourseSignup>(`/api/courses/signups/${id}`, body),
  deleteSignup: (id: string) => del<{ ok: true }>(`/api/courses/signups/${id}`),

  quickReplies: () => get<QuickReply[]>('/api/quick-replies'),
  saveQuickReply: (body: Partial<QuickReply>) => post<QuickReply>('/api/quick-replies', body),
  deleteQuickReply: (key: string) => del<{ ok: true }>(`/api/quick-replies/${key}`),

  metrics: (days = 14) => get<Metrics>(`/api/metrics?days=${days}`),
  /** Lo que va gastando el bot en el modelo. Se pide en cada pantalla. */
  gasto: () => get<Gasto>('/api/gasto'),
  settings: () => get<{ settings: Settings; channels: ChannelHealth[] }>('/api/settings'),
  saveSettings: (body: Partial<Settings>) => patch<Settings>('/api/settings', body),
};

// ---------------------------------------------------------------------------

export type LiveEvent =
  | { type: 'hello'; at: string }
  | { type: 'message'; conversationId: string; message: Message }
  | { type: 'conversation'; conversation: Conversation }
  | { type: 'order'; order: Order }
  | { type: 'typing'; conversationId: string; on: boolean }
  | { type: 'channel-status'; channel: string; ok: boolean; detail?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; data?: unknown };

/**
 * El EventSource del navegador no puede mandar encabezados, así que el token
 * viaja en el query string. Eso queda en los logs de acceso del proxy: no
 * loguees query strings, o poné el panel detrás de la autenticación del proxy.
 */
export function openStream(onEvent: (event: LiveEvent) => void): () => void {
  // Sin saber a dónde apuntar, el EventSource pediría /api/stream al propio
  // hosting del panel, recibiría un index.html, fallaría, y reintentaría cada
  // 3 s para siempre. Un bucle de reconexión que no puede funcionar.
  if (apiBaseFaltante) return () => undefined;

  const token = getToken();
  const streamUrl = url(`/api/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`);
  let source: EventSource | null = new EventSource(streamUrl);
  let retry: number | undefined;

  const attach = (es: EventSource) => {
    es.onmessage = (event) => {
      try {
        onEvent(JSON.parse(event.data) as LiveEvent);
      } catch {
        // Un evento malformado no debe tirar el panel.
      }
    };
    es.onerror = () => {
      es.close();
      // EventSource reconecta solo, pero si el servidor se reinicia conviene
      // recrearlo para volver a recibir el backlog reciente.
      retry = window.setTimeout(() => {
        source = new EventSource(streamUrl);
        attach(source);
      }, 3000);
    };
  };
  attach(source);

  return () => {
    if (retry) window.clearTimeout(retry);
    source?.close();
    source = null;
  };
}
