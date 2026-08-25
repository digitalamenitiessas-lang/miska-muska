-- Migración 4 de la base del bot de Miska Muska.
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
-- Migración 4: foto-de-producto
-- ========================================================================
-- La foto del producto, como URL pública. No se guarda el archivo: los dos
-- canales aceptan un link y lo descargan ellos (Telegram con sendPhoto, WhatsApp
-- Cloud API con image.link), así que guardar la URL es lo único que funciona
-- igual en los dos y sobrevive al cambio de canal sin resubir nada.
--
-- Meta exige que sea HTTPS y públicamente accesible, y no acepta cualquier
-- formato. Eso se valida al mandarla, no acá: una restricción en la base
-- rechazaría la fila sin poder explicarle nada a nadie.
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text;

INSERT INTO _migrations (id, name) VALUES (4, 'foto-de-producto')
  ON CONFLICT (id) DO NOTHING;
