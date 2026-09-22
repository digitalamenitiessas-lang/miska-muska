/**
 * El filtro de rellenos, contra los nombres reales de las clientas.
 *
 * Lo que hay que medir acá NO es que atrape `<UNKNOWN>` —eso es una línea—.
 * Es que no se lleve puesto ni un nombre de verdad. La base tiene más de tres
 * mil contactos con nombres de WhatsApp: apodos de una letra, emojis solos,
 * nombres de negocios. Si el filtro descarta uno de esos, el panel pierde el
 * nombre de una clienta, que es exactamente el problema que vino a arreglar.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-nombre-usable.mts
 */
import { openDb, q, closeDb } from '../src/core/store/db.js';
import { nombreUsable } from '../src/core/policies/nombres.js';
import { nombreDeWhatsApp } from '../src/core/policies/rules.js';

let mal = 0;
const chequear = (ok: boolean, nota: string): void => {
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${nota}`);
};

console.log('\n  Los rellenos que hay que atrapar\n');

chequear(nombreUsable('<UNKNOWN>') === null, 'el caso real: <UNKNOWN>');
chequear(nombreUsable('<sin nombre>') === null, 'entre ángulos, en castellano');
chequear(nombreUsable('[desconocido]') === null, 'entre corchetes');
chequear(nombreUsable('unknown') === null, 'suelto y en minúscula');
chequear(nombreUsable('DESCONOCIDO') === null, 'en mayúsculas');
chequear(nombreUsable('Sin nombre') === null, 'con mayúscula inicial');
chequear(nombreUsable('N/A') === null, 'la abreviatura');
chequear(nombreUsable('  ') === null, 'solo espacios');
chequear(nombreUsable('') === null, 'vacío');
chequear(nombreUsable(null) === null, 'nulo');
chequear(nombreUsable(undefined) === null, 'sin definir');
chequear(nombreUsable('-') === null, 'un guion solo');

console.log('\n  Los nombres que NO se tocan\n');

chequear(nombreUsable('Pauly Menéndez') === 'Pauly Menéndez', 'un nombre normal, con tilde');
chequear(nombreUsable('  Ana Robles  ') === 'Ana Robles', 'se le sacan los espacios de los bordes');
chequear(nombreUsable('L') === 'L', 'una sola letra: hay clientas que se llaman así en WhatsApp');
chequear(nombreUsable('jo pino') === 'jo pino', 'en minúsculas');
chequear(nombreUsable('💫S💫') === '💫S💫', 'con emojis: es un nombre de perfil real');
chequear(nombreUsable('Un Paso Más Calzados') === 'Un Paso Más Calzados', 'un negocio');
chequear(nombreUsable("O'Brien") === "O'Brien", 'con apóstrofo');
chequear(nombreUsable('Ana (la vecina)') === 'Ana (la vecina)', 'con paréntesis adentro, no alrededor');
chequear(nombreUsable('Naiara') === 'Naiara', 'uno cualquiera');

/* --------------------------------------------------------------------- */

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

/*
  Y ahora lo que importa de verdad: pasarle TODOS los nombres que hay guardados
  y ver a cuáles les diría que no. Los únicos que deberían caer son los rellenos.
*/
const nombres = await q<{ n: string; cuantos: string }>(
  `select display_name n, count(*)::text cuantos
     from contacts where display_name is not null and display_name <> ''
    group by 1`,
);

const rechazados = nombres.filter((x) => nombreUsable(x.n) === null);
const esperados = new Set(['<UNKNOWN>']);

console.log(`\n  Corpus real: ${nombres.length} nombres distintos de WhatsApp\n`);
console.log(`  el filtro rechaza ${rechazados.length}:`);
for (const r of rechazados) {
  const ok = esperados.has(r.n) || /^[+]?[\d\s()-]+$/.test(r.n);
  if (!ok) mal++;
  console.log(`    ${ok ? '✓' : '✗ ESTE ES UN NOMBRE DE VERDAD'} "${r.n}"`);
}
if (!rechazados.length) console.log('    (ninguno)');

/*
  LA PREGUNTA QUE CASI ME COME: ¿el rescate del comprobante sigue cargando?

  El relleno tiene nueve caracteres, así que pasaba el mínimo de tres de
  `datosFaltantes` y ERA lo que dejaba entrar esos pedidos. Descartarlo sin poner
  nada en su lugar los habría rechazado a todos, y el rescate es lo que subió la
  carga de pedidos del 21% al 86%.

  Por eso el camino forzado usa el nombre del perfil. Acá se mide sobre los casos
  reales: de los que se cargaron con relleno, ¿a cuántos les sirve el perfil?
*/
const conRelleno = await q<{ number: string; display_name: string }>(
  `select o.number::text, coalesce(ct.display_name,'') display_name
     from orders o left join contacts ct on ct.id = o.contact_id
    where o.customer_name = '<UNKNOWN>'`,
);
if (conRelleno.length) {
  const conPerfil = conRelleno.filter((o) => nombreDeWhatsApp(o.display_name)?.nombre);
  console.log(
    `\n  De los ${conRelleno.length} pedidos que se cargaron con relleno, ${conPerfil.length} ` +
      `tienen nombre de perfil usable:`,
  );
  console.log(
    `    ${conPerfil.length} se seguirían cargando, ahora con el nombre de verdad.`,
  );
  const sinNada = conRelleno.length - conPerfil.length;
  console.log(
    `    ${sinNada} quedarían sin cargar y saltaría el cartel de "cargalo a mano",` +
      ' que es lo correcto cuando de verdad no sabemos quién es.',
  );
  // Si el perfil no sirviera casi nunca, el arreglo rompería más de lo que cura.
  if (conPerfil.length < conRelleno.length / 2) {
    mal++;
    console.log('    ✗ el perfil no alcanza para la mayoría: esto rompería el rescate.');
  }
}

/* Los que ya quedaron mal guardados, para saber cuántos hay que limpiar. */
const sucios = await q<{ contactos: string; pedidos: string }>(
  `select (select count(*) from contacts where full_name = '<UNKNOWN>')::text contactos,
          (select count(*) from orders where customer_name = '<UNKNOWN>')::text pedidos`,
);
console.log(
  `\n  Pendiente de limpiar: ${sucios[0].contactos} contactos y ${sucios[0].pedidos} pedidos ` +
    'que ya quedaron marcados.',
);

console.log(mal ? `\n  ${mal} fallaron.\n` : '\n  Pasa todo: atrapa los rellenos y no toca un nombre.\n');
await closeDb();
process.exit(mal ? 1 : 0);
