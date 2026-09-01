/**
 * Repositorios. Único lugar del sistema que escribe SQL.
 * Devuelve entidades de `core/types/domain.ts`, nunca filas crudas.
 *
 * Todo es asíncrono porque Postgres lo es. Notas del driver que importan al leer
 * los mapeadores:
 *  - las columnas `jsonb` vuelven ya parseadas (objeto/array), no como texto
 *  - `timestamptz` vuelve como `Date`; el dominio usa ISO string
 *  - `numeric` vuelve como STRING, para no perder precisión: hay que convertirlo
 */

import { randomBytes } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { dateOnly, exec, iso, isoOrNull, newId, nowIso, one, q, TIMEZONE } from './db.js';
import type {
  Campaign,
  CampaignSku,
  Contact,
  Conversation,
  ConversationMode,
  Course,
  CourseSession,
  CourseSignup,
  MetricPoint,
  Order,
  OrderItem,
  OrderStatus,
  PendingReview,
  Product,
  ProductCategory,
  QuickReply,
  SignupStatus,
  BotSettings,
  StoredMessage,
} from '../types/domain.js';
import type { ChannelId, InboundContact, MessageAuthor } from '../types/message.js';

type Row = QueryResultRow;

const str = (v: unknown): string | null => (v == null ? null : String(v));
const int = (v: unknown): number | null => (v == null ? null : Number(v));

// ---------------------------------------------------------------------------
// Mapeadores
// ---------------------------------------------------------------------------

function toContact(r: Row): Contact {
  return {
    id: String(r.id),
    channel: String(r.channel) as ChannelId,
    externalId: String(r.external_id),
    displayName: str(r.display_name),
    username: str(r.username),
    phone: str(r.phone),
    fullName: str(r.full_name),
    dni: str(r.dni),
    notes: str(r.notes),
    isReturning: Boolean(r.is_returning),
    firstSeenAt: iso(r.first_seen_at),
    lastSeenAt: iso(r.last_seen_at),
  };
}

/** Forma mínima que tiene que tener el jsonb para que la pausa lo tome en serio. */
function esPendingReview(value: unknown): value is PendingReview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Partial<PendingReview>;
  return typeof v.pedido === 'string' && typeof v.producto === 'string';
}

function toConversation(r: Row): Conversation {
  return {
    id: String(r.id),
    channel: String(r.channel) as ChannelId,
    externalId: String(r.external_id),
    contactId: String(r.contact_id),
    mode: String(r.mode) as ConversationMode,
    lastIntent: str(r.last_intent),
    lastInboundAt: isoOrNull(r.last_inbound_at),
    lastOutboundAt: isoOrNull(r.last_outbound_at),
    lastMessagePreview: str(r.last_message_preview),
    unreadCount: Number(r.unread_count ?? 0),
    needsAttention: Boolean(r.needs_attention),
    attentionReason: str(r.attention_reason),
    // jsonb vuelve ya parseado, pero la columna no tiene CHECK: se comprueba la
    // forma antes de confiar. Sin esto, cualquier valor truthy sin las claves
    // esperadas (un {} escrito a mano) dejaba la charla con una consulta abierta
    // para siempre, y con eso `crear_pedido` rechazando todo.
    pendingReview: esPendingReview(r.pending_review) ? r.pending_review : null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toMessage(r: Row): StoredMessage {
  return {
    id: String(r.id),
    conversationId: String(r.conversation_id),
    channel: String(r.channel) as ChannelId,
    channelMessageId: str(r.channel_message_id),
    direction: String(r.direction) as 'in' | 'out',
    author: String(r.author) as MessageAuthor,
    contentKind: String(r.content_kind),
    text: String(r.text),
    payload: r.payload ?? null,
    intent: str(r.intent),
    handler: str(r.handler),
    latencyMs: int(r.latency_ms),
    inputTokens: int(r.input_tokens),
    outputTokens: int(r.output_tokens),
    cacheReadTokens: int(r.cache_read_tokens),
    // numeric llega como string desde pg.
    costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
    model: str(r.model),
    error: str(r.error),
    createdAt: iso(r.created_at),
  };
}

function toProduct(r: Row): Product {
  return {
    id: String(r.id),
    name: String(r.name),
    category: String(r.category) as ProductCategory,
    price: Number(r.price),
    availableToday: Boolean(r.available_today),
    limitedEdition: Boolean(r.limited_edition),
    pickupOnly: Boolean(r.pickup_only),
    notes: str(r.notes),
    imageUrl: str(r.image_url),
    sortOrder: Number(r.sort_order ?? 0),
    updatedAt: iso(r.updated_at),
  };
}

function toOrder(r: Row): Order {
  return {
    id: String(r.id),
    number: Number(r.number),
    conversationId: str(r.conversation_id),
    contactId: str(r.contact_id),
    customerName: String(r.customer_name),
    customerDni: str(r.customer_dni),
    customerPhone: str(r.customer_phone),
    // jsonb ya viene parseado.
    items: (r.items ?? []) as OrderItem[],
    total: Number(r.total ?? 0),
    paid: Number(r.paid ?? 0),
    status: String(r.status) as OrderStatus,
    deliveryMode: String(r.delivery_mode) as Order['deliveryMode'],
    deliveryDate: dateOnly(r.delivery_date),
    deliveryTime: str(r.delivery_time),
    address: str(r.address),
    recipientName: str(r.recipient_name),
    dedication: str(r.dedication),
    notes: str(r.notes),
    campaignId: str(r.campaign_id),
    campaignSkuId: str(r.campaign_sku_id),
    createdBy: String(r.created_by) as MessageAuthor,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toCampaign(r: Row): Campaign {
  return {
    id: String(r.id),
    name: String(r.name),
    startsOn: dateOnly(r.starts_on) ?? '',
    endsOn: dateOnly(r.ends_on) ?? '',
    active: Boolean(r.active),
    pitch: str(r.pitch),
    createdAt: iso(r.created_at),
  };
}

function toSku(r: Row): CampaignSku {
  return {
    id: String(r.id),
    campaignId: String(r.campaign_id),
    name: String(r.name),
    price: Number(r.price),
    stockTotal: Number(r.stock_total),
    stockUsed: Number(r.stock_used),
    sortOrder: Number(r.sort_order ?? 0),
  };
}

function toCourse(r: Row): Course {
  return {
    id: String(r.id),
    name: String(r.name),
    description: str(r.description),
    price: Number(r.price ?? 0),
    location: str(r.location),
    modality: String(r.modality) as Course['modality'],
    imageUrl: str(r.image_url),
    active: Boolean(r.active),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toSession(r: Row): CourseSession {
  return {
    id: String(r.id),
    courseId: String(r.course_id),
    label: String(r.label),
    capacity: Number(r.capacity ?? 0),
    sortOrder: Number(r.sort_order ?? 0),
    // Viene de un LEFT JOIN con el conteo; sin él queda undefined.
    taken: r.taken == null ? undefined : Number(r.taken),
  };
}

function toSignup(r: Row): CourseSignup {
  return {
    id: String(r.id),
    courseId: String(r.course_id),
    sessionId: str(r.session_id),
    contactId: str(r.contact_id),
    conversationId: str(r.conversation_id),
    fullName: String(r.full_name),
    contactInfo: str(r.contact_info),
    total: Number(r.total ?? 0),
    paid: Number(r.paid ?? 0),
    status: String(r.status) as SignupStatus,
    notes: str(r.notes),
    createdBy: String(r.created_by) as MessageAuthor,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toQuickReply(r: Row): QuickReply {
  return {
    key: String(r.key),
    label: String(r.label),
    body: String(r.body),
    triggers: (r.triggers ?? []) as string[],
    autoSend: Boolean(r.auto_send),
    usageCount: Number(r.usage_count ?? 0),
    updatedAt: iso(r.updated_at),
  };
}

// ---------------------------------------------------------------------------
// Fábrica
// ---------------------------------------------------------------------------

export function createRepositories() {
  const contacts = {
    /**
     * Varios contactos de una sola consulta.
     *
     * La bandeja necesita el contacto de cada conversación que lista. Antes los
     * pedía de a uno: cien conversaciones eran cien consultas, contra un pool de
     * CINCO conexiones, o sea veinte rondas contra Supabase encoladas una atrás
     * de la otra. Ese era el "delay de la aplicación misma" que reportó el local
     * con diez charlas, y con trescientas se vuelve inusable.
     *
     * Devuelve un Map porque quien la llama va a buscar por id.
     */
    async byIds(ids: string[]): Promise<Map<string, Contact>> {
      const unicos = [...new Set(ids)];
      if (!unicos.length) return new Map();
      const rows = await q('SELECT * FROM contacts WHERE id = ANY($1)', [unicos]);
      return new Map(rows.map((r) => [String(r.id), toContact(r)]));
    },

    /** Inserta o actualiza el contacto por (canal, externalId), en un solo viaje. */
    async upsert(channel: ChannelId, c: InboundContact): Promise<Contact> {
      const row = await one(
        `INSERT INTO contacts (id, channel, external_id, display_name, username, phone)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (channel, external_id) DO UPDATE SET
           display_name = COALESCE(EXCLUDED.display_name, contacts.display_name),
           username     = COALESCE(EXCLUDED.username, contacts.username),
           phone        = COALESCE(EXCLUDED.phone, contacts.phone),
           last_seen_at = now()
         RETURNING *`,
        [newId('c_'), channel, c.externalId, c.displayName ?? null, c.username ?? null, c.phone ?? null],
      );
      return toContact(row!);
    },

    async get(id: string): Promise<Contact | null> {
      const row = await one('SELECT * FROM contacts WHERE id = $1', [id]);
      return row ? toContact(row) : null;
    },

    async update(
      id: string,
      patch: Partial<Pick<Contact, 'fullName' | 'dni' | 'phone' | 'notes' | 'isReturning'>>,
    ): Promise<void> {
      const sets: string[] = [];
      const args: unknown[] = [];
      const put = (column: string, value: unknown) => {
        sets.push(`${column} = $${sets.length + 1}`);
        args.push(value);
      };
      if (patch.fullName !== undefined) put('full_name', patch.fullName);
      if (patch.dni !== undefined) put('dni', patch.dni);
      if (patch.phone !== undefined) put('phone', patch.phone);
      if (patch.notes !== undefined) put('notes', patch.notes);
      if (patch.isReturning !== undefined) put('is_returning', patch.isReturning);
      if (!sets.length) return;
      args.push(id);
      await exec(`UPDATE contacts SET ${sets.join(', ')} WHERE id = $${args.length}`, args);
    },

    /** Agrega una nota al CRM sin borrar las anteriores. */
    async appendNote(id: string, note: string): Promise<void> {
      await exec(
        `UPDATE contacts
         SET notes = TRIM(BOTH E'\\n' FROM COALESCE(notes || E'\\n', '') ||
                     '[' || to_char(now() AT TIME ZONE $2, 'YYYY-MM-DD') || '] ' || $3)
         WHERE id = $1`,
        [id, TIMEZONE, note],
      );
    },
  };

  const conversations = {
    async ensure(channel: ChannelId, externalId: string, contactId: string): Promise<Conversation> {
      // El DO UPDATE que no cambia nada existe para que RETURNING devuelva la
      // fila también cuando ya existía (con DO NOTHING no devolvería nada).
      const row = await one(
        `INSERT INTO conversations (id, channel, external_id, contact_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (channel, external_id)
           DO UPDATE SET updated_at = conversations.updated_at
         RETURNING *`,
        [newId('conv_'), channel, externalId, contactId],
      );
      return toConversation(row!);
    },

    async get(id: string): Promise<Conversation | null> {
      const row = await one('SELECT * FROM conversations WHERE id = $1', [id]);
      return row ? toConversation(row) : null;
    },

    async list(
      opts: {
        mode?: ConversationMode;
        channel?: ChannelId;
        needsAttention?: boolean;
        /** Con mensajes sin leer. */
        sinLeer?: boolean;
        /** Con una consulta de modificación esperando respuesta. */
        consultaAbierta?: boolean;
        limit?: number;
        /** Buscador: nombre, teléfono, o una palabra dicha adentro de la charla. */
        q?: string;
      } = {},
    ): Promise<Conversation[]> {
      const where: string[] = [];
      const args: unknown[] = [];
      if (opts.mode) {
        args.push(opts.mode);
        where.push(`c.mode = $${args.length}`);
      }
      if (opts.channel) {
        args.push(opts.channel);
        where.push(`c.channel = $${args.length}`);
      }
      if (opts.needsAttention) where.push('c.needs_attention');
      if (opts.sinLeer) where.push('c.unread_count > 0');
      /*
        Una consulta ABIERTA es la que todavía no tiene respuesta. El jsonb
        guarda las contestadas también —el bot las necesita 48 h para retomar
        con las palabras del equipo—, así que no alcanza con que exista.
      */
      if (opts.consultaAbierta) {
        where.push("c.pending_review IS NOT NULL AND c.pending_review->>'resueltoEn' IS NULL");
      }

      /*
        El buscador. Tres formas de encontrar la misma charla, porque el equipo
        la busca de las tres: por el nombre, por el número, o por algo que se
        dijo adentro ("la que pidió la torta Kinder").

        El teléfono va aparte y por dígitos: nadie lo escribe como está
        guardado. Alguien tipea "381 415-4991" y en la base dice
        "5493814154991". Se le sacan los separadores a los dos lados y recién
        ahí se comparan, con tres dígitos como piso para que "38" no traiga
        media agenda.

        El texto de los mensajes va en un EXISTS y no en un JOIN: con JOIN, una
        charla donde la palabra aparece diez veces salía diez veces en la
        bandeja. Es un ILIKE sin índice, o sea un scan de `messages`, y eso
        está bien PORQUE SOLO CORRE CUANDO ALGUIEN ESCRIBE EN EL BUSCADOR: la
        bandeja normal no pasa por acá. Si algún día duele, lo que va es un
        índice trigram, no sacar la búsqueda.
      */
      const texto = opts.q?.trim() ?? '';
      if (texto) {
        args.push(`%${texto}%`);
        const patron = `$${args.length}`;
        const partes = [
          `ct.full_name ILIKE ${patron}`,
          `ct.display_name ILIKE ${patron}`,
          `ct.username ILIKE ${patron}`,
          `c.last_message_preview ILIKE ${patron}`,
          `EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.text ILIKE ${patron})`,
        ];
        const digitos = texto.replace(/\D/g, '');
        if (digitos.length >= 3) {
          args.push(`%${digitos}%`);
          const soloNumeros = `$${args.length}`;
          partes.push(
            `regexp_replace(COALESCE(ct.phone, ''), '\\D', '', 'g') LIKE ${soloNumeros}`,
            `regexp_replace(c.external_id, '\\D', '', 'g') LIKE ${soloNumeros}`,
          );
        }
        where.push(`(${partes.join(' OR ')})`);
      }

      args.push(opts.limit ?? 100);
      /*
        La bandeja se ordena por la ÚLTIMA ACTIVIDAD DE LA CHARLA, no por cuándo
        se tocó la fila.

        Ordenaba por `updated_at`, y esa columna la bumpean un montón de cosas
        que no son un mensaje nuevo: marcar una charla para atención, tomarla o
        devolverla, abrir o cerrar una consulta. El reporte del local fue
        exacto: "había un mensaje de hace una hora y media y se puso arriba, en
        vez de otro que me había llegado hace un minuto". Era eso: una charla
        vieja a la que le llegó un comprobante saltaba arriba de una nueva.

        `GREATEST` con dos columnas que pueden ser NULL necesita el COALESCE
        adentro: en Postgres, GREATEST(x, NULL) no devuelve x, devuelve NULL, y
        una charla sin saliente todavía se iría al fondo.
      */
      const rows = await q(
        `SELECT c.* FROM conversations c
         LEFT JOIN contacts ct ON ct.id = c.contact_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY GREATEST(
           COALESCE(c.last_inbound_at, c.created_at),
           COALESCE(c.last_outbound_at, c.created_at)
         ) DESC
         LIMIT $${args.length}`,
        args,
      );
      return rows.map(toConversation);
    },

    /**
     * Cuántas charlas hay en cada estado, contadas contra la base entera.
     *
     * Los globitos de la barra se calculaban sobre las cien conversaciones que
     * el panel tenía cargadas, y ahí está el problema: de la charla ciento uno
     * en adelante, una clienta marcada para atención no figuraba en el número
     * ni aparecía en el filtro. No se veía lento — se veía como si no
     * existiera, que es el peor final posible.
     *
     * Tres COUNT sobre `conversations`, que es una tabla chica: son
     * milisegundos y no dependen de cuántas filas mire el panel.
     */
    async contar(): Promise<{ atencion: number; sinLeer: number; consultas: number }> {
      const row = await one<{ atencion: string; sin_leer: string; consultas: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE needs_attention)::text AS atencion,
           COUNT(*) FILTER (WHERE unread_count > 0)::text AS sin_leer,
           COUNT(*) FILTER (
             WHERE pending_review IS NOT NULL AND pending_review->>'resueltoEn' IS NULL
           )::text AS consultas
         FROM conversations`,
      );
      return {
        atencion: Number(row?.atencion ?? 0),
        sinLeer: Number(row?.sin_leer ?? 0),
        consultas: Number(row?.consultas ?? 0),
      };
    },

    async markInbound(id: string, preview: string, intent: string | null): Promise<void> {
      await exec(
        `UPDATE conversations SET last_inbound_at = now(), last_message_preview = $2,
           last_intent = COALESCE($3, last_intent), unread_count = unread_count + 1,
           updated_at = now()
         WHERE id = $1`,
        [id, preview.slice(0, 240), intent],
      );
    },

    async markOutbound(id: string, preview: string): Promise<void> {
      await exec(
        `UPDATE conversations SET last_outbound_at = now(), last_message_preview = $2,
           updated_at = now()
         WHERE id = $1`,
        [id, preview.slice(0, 240)],
      );
    },

    async setMode(id: string, mode: ConversationMode): Promise<void> {
      await exec('UPDATE conversations SET mode = $2, updated_at = now() WHERE id = $1', [id, mode]);
    },

    async setAttention(id: string, needs: boolean, reason: string | null): Promise<void> {
      await exec(
        `UPDATE conversations SET needs_attention = $2, attention_reason = $3, updated_at = now()
         WHERE id = $1`,
        [id, needs, reason],
      );
    },

    /**
     * Abre la consulta de modificación, o le SUMA el pedido nuevo si ya había una
     * sin contestar. Suma y no reemplaza porque el modelo puede pedir dos cambios
     * en el mismo turno ("sin queso y en pan de chipá"), y la primera consulta no
     * puede desaparecer sin que nadie se entere.
     */
    async openReview(
      id: string,
      data: Pick<PendingReview, 'producto' | 'pedido' | 'textoCliente'>,
    ): Promise<PendingReview> {
      const actual = (await conversations.get(id))?.pendingReview ?? null;
      const abierta = actual && !actual.resueltoEn ? actual : null;
      const juntar = (previo: string | null, nuevo: string | null): string | null => {
        if (!nuevo) return previo;
        if (!previo) return nuevo;
        return previo.includes(nuevo) ? previo : `${previo} + ${nuevo}`;
      };
      const review: PendingReview = abierta
        ? {
            ...abierta,
            // Se acumulan los tres campos, no solo el pedido: con dos consultas
            // sobre productos distintos, el panel mostraba los dos cambios
            // atribuidos al primer producto y con la frase del primer cliente.
            // Es la información con la que se decide si se pierde una venta.
            pedido: juntar(abierta.pedido, data.pedido) ?? data.pedido,
            producto: juntar(abierta.producto, data.producto) ?? data.producto,
            textoCliente: juntar(abierta.textoCliente, data.textoCliente),
          }
        : {
            id: newId('rev_'),
            ...data,
            abiertoEn: nowIso(),
            resueltoEn: null,
            respuesta: null,
          };
      await exec(
        'UPDATE conversations SET pending_review = $2::jsonb, updated_at = now() WHERE id = $1',
        [id, JSON.stringify(review)],
      );
      return review;
    },

    /**
     * Guarda la respuesta del equipo. Devuelve null si no había ninguna consulta
     * abierta: el WHERE comprueba y el UPDATE escribe en la misma sentencia, así
     * que dos operadores apretando a la vez no la contestan dos veces.
     *
     * La marca de tiempo se arma en TS y viaja como parámetro: `to_char` daría un
     * offset de solo horas ("-03") y `Date.parse` lo rechaza.
     */
    async answerReview(
      id: string,
      respuesta: string,
      enElChat = false,
    ): Promise<Conversation | null> {
      const row = await one(
        `UPDATE conversations
         SET pending_review = pending_review || jsonb_build_object(
               'respuesta', $2::text, 'resueltoEn', $3::text,
               'respondidaEnElChat', $4::boolean),
             updated_at = now()
         WHERE id = $1
           AND pending_review IS NOT NULL
           AND pending_review->>'resueltoEn' IS NULL
         RETURNING *`,
        [id, respuesta, nowIso(), enElChat],
      );
      return row ? toConversation(row) : null;
    },

    /** Borra la consulta: el pedido se cargó, o ya no aplica. */
    async clearReview(id: string): Promise<void> {
      await exec(
        'UPDATE conversations SET pending_review = NULL, updated_at = now() WHERE id = $1',
        [id],
      );
    },

    async markRead(id: string): Promise<void> {
      await exec('UPDATE conversations SET unread_count = 0 WHERE id = $1', [id]);
    },
  };

  const messages = {
    /**
     * true si el id del proveedor ya fue procesado (webhook reintentado).
     *
     * Se pregunta POR CONVERSACIÓN, no por canal: el id de mensaje de Telegram es
     * correlativo por chat, así que dos personas distintas tienen las dos un
     * mensaje 1. Preguntando por canal, el primer mensaje de cada charla nueva
     * chocaba con uno viejo de otra y se descartaba en silencio.
     */
    async alreadyProcessed(conversationId: string, channelMessageId: string): Promise<boolean> {
      const row = await one(
        'SELECT 1 AS x FROM messages WHERE conversation_id = $1 AND channel_message_id = $2',
        [conversationId, channelMessageId],
      );
      return row !== null;
    },

    async insert(
      m: Omit<StoredMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
    ): Promise<StoredMessage> {
      const row = await one(
        `INSERT INTO messages (id, conversation_id, channel, channel_message_id, direction, author,
           content_kind, text, payload, intent, handler, latency_ms, input_tokens, output_tokens,
           cache_read_tokens, cost_usd, model, error, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                 COALESCE($19::timestamptz, now()))
         RETURNING *`,
        [
          m.id ?? newId('m_'), m.conversationId, m.channel, m.channelMessageId, m.direction,
          m.author, m.contentKind, m.text, m.payload == null ? null : JSON.stringify(m.payload),
          m.intent, m.handler, m.latencyMs, m.inputTokens, m.outputTokens, m.cacheReadTokens,
          m.costUsd, m.model, m.error, m.createdAt ?? null,
        ],
      );
      return toMessage(row!);
    },

    /** Últimos N mensajes en orden cronológico. */
    async history(conversationId: string, limit = 40): Promise<StoredMessage[]> {
      const rows = await q(
        `SELECT * FROM (
           SELECT * FROM messages WHERE conversation_id = $1
           ORDER BY created_at DESC LIMIT $2
         ) t ORDER BY created_at ASC`,
        [conversationId, limit],
      );
      return rows.map(toMessage);
    },

    async setChannelMessageId(
      id: string,
      channelMessageId: string | null,
      error: string | null,
    ): Promise<void> {
      await exec('UPDATE messages SET channel_message_id = $2, error = $3 WHERE id = $1', [
        id,
        channelMessageId,
        error,
      ]);
    },

    /*
      Reescribe el contenido de un mensaje ya guardado. Existe por una sola cosa:
      el adjunto se baja DESPUÉS de guardar el mensaje —para que la bandeja no
      tenga que esperar la descarga— y al terminar hay que dejarle la dirección
      al payload. No es una puerta general para editar mensajes.
    */
    async setPayload(id: string, payload: unknown): Promise<StoredMessage | null> {
      const row = await one('UPDATE messages SET payload = $2 WHERE id = $1 RETURNING *', [
        id,
        JSON.stringify(payload),
      ]);
      return row ? toMessage(row) : null;
    },
  };

  const products = {
    async list(
      opts: { category?: ProductCategory; onlyAvailable?: boolean } = {},
    ): Promise<Product[]> {
      const where: string[] = [];
      const args: unknown[] = [];
      if (opts.category) {
        args.push(opts.category);
        where.push(`category = $${args.length}`);
      }
      if (opts.onlyAvailable) where.push('available_today');
      const rows = await q(
        `SELECT * FROM products ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY category, sort_order, name`,
        args,
      );
      return rows.map(toProduct);
    },

    /**
     * Las categorías que hoy existen, tal cual están escritas.
     *
     * No hay tabla de categorías: una categoría existe porque hay un producto
     * en ella, y deja de existir cuando se va el último. Eso evita el problema
     * de las categorías huérfanas, y hace que esta consulta sea la única fuente
     * de verdad sobre cuáles hay.
     */
    async categories(): Promise<string[]> {
      const rows = await q('SELECT DISTINCT category FROM products ORDER BY category');
      return rows.map((r) => String(r.category));
    },

    async search(query: string, onlyAvailable = true): Promise<Product[]> {
      const rows = await q(
        `SELECT * FROM products
         WHERE name ILIKE $1 ${onlyAvailable ? 'AND available_today' : ''}
         ORDER BY sort_order, name LIMIT 25`,
        [`%${query}%`],
      );
      return rows.map(toProduct);
    },

    async get(id: string): Promise<Product | null> {
      const row = await one('SELECT * FROM products WHERE id = $1', [id]);
      return row ? toProduct(row) : null;
    },

    async upsert(p: Omit<Product, 'updatedAt'>): Promise<Product> {
      const row = await one(
        `INSERT INTO products (id, name, category, price, available_today, limited_edition,
           pickup_only, notes, image_url, sort_order, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category,
           price = EXCLUDED.price, available_today = EXCLUDED.available_today,
           limited_edition = EXCLUDED.limited_edition, pickup_only = EXCLUDED.pickup_only,
           notes = EXCLUDED.notes, image_url = EXCLUDED.image_url,
           sort_order = EXCLUDED.sort_order, updated_at = now()
         RETURNING *`,
        [p.id, p.name, p.category, p.price, p.availableToday, p.limitedEdition, p.pickupOnly,
         p.notes, p.imageUrl ?? null, p.sortOrder],
      );
      return toProduct(row!);
    },

    async setAvailability(id: string, available: boolean): Promise<void> {
      await exec('UPDATE products SET available_today = $2, updated_at = now() WHERE id = $1', [
        id,
        available,
      ]);
    },

    /** Marca varios de una vez: es lo que hace el local a la mañana. */
    async setAvailabilityMany(ids: string[], available: boolean): Promise<number> {
      if (!ids.length) return 0;
      return exec(
        'UPDATE products SET available_today = $2, updated_at = now() WHERE id = ANY($1::text[])',
        [ids, available],
      );
    },

    async remove(id: string): Promise<void> {
      await exec('DELETE FROM products WHERE id = $1', [id]);
    },
  };

  const orders = {
    async create(o: Omit<Order, 'id' | 'number' | 'createdAt' | 'updatedAt'>): Promise<Order> {
      // El número lo asigna la SEQUENCE: dos pedidos simultáneos nunca repiten.
      const row = await one(
        `INSERT INTO orders (id, conversation_id, contact_id, customer_name, customer_dni,
           customer_phone, items, total, paid, status, delivery_mode, delivery_date, delivery_time,
           address, recipient_name, dedication, notes, campaign_id, campaign_sku_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                 $18, $19, $20)
         RETURNING *`,
        [
          newId('o_'), o.conversationId, o.contactId, o.customerName, o.customerDni,
          o.customerPhone, JSON.stringify(o.items), o.total, o.paid, o.status, o.deliveryMode,
          o.deliveryDate, o.deliveryTime, o.address, o.recipientName ?? null, o.dedication,
          o.notes, o.campaignId, o.campaignSkuId ?? null, o.createdBy,
        ],
      );
      return toOrder(row!);
    },

    async get(id: string): Promise<Order | null> {
      const row = await one('SELECT * FROM orders WHERE id = $1', [id]);
      return row ? toOrder(row) : null;
    },

    async byNumber(number: number): Promise<Order | null> {
      const row = await one('SELECT * FROM orders WHERE number = $1', [number]);
      return row ? toOrder(row) : null;
    },

    async list(
      opts: {
        status?: OrderStatus;
        contactId?: string;
        conversationId?: string;
        limit?: number;
      } = {},
    ): Promise<Order[]> {
      const where: string[] = [];
      const args: unknown[] = [];
      const put = (clause: string, value: unknown) => {
        args.push(value);
        where.push(clause.replace('?', `$${args.length}`));
      };
      if (opts.status) put('status = ?', opts.status);
      if (opts.contactId) put('contact_id = ?', opts.contactId);
      if (opts.conversationId) put('conversation_id = ?', opts.conversationId);
      args.push(opts.limit ?? 200);
      const rows = await q(
        `SELECT * FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC LIMIT $${args.length}`,
        args,
      );
      return rows.map(toOrder);
    },

    async update(id: string, patch: Partial<Order>): Promise<Order | null> {
      const columns: Record<string, string> = {
        customerName: 'customer_name', customerDni: 'customer_dni',
        customerPhone: 'customer_phone', total: 'total', paid: 'paid', status: 'status',
        deliveryMode: 'delivery_mode', deliveryDate: 'delivery_date',
        deliveryTime: 'delivery_time', address: 'address', recipientName: 'recipient_name',
        dedication: 'dedication',
        notes: 'notes', campaignId: 'campaign_id', campaignSkuId: 'campaign_sku_id',
      };
      const sets: string[] = [];
      const args: unknown[] = [];
      for (const [key, column] of Object.entries(columns)) {
        const value = (patch as Record<string, unknown>)[key];
        if (value === undefined) continue;
        args.push(value);
        sets.push(`${column} = $${args.length}`);
      }
      if (patch.items !== undefined) {
        args.push(JSON.stringify(patch.items));
        sets.push(`items = $${args.length}::jsonb`);
      }
      if (!sets.length) return orders.get(id);
      args.push(id);
      const row = await one(
        `UPDATE orders SET ${sets.join(', ')}, updated_at = now()
         WHERE id = $${args.length} RETURNING *`,
        args,
      );
      return row ? toOrder(row) : null;
    },
  };

  const campaigns = {
    async listActive(): Promise<Campaign[]> {
      const rows = await q(
        // Faltaba `starts_on`: una campaña cargada con tres semanas de
        // anticipación ya salía como activa, y el contexto del día la anunciaba.
        // El bot ofrecía boxes de una fecha que todavía no había empezado. El
        // panel usa listAll(), así que esto solo cambia lo que ve el bot.
        `SELECT * FROM campaigns
         WHERE active
           AND starts_on <= (now() AT TIME ZONE $1)::date
           AND ends_on   >= (now() AT TIME ZONE $1)::date
         ORDER BY starts_on`,
        [TIMEZONE],
      );
      return rows.map(toCampaign);
    },

    async listAll(): Promise<Campaign[]> {
      const rows = await q('SELECT * FROM campaigns ORDER BY starts_on DESC');
      return rows.map(toCampaign);
    },

    async create(c: Omit<Campaign, 'id' | 'createdAt'>): Promise<Campaign> {
      const row = await one(
        `INSERT INTO campaigns (id, name, starts_on, ends_on, active, pitch)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [newId('camp_'), c.name, c.startsOn, c.endsOn, c.active, c.pitch],
      );
      return toCampaign(row!);
    },

    async setActive(id: string, active: boolean): Promise<void> {
      await exec('UPDATE campaigns SET active = $2 WHERE id = $1', [id, active]);
    },

    async skus(campaignId: string): Promise<CampaignSku[]> {
      const rows = await q(
        'SELECT * FROM campaign_skus WHERE campaign_id = $1 ORDER BY sort_order',
        [campaignId],
      );
      return rows.map(toSku);
    },

    async sku(id: string): Promise<CampaignSku | null> {
      const row = await one('SELECT * FROM campaign_skus WHERE id = $1', [id]);
      return row ? toSku(row) : null;
    },

    async upsertSku(s: Omit<CampaignSku, 'id'> & { id?: string }): Promise<CampaignSku> {
      const row = await one(
        `INSERT INTO campaign_skus (id, campaign_id, name, price, stock_total, stock_used, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price,
           stock_total = EXCLUDED.stock_total, stock_used = EXCLUDED.stock_used,
           sort_order = EXCLUDED.sort_order
         RETURNING *`,
        [s.id ?? newId('sku_'), s.campaignId, s.name, s.price, s.stockTotal, s.stockUsed, s.sortOrder],
      );
      return toSku(row!);
    },

    /**
     * Reserva stock de forma atómica. Devuelve false si no alcanza.
     * El WHERE hace la comprobación y el UPDATE en la misma sentencia, así que
     * dos pedidos simultáneos por la última caja no pueden ganar los dos.
     */
    async reserveStock(skuId: string, quantity: number): Promise<boolean> {
      const changed = await exec(
        `UPDATE campaign_skus SET stock_used = stock_used + $2
         WHERE id = $1 AND stock_used + $2 <= stock_total`,
        [skuId, quantity],
      );
      return changed > 0;
    },

    async releaseStock(skuId: string, quantity: number): Promise<void> {
      await exec(
        `UPDATE campaign_skus SET stock_used = GREATEST(0, stock_used - $2) WHERE id = $1`,
        [skuId, quantity],
      );
    },
  };

  const quickReplies = {
    async list(): Promise<QuickReply[]> {
      const rows = await q('SELECT * FROM quick_replies ORDER BY label');
      return rows.map(toQuickReply);
    },

    async get(key: string): Promise<QuickReply | null> {
      const row = await one('SELECT * FROM quick_replies WHERE key = $1', [key]);
      return row ? toQuickReply(row) : null;
    },

    async upsert(
      qr: Omit<QuickReply, 'usageCount' | 'updatedAt'> & { usageCount?: number },
    ): Promise<QuickReply> {
      const row = await one(
        `INSERT INTO quick_replies (key, label, body, triggers, auto_send, usage_count, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, now())
         ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, body = EXCLUDED.body,
           triggers = EXCLUDED.triggers, auto_send = EXCLUDED.auto_send, updated_at = now()
         RETURNING *`,
        [qr.key, qr.label, qr.body, JSON.stringify(qr.triggers), qr.autoSend, qr.usageCount ?? 0],
      );
      return toQuickReply(row!);
    },

    async countUse(key: string): Promise<void> {
      await exec('UPDATE quick_replies SET usage_count = usage_count + 1 WHERE key = $1', [key]);
    },

    async remove(key: string): Promise<void> {
      await exec('DELETE FROM quick_replies WHERE key = $1', [key]);
    },
  };

  const courses = {
    /** Los cursos, con sus turnos y cuántos lugares quedan en cada uno. */
    async list(opts: { onlyActive?: boolean } = {}): Promise<
      Array<{ course: Course; sessions: CourseSession[] }>
    > {
      const rows = await q(
        `SELECT * FROM courses ${opts.onlyActive ? 'WHERE active' : ''}
         ORDER BY active DESC, created_at DESC`,
        [],
      );
      const cursos = rows.map(toCourse);
      if (!cursos.length) return [];
      /*
        Los cupos tomados salen de un conteo y no de una columna: una columna
        habría que mantenerla sincronizada en cada alta, baja y cancelación, y el
        primer olvido vende el lugar trece. Contar es barato y no se puede
        desincronizar.
      */
      const sesiones = await q(
        `SELECT s.*, COUNT(g.id) FILTER (WHERE g.status <> 'cancelado') AS taken
         FROM course_sessions s
         LEFT JOIN course_signups g ON g.session_id = s.id
         WHERE s.course_id = ANY($1::text[])
         GROUP BY s.id
         ORDER BY s.sort_order`,
        [cursos.map((c) => c.id)],
      );
      return cursos.map((course) => ({
        course,
        sessions: sesiones.filter((r) => String(r.course_id) === course.id).map(toSession),
      }));
    },

    async get(id: string): Promise<Course | null> {
      const row = await one('SELECT * FROM courses WHERE id = $1', [id]);
      return row ? toCourse(row) : null;
    },

    async upsert(
      c: Omit<Course, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    ): Promise<Course> {
      const row = await one(
        `INSERT INTO courses (id, name, description, price, location, modality, image_url, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
           description = EXCLUDED.description, price = EXCLUDED.price,
           location = EXCLUDED.location, modality = EXCLUDED.modality,
           image_url = EXCLUDED.image_url, active = EXCLUDED.active, updated_at = now()
         RETURNING *`,
        [c.id ?? newId('cur_'), c.name, c.description, c.price, c.location, c.modality,
         c.imageUrl, c.active],
      );
      return toCourse(row!);
    },

    async remove(id: string): Promise<void> {
      await exec('DELETE FROM courses WHERE id = $1', [id]);
    },

    async session(id: string): Promise<CourseSession | null> {
      const row = await one(
        `SELECT s.*, COUNT(g.id) FILTER (WHERE g.status <> 'cancelado') AS taken
         FROM course_sessions s
         LEFT JOIN course_signups g ON g.session_id = s.id
         WHERE s.id = $1 GROUP BY s.id`,
        [id],
      );
      return row ? toSession(row) : null;
    },

    async upsertSession(
      s: Omit<CourseSession, 'id' | 'taken'> & { id?: string },
    ): Promise<CourseSession> {
      const row = await one(
        `INSERT INTO course_sessions (id, course_id, label, capacity, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label,
           capacity = EXCLUDED.capacity, sort_order = EXCLUDED.sort_order
         RETURNING *`,
        [s.id ?? newId('tur_'), s.courseId, s.label, s.capacity, s.sortOrder],
      );
      return toSession(row!);
    },

    async removeSession(id: string): Promise<void> {
      await exec('DELETE FROM course_sessions WHERE id = $1', [id]);
    },

    /** La planilla de inscriptos de un curso, en orden de anotación. */
    /**
     * Inscripciones de una charla que todavía esperan la transferencia.
     *
     * Existe para lo mismo que la de pedidos: cuando entra una foto, saber si
     * en esta conversación hay algo esperando un pago que alguien tiene que
     * mirar. Sin esto, el comprobante de un curso llegaba y nadie se enteraba.
     */
    async pendientesDePagoEn(conversationId: string): Promise<CourseSignup[]> {
      const rows = await q(
        `SELECT * FROM course_signups
         WHERE conversation_id = $1 AND status = 'pendiente'
         ORDER BY created_at DESC`,
        [conversationId],
      );
      return rows.map(toSignup);
    },

    async signups(courseId: string): Promise<CourseSignup[]> {
      const rows = await q(
        'SELECT * FROM course_signups WHERE course_id = $1 ORDER BY created_at',
        [courseId],
      );
      return rows.map(toSignup);
    },

    async signup(id: string): Promise<CourseSignup | null> {
      const row = await one('SELECT * FROM course_signups WHERE id = $1', [id]);
      return row ? toSignup(row) : null;
    },

    async createSignup(
      g: Omit<CourseSignup, 'id' | 'createdAt' | 'updatedAt'>,
    ): Promise<CourseSignup> {
      const row = await one(
        `INSERT INTO course_signups (id, course_id, session_id, contact_id, conversation_id,
           full_name, contact_info, total, paid, status, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [newId('ins_'), g.courseId, g.sessionId, g.contactId, g.conversationId, g.fullName,
         g.contactInfo, g.total, g.paid, g.status, g.notes, g.createdBy],
      );
      return toSignup(row!);
    },

    async updateSignup(id: string, patch: Partial<CourseSignup>): Promise<CourseSignup | null> {
      const columns: Record<string, string> = {
        fullName: 'full_name', contactInfo: 'contact_info', total: 'total', paid: 'paid',
        status: 'status', notes: 'notes', sessionId: 'session_id',
      };
      const sets: string[] = [];
      const args: unknown[] = [];
      for (const [key, column] of Object.entries(columns)) {
        const value = (patch as Record<string, unknown>)[key];
        if (value === undefined) continue;
        args.push(value);
        sets.push(`${column} = $${args.length}`);
      }
      if (!sets.length) return courses.signup(id);
      args.push(id);
      const row = await one(
        `UPDATE course_signups SET ${sets.join(', ')}, updated_at = now()
         WHERE id = $${args.length} RETURNING *`,
        args,
      );
      return row ? toSignup(row) : null;
    },

    async removeSignup(id: string): Promise<void> {
      await exec('DELETE FROM course_signups WHERE id = $1', [id]);
    },
  };

  /*
    Archivos: las fotos de producto que sube el equipo, y los adjuntos que mandan
    los clientes —entre ellos el comprobante de la transferencia—.

    El id se saca de `randomBytes` y no de `newId`: la dirección /media/:id se
    sirve SIN token, porque quien la descarga es Telegram o Meta y no tienen forma
    de autenticarse. Mientras del otro lado hubo solo fotos de producto, un id
    medio adivinable no importaba. Ahora del otro lado hay un comprobante bancario
    con nombre, CBU y monto, y `newId` no sirve para eso: sus primeros ocho
    caracteres son la hora en base32 —o sea, se deducen— y los otros ocho salen de
    `Math.random()`, que no es un generador criptográfico y cuyo estado se puede
    reconstruir mirando unas pocas salidas. Estos son 128 bits que no se adivinan.

    Los ids viejos siguen funcionando: acá no se valida el formato, se busca por
    clave primaria.
  */
  /*
    Los dispositivos que quieren recibir un aviso cuando una charla necesita a
    una persona. Es la tabla más chica del sistema —dos o tres filas— y se lee
    entera en cada aviso: no necesita índices ni paginado.
  */
  const push = {
    async guardar(s: {
      endpoint: string;
      p256dh: string;
      auth: string;
      etiqueta: string | null;
    }): Promise<void> {
      /*
        Si el mismo teléfono vuelve a activar los avisos, el navegador devuelve
        el mismo endpoint: se actualizan las claves en vez de duplicar la fila.
        Las claves SÍ pueden cambiar aunque el endpoint sea el mismo.
      */
      await exec(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, etiqueta)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (endpoint) DO UPDATE
           SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, etiqueta = EXCLUDED.etiqueta`,
        [s.endpoint, s.p256dh, s.auth, s.etiqueta],
      );
    },

    async list(): Promise<
      Array<{ endpoint: string; p256dh: string; auth: string; etiqueta: string | null }>
    > {
      const rows = await q('SELECT endpoint, p256dh, auth, etiqueta FROM push_subscriptions');
      return rows.map((r) => ({
        endpoint: String(r.endpoint),
        p256dh: String(r.p256dh),
        auth: String(r.auth),
        etiqueta: str(r.etiqueta),
      }));
    },

    async borrar(endpoint: string): Promise<void> {
      await exec('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
    },

    async marcarOk(endpoint: string): Promise<void> {
      await exec('UPDATE push_subscriptions SET last_ok_at = now() WHERE endpoint = $1', [
        endpoint,
      ]);
    },
  };

  const media = {
    async insert(file: {
      mimeType: string;
      filename: string | null;
      bytes: Buffer;
      /** 'panel' es una foto de producto y no vence; 'cliente' es un adjunto entrante. */
      origin?: 'panel' | 'cliente';
      /** De qué charla vino, cuando es un adjunto entrante. */
      conversationId?: string | null;
    }): Promise<{ id: string }> {
      const id = `m_${randomBytes(16).toString('hex')}`;
      await exec(
        `INSERT INTO media (id, mime_type, filename, bytes, size, origin, conversation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          file.mimeType,
          file.filename,
          file.bytes,
          file.bytes.length,
          file.origin ?? 'panel',
          file.conversationId ?? null,
        ],
      );
      return { id };
    },

    async get(
      id: string,
    ): Promise<{ mimeType: string; filename: string | null; bytes: Buffer } | null> {
      const row = await one('SELECT mime_type, filename, bytes FROM media WHERE id = $1', [id]);
      return row
        ? {
            mimeType: String(row.mime_type),
            filename: row.filename === null ? null : String(row.filename),
            bytes: row.bytes as Buffer,
          }
        : null;
    },

    /**
     * Cuántos bytes lleva guardados una charla en las últimas 24 h.
     *
     * Es el techo diario por cliente. Sin esto, cualquiera que tenga el WhatsApp
     * del local puede mandar archivos hasta llenar la base, y el tope por archivo
     * no lo frena: frena el tamaño de cada uno, no cuántos.
     */
    async bytesRecientesDe(conversationId: string): Promise<number> {
      const row = await one<{ total: string }>(
        `SELECT COALESCE(SUM(size), 0)::text AS total FROM media
         WHERE conversation_id = $1 AND created_at > now() - interval '24 hours'`,
        [conversationId],
      );
      return Number(row?.total ?? 0);
    },

    /**
     * Borra los adjuntos de clientes más viejos que `dias`.
     *
     * El MENSAJE no se borra: sigue diciendo que el cliente mandó una foto, y la
     * charla se lee igual. Lo que vence es el archivo, que después de unos meses
     * ya no le sirve a nadie y es lo único que pesa. Las fotos de producto
     * (`origin = 'panel'`) no se tocan nunca: son parte del catálogo.
     */
    async purgarAdjuntosViejos(dias: number): Promise<number> {
      return exec(
        `DELETE FROM media
         WHERE origin = 'cliente' AND created_at < now() - ($1 || ' days')::interval`,
        [String(dias)],
      );
    },

    /** Cuánto pesa hoy la tabla, para poder mirarlo antes de que la base diga que no. */
    async pesoTotal(): Promise<{ archivos: number; bytes: number }> {
      const row = await one<{ archivos: string; bytes: string }>(
        'SELECT count(*)::text AS archivos, COALESCE(SUM(size), 0)::text AS bytes FROM media',
      );
      return { archivos: Number(row?.archivos ?? 0), bytes: Number(row?.bytes ?? 0) };
    },
  };

  const settings = {
    async read(): Promise<BotSettings> {
      const row = await one<{ value: Partial<BotSettings> }>(
        "SELECT value FROM settings WHERE key = 'bot'",
      );
      return { ...DEFAULT_SETTINGS, ...sinBlancos(row?.value ?? {}) };
    },

    async write(patch: Partial<BotSettings>): Promise<BotSettings> {
      // Se limpia al escribir Y al leer: al escribir para que el blanco no quede
      // guardado, y al leer para curar el que ya está en la base.
      const next = { ...(await settings.read()), ...sinBlancos(patch) };
      await exec(
        `INSERT INTO settings (key, value) VALUES ('bot', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify(next)],
      );
      return next;
    },
  };

  const metrics = {
    /** Serie diaria, agrupada en el huso de Tucumán (no en UTC). */
    async daily(days = 14): Promise<MetricPoint[]> {
      const rows = await q(
        `WITH msg AS (
           SELECT to_char(created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day,
                  direction, conversation_id, handler,
                  COALESCE(input_tokens, 0) AS input_tokens,
                  COALESCE(output_tokens, 0) AS output_tokens,
                  COALESCE(cost_usd, 0) AS cost_usd
           FROM messages
           WHERE created_at >= now() - ($1 || ' days')::interval
         )
         SELECT day,
                COUNT(*) FILTER (WHERE direction = 'in') AS inbound,
                COUNT(*) FILTER (WHERE direction = 'out') AS outbound,
                COUNT(DISTINCT conversation_id) AS conversations,
                COUNT(*) FILTER (WHERE handler = 'escalate') AS handoffs,
                SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(cost_usd) AS cost_usd
         FROM msg GROUP BY day ORDER BY day`,
        [days, TIMEZONE],
      );

      const orderRows = await q<{ day: string; n: string }>(
        `SELECT to_char(created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day, COUNT(*) AS n
         FROM orders WHERE created_at >= now() - ($1 || ' days')::interval
         GROUP BY day`,
        [days, TIMEZONE],
      );
      const ordersByDay = new Map(orderRows.map((r) => [r.day, Number(r.n)]));

      return rows.map((r) => ({
        day: String(r.day),
        inbound: Number(r.inbound ?? 0),
        outbound: Number(r.outbound ?? 0),
        conversations: Number(r.conversations ?? 0),
        handoffs: Number(r.handoffs ?? 0),
        orders: ordersByDay.get(String(r.day)) ?? 0,
        inputTokens: Number(r.input_tokens ?? 0),
        outputTokens: Number(r.output_tokens ?? 0),
        costUsd: Number(r.cost_usd ?? 0),
      }));
    },

    /**
     * Lo que va gastando el bot en el modelo: hoy, este mes, y desde siempre.
     *
     * Existe aparte de `summary()` porque esto se muestra en la barra de arriba
     * del panel, o sea en TODAS las pantallas y en cada recarga: tiene que ser
     * una sola consulta barata y no el paquete entero de métricas, que además
     * arrastra la serie diaria y los intents.
     *
     * Los cortes de día y de mes van en la zona horaria del local, no en UTC:
     * a las 22 de Tucumán ya es el día siguiente en UTC, y el gasto de la noche
     * —que es cuando más escriben— aparecería como de mañana.
     */
    async gasto(): Promise<{ hoy: number; mes: number; historico: number }> {
      const row = await one(
        `SELECT
           COALESCE(SUM(cost_usd) FILTER (
             WHERE (created_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date
           ), 0) AS hoy,
           COALESCE(SUM(cost_usd) FILTER (
             WHERE date_trunc('month', created_at AT TIME ZONE $1)
                 = date_trunc('month', now() AT TIME ZONE $1)
           ), 0) AS mes,
           COALESCE(SUM(cost_usd), 0) AS historico
         FROM messages`,
        [TIMEZONE],
      );
      return {
        hoy: Number(row?.hoy ?? 0),
        mes: Number(row?.mes ?? 0),
        historico: Number(row?.historico ?? 0),
      };
    },

    async intents(days = 14): Promise<Array<{ intent: string; count: number }>> {
      const rows = await q<{ intent: string; n: string }>(
        `SELECT intent, COUNT(*) AS n FROM messages
         WHERE created_at >= now() - ($1 || ' days')::interval AND intent IS NOT NULL
         GROUP BY intent ORDER BY n DESC LIMIT 12`,
        [days],
      );
      return rows.map((r) => ({ intent: r.intent, count: Number(r.n) }));
    },

    async summary() {
      const row = await one(
        `SELECT
           (SELECT COUNT(*) FROM conversations) AS conversations,
           (SELECT COUNT(*) FROM conversations WHERE mode = 'human') AS human_mode,
           (SELECT COUNT(*) FROM conversations WHERE needs_attention) AS needs_attention,
           (SELECT COUNT(*) FROM messages WHERE direction = 'in') AS inbound,
           (SELECT COUNT(*) FROM messages WHERE direction = 'out') AS outbound,
           (SELECT COUNT(*) FROM orders) AS orders,
           (SELECT COUNT(*) FROM orders WHERE status = 'borrador') AS draft_orders,
           (SELECT COALESCE(AVG(latency_ms), 0) FROM messages WHERE latency_ms IS NOT NULL)
             AS avg_latency_ms,
           (SELECT COALESCE(SUM(cost_usd), 0) FROM messages) AS cost_usd,
           (SELECT COUNT(*) FROM messages WHERE error IS NOT NULL) AS errors`,
      );
      return {
        conversations: Number(row?.conversations ?? 0),
        humanMode: Number(row?.human_mode ?? 0),
        needsAttention: Number(row?.needs_attention ?? 0),
        inbound: Number(row?.inbound ?? 0),
        outbound: Number(row?.outbound ?? 0),
        orders: Number(row?.orders ?? 0),
        draftOrders: Number(row?.draft_orders ?? 0),
        avgLatencyMs: Math.round(Number(row?.avg_latency_ms ?? 0)),
        costUsd: Number(row?.cost_usd ?? 0),
        errors: Number(row?.errors ?? 0),
      };
    },
  };

  return {
    contacts, conversations, messages, products, orders, campaigns, courses, quickReplies, push,
    media, settings, metrics,
  };
}

export type Repositories = ReturnType<typeof createRepositories>;

/*
  Campos que el bot le dice al cliente palabra por palabra y que por lo tanto no
  pueden quedar vacíos. Pasó de verdad: alguien guardó Ajustes con el nombre del
  agente en blanco y el saludo salió como "soy , en que te puedo ayudar?". Un
  string vacío no es nulo, así que el merge sobre DEFAULT_SETTINGS lo tomaba como
  un valor legítimo y pisaba el valor bueno.

  No están las URLs ni el modelo a propósito: ahí un vacío puede ser intencional
  ("no tenemos cursos"), y para el modelo ya hay un respaldo en `brain.ts`.
*/
const OBLIGATORIOS = [
  'address',
  'transferAlias',
  'transferHolder',
  'scheduleText',
] as const satisfies ReadonlyArray<keyof BotSettings>;

/** Saca de un parche los obligatorios que vengan en blanco, para que gane el valor por defecto. */
function sinBlancos(patch: Partial<BotSettings>): Partial<BotSettings> {
  const limpio: Partial<BotSettings> = { ...patch };
  for (const campo of OBLIGATORIOS) {
    const valor = limpio[campo];
    if (typeof valor === 'string' && !valor.trim()) delete limpio[campo];
  }
  return limpio;
}

export const DEFAULT_SETTINGS: BotSettings = {
  botEnabled: true,
  activeChannels: ['telegram'],
  // Modelo de OpenRouter. 1M de contexto, soporta tools y reasoning, y cuesta
  // menos de la mitad que Opus con calidad muy parecida para atención.
  model: 'anthropic/claude-sonnet-5',
  effort: 'medium',
  escalateAfterErrors: 2,
  typingMsPerChar: 22,
  maxTypingMs: 3200,
  esperaMs: 4000,
  scheduleText:
    'Lunes a sábado de 8:00 a 13:30 y de 16:00 a 21:30. Entre las 13:00 y las 16:00 ' +
    'atendemos por el carrito de adelante, y también hacemos envíos en esa franja. ' +
    'Domingos de 14:00 a 21:30.',
  openHour: 8,
  closeHour: 22,
  // El local cierra 21:30. De ahi a las 8 el bot atiende pero no toma pedidos.
  pedidosDesde: '08:00',
  pedidosHasta: '21:30',
  address: 'Marcos Paz 473, San Miguel de Tucumán',
  transferAlias: 'MISKATUC',
  transferHolder: 'MISKA MUSKA SAS (Mercado Pago)',
  transferAliasCursos: 'miskamuskacursos',
  transferHolderCursos: 'Marcela Urrea Bianchini',
  webUrl: 'https://www.miskamuska.com.ar',
  coursesUrl: 'https://www.cursos.miskamuska.com.ar',
  breakfastsUrl: 'https://miskamuska.com.ar/product-category/desayunos/',
  cartaUrl: '',
  cartaSubidaEn: '',
  cartaCafeteriaUrl: '',
  /*
    El arranque de la ficha de conocimiento: lo que el local pasó por escrito.
    A partir de acá lo edita el equipo desde Ajustes y este valor no vuelve a
    aparecer nunca —el guardado gana—, así que no hay que mantenerlo al día.

    Sin precios a propósito: los precios están en el catálogo, que es lo que
    cobra. Acá va de qué está hecha cada cosa, que es lo que el catálogo no
    guarda y lo que el cliente pregunta.
  */
  conocimiento: `
Tortas — de qué está hecha cada una. Esto describe el producto; NO dice si hoy hay.
- Matilda: bizcochuelo húmedo de chocolate, rellena y cubierta con crema Bariloche. 10 o 20 porciones.
- 3 Leches: bizcochuelo de vainilla humedecido en tres leches, dulce de leche y crema chantilly, cubierta con crema. 10 o 20 porciones.
- Franui: bizcochuelo de chocolate, dulce de leche y crema de frambuesas. Decorada con crema, drip de chocolate con leche y Franui. 10 o 20 porciones.
- María Luisa: capas crocantes, dulce de leche y nueces, cubierta con merengue italiano. 20 porciones.
- Kinder: bizcochuelo de chocolate, crema Bariloche y crema de Nutella, decorada con Kinder Bueno. 10 o 20 porciones.
- Brownie: brownie con dulce de leche y crema chantilly, con opción de reducción de frutos rojos u Oreo. 10 o 20 porciones.
- Red Velvet: bizcochuelo red velvet, relleno y cubierto con frosting de queso. 10 o 20 porciones.
- Chajá: bizcochuelo de vainilla, dulce de leche, crema y duraznos. 10 o 20 porciones.
- Frutimiska chocolate: bizcochuelo de chocolate, dulce de leche, crema y frutillas. 10 o 20 porciones.
- Frutimiska vainilla: base de vainilla con galletitas, dulce de leche y crema chantilly. 10 o 20 porciones.

Porciones sueltas de torta: no vendemos. Si preguntan por una porción se dice corto y se
ofrece una mini torta o algún individual, para no cortar la venta.

Cafetería. Es SOLO para tomar o retirar en el local: la cafetería no se envía. Está acá para
que sepas qué manejamos y puedas contestar, no para ofrecerla como envío.
- Clásicos: café doble, café americano, latte, mocaccino, capuccino, chocolatada, flat white, té, mate cocido.
- Lattes saborizados: avellana, vainilla, caramelo, pistacho, coco, frambuesa, matcha.
- Cafés fríos y smoothies: iced coffee, iced latte, smoothie de frutos rojos con leche condensada.
- Licuados: banana, frutilla, durazno.
- Juguitos frescos: limonada, limonada de frutos rojos, jugo de naranja, jugo de naranja con mango y maracuyá.
- Bebidas: línea Coca-Cola, aguas saborizadas.
- También tenemos leche deslactosada y de almendras, y cualquier café se puede pedir "iced".
`.trim(),
};
