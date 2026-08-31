-- Migración 8 de la base del bot de Miska Muska.
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
-- Migración 8: avisos-al-celular
-- ========================================================================
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

INSERT INTO _migrations (id, name) VALUES (8, 'avisos-al-celular')
  ON CONFLICT (id) DO NOTHING;
