-- Migración 10 de la base del bot de Miska Muska.
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
-- Migración 10: cuando-se-cobro
-- ========================================================================
-- La caja del día: cuánto se cobró HOY.
--
-- `paid` dice cuánto entró, pero no cuándo, y sin eso la única forma de armar
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

INSERT INTO _migrations (id, name) VALUES (10, 'cuando-se-cobro')
  ON CONFLICT (id) DO NOTHING;
