/**
 * Da por cobrado el período congelado y deja el contador en cero.
 *
 * Se usa una sola vez, el día que el local paga lo que quedó pendiente. Para
 * el cobro normal —el que cierra un período y arranca el siguiente— está
 * `cortar-para-facturar.mts`, que es otra cosa.
 *
 * POR QUÉ NO SIRVE `cortar-para-facturar` ACÁ. Ese mueve el arranque a AHORA, y
 * con un período congelado eso deja el arranque DESPUÉS del cierre: la ventana
 * queda invertida y lo que muestre el panel pasa a ser cualquier cosa. Acá el
 * arranque tiene que ir exactamente al cierre, ni un segundo más allá.
 *
 * Con `cobroDesde` igual a `cobroHasta` la ventana es vacía, el contador da
 * cero y SIGUE CONGELADO, que es lo que corresponde: desde el 14 de octubre de
 * 2026 la API key de OpenRouter la administra el local y lo que consume el bot
 * ya no es deuda nuestra. Si se descongelara dejando el arranque viejo, la
 * deuda ya cobrada volvería a aparecer entera.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/marcar-cobrado.mts
 *   npx tsx --env-file=../../.env.produccion scripts/marcar-cobrado.mts --en-serio
 */
import { openDb, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

const enSerio = process.argv.includes('--en-serio');

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const repos = createRepositories();

const antes = await repos.settings.read();

if (!antes.cobroHasta) {
  console.error(
    '\n  El contador NO está congelado, así que esto no es lo que buscás.\n' +
      '  Para un cobro normal: scripts/cortar-para-facturar.mts\n',
  );
  await closeDb();
  process.exit(1);
}

/*
  hour12 FALSE a mano: Node formatea es-AR en doce horas Y se come el a.m./p.m.
  En una fecha que define qué se cobró y qué no, doce horas no es un detalle.
*/
const fmt = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Tucuman', hour12: false });

const pendiente = await repos.metrics.facturacion(antes.cobroDesde, antes.cobroHasta);

console.log('\n  ╔══ LO QUE SE DA POR COBRADO ════════════════════════════');
console.log(`  ║  desde   ${fmt(antes.cobroDesde)}`);
console.log(`  ║  hasta   ${fmt(antes.cobroHasta)}`);
console.log(`  ║  TURNOS    ${pendiente.turnos.toLocaleString('es-AR')}`);
console.log(`  ║  COBRADO   USD ${pendiente.costoUsd.toFixed(2)}`);
console.log('  ╚════════════════════════════════════════════════════════\n');
console.log(`  El arranque se mueve a ${fmt(antes.cobroHasta)}, igual que el cierre.`);
console.log('  El contador queda en cero y sigue congelado: los tokens los paga el local.\n');

if (!enSerio) {
  console.log('  Esto fue solo la cuenta: NO se tocó nada.');
  console.log('  Para darlo por cobrado de verdad, volvé a correrlo con --en-serio\n');
  await closeDb();
  process.exit(0);
}

const despues = await repos.settings.write({ cobroDesde: antes.cobroHasta });
const final = await repos.metrics.facturacion(despues.cobroDesde, despues.cobroHasta);

const bien = final.costoUsd === 0 && final.turnos === 0 && final.congelado;
console.log(
  `  ${bien ? 'Listo' : 'REVISALO'}: el panel muestra USD ${final.costoUsd.toFixed(2)} ` +
    `(${final.turnos} turnos), congelado=${final.congelado}.`,
);
console.log('  No hace falta deploy: el panel lee los ajustes en cada consulta.\n');

await closeDb();
process.exit(bien ? 0 : 1);
