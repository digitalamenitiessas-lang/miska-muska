-- Migración 7 de la base del bot de Miska Muska.
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
-- Migración 7: adjuntos-de-clientes
-- ========================================================================
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

INSERT INTO _migrations (id, name) VALUES (7, 'adjuntos-de-clientes')
  ON CONFLICT (id) DO NOTHING;
