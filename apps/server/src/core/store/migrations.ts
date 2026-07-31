/**
 * Esquema en Postgres. Se aplica solo al arrancar, y también se puede volcar a
 * un archivo para pegarlo en el editor SQL de Supabase (`npm run db:sql`).
 *
 * Diferencias a propósito con la versión de SQLite que reemplaza:
 *  - `timestamptz` en vez de texto ISO. Esto arregla de raíz el bug de zona
 *    horaria: las fechas se comparan en el huso de Tucumán, no en UTC.
 *  - `boolean` en vez de 0/1.
 *  - `jsonb` para los items del pedido y los disparadores.
 *  - una SEQUENCE para el número de pedido, en vez de `MAX(number) + 1`, que con
 *    dos pedidos simultáneos podía repetir el número.
 */

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'esquema-inicial',
    sql: `
CREATE TABLE contacts (
  id            text PRIMARY KEY,
  channel       text NOT NULL,
  external_id   text NOT NULL,
  display_name  text,
  username      text,
  phone         text,
  full_name     text,
  dni           text,
  notes         text,
  is_returning  boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, external_id)
);

CREATE TABLE conversations (
  id                   text PRIMARY KEY,
  channel              text NOT NULL,
  external_id          text NOT NULL,
  contact_id           text NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  mode                 text NOT NULL DEFAULT 'bot'
                         CHECK (mode IN ('bot', 'human', 'muted')),
  last_intent          text,
  last_inbound_at      timestamptz,
  last_outbound_at     timestamptz,
  last_message_preview text,
  unread_count         integer NOT NULL DEFAULT 0,
  needs_attention      boolean NOT NULL DEFAULT false,
  attention_reason     text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, external_id)
);
CREATE INDEX idx_conversations_updated ON conversations (updated_at DESC);
CREATE INDEX idx_conversations_attention ON conversations (needs_attention)
  WHERE needs_attention;

CREATE TABLE messages (
  id                 text PRIMARY KEY,
  conversation_id    text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  channel            text NOT NULL,
  channel_message_id text,
  direction          text NOT NULL CHECK (direction IN ('in', 'out')),
  author             text NOT NULL CHECK (author IN ('bot', 'human', 'system')),
  content_kind       text NOT NULL,
  text               text NOT NULL,
  payload            jsonb,
  intent             text,
  handler            text,
  latency_ms         integer,
  input_tokens       integer,
  output_tokens      integer,
  cache_read_tokens  integer,
  -- OpenRouter devuelve el costo real de cada llamada. Lo guardamos para que el
  -- panel muestre plata y no solo tokens.
  cost_usd           numeric(12, 8),
  model              text,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at);
CREATE INDEX idx_messages_created ON messages (created_at);
-- Deduplicación de reintentos de webhook. Los salientes tienen
-- channel_message_id NULL, y Postgres permite varios NULL en un índice único.
CREATE UNIQUE INDEX idx_messages_dedupe ON messages (channel, channel_message_id)
  WHERE channel_message_id IS NOT NULL;

CREATE TABLE products (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  category        text NOT NULL,
  price           integer NOT NULL,
  available_today boolean NOT NULL DEFAULT true,
  limited_edition boolean NOT NULL DEFAULT false,
  pickup_only     boolean NOT NULL DEFAULT false,
  notes           text,
  sort_order      integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_category ON products (category, sort_order);

CREATE TABLE campaigns (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  pitch      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign_skus (
  id          text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name        text NOT NULL,
  price       integer NOT NULL,
  stock_total integer NOT NULL DEFAULT 0,
  stock_used  integer NOT NULL DEFAULT 0,
  sort_order  integer NOT NULL DEFAULT 0,
  -- Nunca se puede comprometer más stock del que se produjo.
  CONSTRAINT stock_no_negativo CHECK (stock_used >= 0 AND stock_used <= stock_total)
);
CREATE INDEX idx_campaign_skus ON campaign_skus (campaign_id, sort_order);

-- El primer pedido arranca en 3069 para seguir la numeración que ya usa el local.
CREATE SEQUENCE order_number_seq START WITH 3069 INCREMENT BY 1;

CREATE TABLE orders (
  id              text PRIMARY KEY,
  number          integer NOT NULL UNIQUE DEFAULT nextval('order_number_seq'),
  conversation_id text REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id      text REFERENCES contacts(id) ON DELETE SET NULL,
  customer_name   text NOT NULL,
  customer_dni    text,
  customer_phone  text,
  items           jsonb NOT NULL DEFAULT '[]'::jsonb,
  total           integer NOT NULL DEFAULT 0,
  paid            integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'borrador'
                    CHECK (status IN ('borrador', 'confirmado', 'en-preparacion',
                                      'listo', 'entregado', 'cancelado')),
  delivery_mode   text NOT NULL DEFAULT 'retira-local'
                    CHECK (delivery_mode IN ('retira-local', 'uber-cliente', 'cadete-miska')),
  delivery_date   date,
  delivery_time   text,
  address         text,
  dedication      text,
  notes           text,
  campaign_id     text REFERENCES campaigns(id) ON DELETE SET NULL,
  campaign_sku_id text REFERENCES campaign_skus(id) ON DELETE SET NULL,
  created_by      text NOT NULL DEFAULT 'bot',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_status ON orders (status, delivery_date);
CREATE INDEX idx_orders_contact ON orders (contact_id);

CREATE TABLE quick_replies (
  key         text PRIMARY KEY,
  label       text NOT NULL,
  body        text NOT NULL,
  triggers    jsonb NOT NULL DEFAULT '[]'::jsonb,
  auto_send   boolean NOT NULL DEFAULT false,
  usage_count integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
`,
  },
];

/** SQL completo, para pegar en el editor de Supabase. */
export function schemaSql(): string {
  const header = [
    '-- Esquema de la base del bot de Miska Muska.',
    '-- Generado con `npm run db:sql`. No editar a mano: editá migrations.ts.',
    '--',
    '-- El servidor aplica esto solo al arrancar. Este archivo existe para poder',
    '-- revisarlo, versionarlo, o correrlo desde el editor SQL de Supabase.',
    '',
    'CREATE TABLE IF NOT EXISTS _migrations (',
    '  id         integer PRIMARY KEY,',
    '  name       text NOT NULL,',
    '  applied_at timestamptz NOT NULL DEFAULT now()',
    ');',
    '',
  ].join('\n');

  const body = MIGRATIONS.map(
    (m) =>
      `-- ${'='.repeat(72)}\n-- Migración ${m.id}: ${m.name}\n-- ${'='.repeat(72)}\n${m.sql.trim()}\n\n` +
      `INSERT INTO _migrations (id, name) VALUES (${m.id}, '${m.name}')\n  ON CONFLICT (id) DO NOTHING;\n`,
  ).join('\n');

  return `${header}\n${body}`;
}
