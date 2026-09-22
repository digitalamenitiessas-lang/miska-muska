/**
 * Saca los rellenos que quedaron guardados como nombre.
 *
 * El arreglo de `nombreUsable` impide que entren nuevos; esto limpia los que
 * ya están. Se corrió una vez, el 22/09/2026, sobre los 26 contactos y 28
 * pedidos que el rescate del comprobante marcó entre el 13 y el 22 de
 * septiembre.
 *
 * QUÉ HACE CON CADA UNO:
 *   - contacto: el nombre cargado se borra y queda `null`, así el panel vuelve
 *     a mostrar el del perfil de WhatsApp, que nunca se perdió.
 *   - pedido: se le pone el nombre del perfil si sirve. Si no hay, queda
 *     "Sin nombre", que es lo que el panel ya usa en otros lados y por lo menos
 *     no parece un error del sistema en una comanda.
 *
 * En seco por defecto. Para aplicarlo de verdad hay que pasarle --aplicar.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/limpiar-nombres-relleno.mts
 *   npx tsx --env-file=../../.env.produccion scripts/limpiar-nombres-relleno.mts --aplicar
 */
import { openDb, q, exec, closeDb } from '../src/core/store/db.js';
import { nombreUsable } from '../src/core/policies/nombres.js';
import { nombreDeWhatsApp } from '../src/core/policies/rules.js';

const APLICAR = process.argv.includes('--aplicar');

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

console.log(APLICAR ? '\n  APLICANDO LOS CAMBIOS\n' : '\n  EN SECO — no se escribe nada\n');

/* ---------------- Contactos ---------------- */
const contactos = await q<{ id: string; display_name: string; full_name: string }>(
  `select id, coalesce(display_name,'') display_name, full_name
     from contacts where full_name is not null and full_name = '<UNKNOWN>'
    order by last_seen_at desc`,
);

console.log(`  ${contactos.length} contactos con el nombre tapado:\n`);
for (const c of contactos) {
  const vuelveA = nombreUsable(c.display_name) ?? '(el teléfono)';
  console.log(`    "${c.full_name}"  →  se borra, el panel mostrará "${vuelveA}"`);
}

if (APLICAR && contactos.length) {
  const n = await exec(
    `update contacts set full_name = null where full_name = '<UNKNOWN>'`,
    [],
  );
  console.log(`\n  ${n} contactos limpiados.`);
}

/* ---------------- Pedidos ---------------- */
const pedidos = await q<{ id: string; number: string; display_name: string }>(
  `select o.id, o.number::text, coalesce(ct.display_name,'') display_name
     from orders o left join contacts ct on ct.id = o.contact_id
    where o.customer_name = '<UNKNOWN>'
    order by o.number`,
);

console.log(`\n  ${pedidos.length} pedidos con el nombre tapado:\n`);
let arreglados = 0;
for (const p of pedidos) {
  const perfil = nombreDeWhatsApp(p.display_name);
  const nuevo = perfil?.nombre ?? 'Sin nombre';
  console.log(`    #${p.number}  →  "${nuevo}"`);
  if (APLICAR) {
    await exec(`update orders set customer_name = $2 where id = $1`, [p.id, nuevo]);
    arreglados++;
  }
}
if (APLICAR) console.log(`\n  ${arreglados} pedidos corregidos.`);

if (!APLICAR) {
  console.log('\n  Nada de esto se escribió. Con --aplicar se hace de verdad.\n');
}

await closeDb();
