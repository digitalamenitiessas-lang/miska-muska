-- Migración 5 de la base del bot de Miska Muska.
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
-- Migración 5: archivos-subidos
-- ========================================================================
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

INSERT INTO _migrations (id, name) VALUES (5, 'archivos-subidos')
  ON CONFLICT (id) DO NOTHING;
