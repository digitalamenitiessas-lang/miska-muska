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
  {
    id: 2,
    name: 'consulta-de-modificacion-y-quien-recibe',
    sql: `
-- Ninguna modificación de producto la decide el bot, y mientras una persona no la
-- conteste el flujo automático queda en pausa.
--
-- Por qué una columna nueva y no reusar \`mode\`: \`mode\` dice QUIÉN habla, y lo
-- escriben la escalada, la racha de errores y cualquier operador que apriete
-- "Devolver al bot" (que además limpia la alerta). Esto dice QUÉ puede prometer
-- el bot, y tiene que sobrevivir a todo eso.
--
-- jsonb y no cuatro columnas porque el blob lo leen dos lugares (la guarda de
-- crear_pedido y el contexto del día), así crece sin otra migración, y sigue la
-- convención de orders.items y quick_replies.triggers. Sin índice: nadie filtra
-- por esta columna en SQL; el panel filtra en memoria la lista que ya trajo.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pending_review jsonb;

-- Un desayuno sorpresa lo recibe alguien que no es quien compra. Hasta acá ese
-- nombre no tenía dónde vivir: el bot lo pedía y se perdía en la charla.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_name text;

-- El bot ahora consulta los pedidos de la charla en cada turno: para inyectarlos
-- en el contexto del día y para no volver a cargar el mismo pedido.
CREATE INDEX IF NOT EXISTS idx_orders_conversation ON orders (conversation_id, created_at DESC);
`,
  },
  {
    id: 3,
    name: 'deduplicacion-por-conversacion',
    sql: `
-- El id de mensaje de Telegram es correlativo POR CHAT, no global: el chat A y el
-- chat B tienen los dos un mensaje 1, 2, 3. Con el índice único global, el primer
-- mensaje de cada conversación nueva chocaba con un mensaje viejo de otra y se
-- descartaba en silencio como "reintento de webhook". De ahí venía buena parte del
-- "el bot ignora lo que ya le dije" y del "arranca de nuevo".
--
-- No hace falta borrar nada antes: el índice viejo era estrictamente más estricto
-- que este, así que si el par global era único, el par por conversación también.
DROP INDEX IF EXISTS idx_messages_dedupe;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_dedupe ON messages (conversation_id, channel_message_id)
  WHERE channel_message_id IS NOT NULL;
`,
  },
  {
    id: 6,
    name: 'cursos-e-inscriptos',
    sql: `
-- Los cursos viven aparte del catálogo, y no como productos de categoría
-- "cursos", por dos cosas que un producto no sabe expresar: tienen TURNOS (el
-- mismo curso el viernes o el sábado) y cada turno tiene cupos. Un producto es
-- una cosa que se vende N veces; un curso es una fecha con doce lugares.
--
-- Y porque el local los mira aparte: la pantalla de cursos es la planilla de
-- inscriptos, no la carta.
CREATE TABLE courses (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  price       integer NOT NULL DEFAULT 0,
  -- Dónde y cómo: "Barrio Norte", "presencial" u "online".
  location    text,
  modality    text NOT NULL DEFAULT 'presencial'
                CHECK (modality IN ('presencial', 'online')),
  image_url   text,
  -- Apagado = el bot no lo ofrece. Es el interruptor de la carta, para cursos.
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_courses_active ON courses (active, created_at DESC);

-- Un turno del curso. La fecha va como texto porque el equipo la escribe como la
-- dice ("viernes 11/9, 17 hs") y esa cadena es la que ve el cliente; el orden lo
-- da sort_order. Guardarla como timestamp obligaría a inventar zona horaria y
-- formato para algo que nadie va a consultar por rango.
CREATE TABLE course_sessions (
  id         text PRIMARY KEY,
  course_id  text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  label      text NOT NULL,
  capacity   integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_course_sessions ON course_sessions (course_id, sort_order);

-- La planilla de inscriptos: una fila por persona anotada. Es el "ticket" del
-- curso, y las columnas son las de la planilla que ya usa el local.
CREATE TABLE course_signups (
  id              text PRIMARY KEY,
  course_id       text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  session_id      text REFERENCES course_sessions(id) ON DELETE SET NULL,
  contact_id      text REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id text REFERENCES conversations(id) ON DELETE SET NULL,
  full_name       text NOT NULL,
  -- Celular o Instagram, como en la planilla: el equipo escribe lo que tenga.
  contact_info    text,
  total           integer NOT NULL DEFAULT 0,
  paid            integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pendiente'
                    CHECK (status IN ('pendiente', 'inscripto', 'cancelado')),
  notes           text,
  created_by      text NOT NULL DEFAULT 'bot',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_course_signups ON course_signups (course_id, created_at);
CREATE INDEX idx_course_signups_session ON course_signups (session_id);
`,
  },
  {
    id: 5,
    name: 'archivos-subidos',
    sql: `
-- Fotos subidas desde el panel. Van en la base y no en el disco del servidor a
-- propósito: el bot no guarda nada en disco, y por eso el proceso es
-- descartable — se puede borrar y recrear sin perder nada. Guardarlas en /opt
-- rompería justo esa propiedad, y la primera vez que alguien recree el
-- contenedor se quedaría sin fotos y sin saber por qué.
--
-- El límite del cuerpo del servidor ya está en 5 MB, que es también el máximo
-- que acepta Meta para una imagen, así que no hace falta otra restricción acá.
CREATE TABLE media (
  id         text PRIMARY KEY,
  mime_type  text NOT NULL,
  filename   text,
  bytes      bytea NOT NULL,
  size       integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    id: 4,
    name: 'foto-de-producto',
    sql: `
-- La foto del producto, como URL pública. No se guarda el archivo: los dos
-- canales aceptan un link y lo descargan ellos (Telegram con sendPhoto, WhatsApp
-- Cloud API con image.link), así que guardar la URL es lo único que funciona
-- igual en los dos y sobrevive al cambio de canal sin resubir nada.
--
-- Meta exige que sea HTTPS y públicamente accesible, y no acepta cualquier
-- formato. Eso se valida al mandarla, no acá: una restricción en la base
-- rechazaría la fila sin poder explicarle nada a nadie.
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text;
`,
  },
  {
    id: 7,
    name: 'adjuntos-de-clientes',
    sql: `
-- La tabla media nació para las fotos de producto: unas decenas de archivos que
-- sube el equipo a mano y que no se borran nunca. Desde que también guarda lo que
-- MANDAN los clientes —el comprobante de la transferencia, sobre todo— entra un
-- archivo por mensaje, todos los días, y eso ya no puede vivir para siempre en
-- una base chica.
--
-- Estas dos columnas son lo que hace falta para distinguirlos y poder limpiarlos:
--
--   origin           'panel' es una foto de producto y no se toca nunca.
--                    'cliente' es un adjunto entrante y vence.
--   conversation_id  de quién vino. Sirve para dos cosas: ponerle un techo diario
--                    a cada charla, y poder borrar lo de una persona si lo pide.
--
-- El default 'panel' es el correcto para todo lo que ya está guardado: hasta hoy
-- lo único que entraba acá eran fotos de producto.
ALTER TABLE media ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'panel';
ALTER TABLE media ADD COLUMN IF NOT EXISTS conversation_id text;

-- La limpieza pregunta por origen y fecha; el techo diario, por conversación y
-- fecha. Sin estos índices las dos tendrían que leer entera la tabla más pesada
-- de la base.
CREATE INDEX IF NOT EXISTS idx_media_origen_fecha ON media (origin, created_at);
CREATE INDEX IF NOT EXISTS idx_media_charla_fecha ON media (conversation_id, created_at);
`,
  },
  {
    id: 8,
    name: 'avisos-al-celular',
    sql: `
-- Los celulares que pidieron recibir un aviso cuando una charla necesita a una
-- persona. Una fila por DISPOSITIVO y no por usuario: la misma chica atendiendo
-- desde el celular y desde la compu del mostrador son dos suscripciones, y cada
-- una se muere por su cuenta cuando desinstalan la app o revocan el permiso.
--
-- El endpoint es la dirección que da el navegador, única por dispositivo y por
-- navegador, así que es la clave natural. Si alguien vuelve a activar los avisos
-- en el mismo teléfono, el navegador devuelve el mismo endpoint y la fila se
-- actualiza en vez de duplicarse.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint    text PRIMARY KEY,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  -- Para distinguir un dispositivo de otro cuando haya que desactivar uno.
  etiqueta    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Última vez que el servicio de push aceptó un aviso para este dispositivo.
  last_ok_at  timestamptz
);
`,
  },
  {
    id: 9,
    name: 'orden-de-la-bandeja',
    sql: `
-- La bandeja pasó a ordenarse por la última actividad de la charla y no por
-- cuándo se tocó la fila, así que el índice de updated_at ya no lo usa nadie y
-- este es el que hace falta.
--
-- Por qué el cambio: updated_at lo bumpea cualquier escritura sobre la
-- conversación —marcarla para atención, tomarla, abrir una consulta—, y con eso
-- una charla vieja saltaba arriba de una con un mensaje recién llegado.
--
-- El índice es sobre la misma expresión del ORDER BY, si no no se usa. GREATEST
-- y COALESCE son inmutables sobre timestamptz, así que Postgres la acepta.
CREATE INDEX IF NOT EXISTS idx_conversations_actividad ON conversations (
  GREATEST(COALESCE(last_inbound_at, created_at), COALESCE(last_outbound_at, created_at)) DESC
);

-- Ya no lo usa ninguna consulta, y cada índice de más es trabajo en cada
-- escritura: en un pico de mensajes eso se paga en todas las filas que cambian.
DROP INDEX IF EXISTS idx_conversations_updated;
`,
  },
  {
    id: 10,
    name: 'cuando-se-cobro',
    sql: `
-- La caja del día: cuánto se cobró HOY.
--
-- \`paid\` dice cuánto entró, pero no cuándo, y sin eso la única forma de armar
-- una caja diaria era sumar por fecha de creación. Eso da mal justo en el caso
-- que importa: un pedido de ayer que se cobra hoy es plata de hoy, y una seña de
-- hoy por una torta del sábado también.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- Los que ya estaban cobrados se rellenan con updated_at, que es lo más cercano
-- que hay: el pago casi siempre fue la última escritura de la fila. Es una
-- aproximación y solo para lo viejo; de acá en adelante el dato es exacto.
UPDATE orders SET paid_at = updated_at WHERE paid > 0 AND paid_at IS NULL;

-- La caja se consulta por día, y siempre del lado de las filas recientes.
CREATE INDEX IF NOT EXISTS idx_orders_paid_at ON orders (paid_at DESC) WHERE paid_at IS NOT NULL;
`,
  },
];

/**
 * Una migración sola, con su registro en `_migrations`, para correrla a mano
 * desde el editor SQL de Supabase.
 *
 * El `INSERT` final no es decorativo: si se corre el SQL sin registrarlo, el
 * servidor la ve como pendiente y la vuelve a aplicar al arrancar. Las de la 2 en
 * adelante están escritas con `IF NOT EXISTS` justamente porque se corren a mano,
 * así que ese caso no rompe el arranque — pero el registro es lo que hace que el
 * estado de la base y el de `_migrations` coincidan.
 */
export function migrationSql(migration: Migration): string {
  return (
    `-- ${'='.repeat(72)}\n-- Migración ${migration.id}: ${migration.name}\n` +
    `-- ${'='.repeat(72)}\n${migration.sql.trim()}\n\n` +
    `INSERT INTO _migrations (id, name) VALUES (${migration.id}, '${migration.name}')\n` +
    '  ON CONFLICT (id) DO NOTHING;\n'
  );
}

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

  const body = MIGRATIONS.map(migrationSql).join('\n');

  return `${header}\n${body}`;
}
