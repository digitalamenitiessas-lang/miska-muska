-- Migración 3 de la base del bot de Miska Muska.
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
-- Migración 3: deduplicacion-por-conversacion
-- ========================================================================
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

INSERT INTO _migrations (id, name) VALUES (3, 'deduplicacion-por-conversacion')
  ON CONFLICT (id) DO NOTHING;
