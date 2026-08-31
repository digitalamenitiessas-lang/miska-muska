-- Migración 9 de la base del bot de Miska Muska.
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
-- Migración 9: orden-de-la-bandeja
-- ========================================================================
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

INSERT INTO _migrations (id, name) VALUES (9, 'orden-de-la-bandeja')
  ON CONFLICT (id) DO NOTHING;
