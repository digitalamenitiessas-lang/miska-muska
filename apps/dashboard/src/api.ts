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
  sortOrder: number;
}

export interface OrderItem {
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
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
  dedication: string | null;
  notes: string | null;
  campaignId: string | null;
  campaignSkuId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
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
  agentName: string;
  activeChannels: ChannelId[];
  model: string;
  effort: string;
  escalateAfterErrors: number;
  typingMsPerChar: number;
  maxTypingMs: number;
  openHour: number;
  closeHour: number;
  address: string;
  transferAlias: string;
  transferHolder: string;
  webUrl: string;
  coursesUrl: string;
  breakfastsUrl: string;
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

/** Token opcional del panel; se guarda en localStorage. */
export function getToken(): string {
  return localStorage.getItem('miska.token') ?? '';
}

export function setToken(token: string): void {
  if (token) localStorage.setItem('miska.token', token);
  else localStorage.removeItem('miska.token');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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

  quickReplies: () => get<QuickReply[]>('/api/quick-replies'),
  saveQuickReply: (body: Partial<QuickReply>) => post<QuickReply>('/api/quick-replies', body),
  deleteQuickReply: (key: string) => del<{ ok: true }>(`/api/quick-replies/${key}`),

  metrics: (days = 14) => get<Metrics>(`/api/metrics?days=${days}`),
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
