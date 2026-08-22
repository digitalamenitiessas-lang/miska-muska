-- Migración 2 de la base del bot de Miska Muska.
-- Generado con `npm run db:sql`. No editar a mano: editá migrations.ts.
--
-- Para correrla a mano en el editor SQL de Supabase: pegá todo, incluido el
-- INSERT del final, que es lo que le dice al servidor que ya está aplicada.

CREATE TABLE IF NOT EXISTS _migrations (
  id         integer PRIMARY KEY,
  name       text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- ========================================================================
-- Migración 2: consulta-de-modificacion-y-quien-recibe
-- ========================================================================
-- Ninguna modificación de producto la decide el bot, y mientras una persona no la
-- conteste el flujo automático queda en pausa.
--
-- Por qué una columna nueva y no reusar `mode`: `mode` dice QUIÉN habla, y lo
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

INSERT INTO _migrations (id, name) VALUES (2, 'consulta-de-modificacion-y-quien-recibe')
  ON CONFLICT (id) DO NOTHING;
