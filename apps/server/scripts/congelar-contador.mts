/**
 * Detiene para siempre el contador de lo que el local nos debe por el modelo.
 *
 * POR QUÉ EXISTE: el 14 de octubre de 2026 la API key de OpenRouter pasó a
 * administrarla el local. Desde ese momento el consumo del modelo lo paga la
 * cuenta de ellos y ya no hay nada que cobrarles — pero lo de ANTES sí, y
 * tiene que quedar quieto y a la vista hasta que se cobre.
 *
 * POR QUÉ NO ALCANZA CON MOVER `cobroDesde`: eso arranca un período nuevo, y
 * arrancar un período nuevo borra la deuda vieja. Son dos cosas distintas
 * —cerrar un período para facturarlo, y dejar de contar para siempre— y
 * mezclarlas pierde plata en un caso o la inventa en el otro. Por eso el corte
 * de cierre es un campo aparte.
 *
 * EL INSTANTE NO ES "AHORA", Y ACÁ ESTÁ TODO EL CUIDADO. El límite real es el
 * momento en que el servidor arrancó con la key nueva: los turnos de antes los
 * pagó nuestra cuenta y los de después, la de ellos. Si se congela unos
 * minutos antes del reinicio, los turnos del medio los pagamos nosotros y no
 * se los cobramos a nadie; unos minutos después, le cobramos al local turnos
 * que ya pagó con su propia key. Por eso se puede pasar el instante a mano:
 *
 *   npx tsx --env-file=../../.env.produccion scripts/congelar-contador.mts
 *   npx tsx --env-file=../../.env.produccion scripts/congelar-contador.mts --en=2026-10-14T22:05:00Z
 *   npx tsx --env-file=../../.env.produccion scripts/congelar-contador.mts --en-serio
 *
 * Sin `--en-serio` solo muestra la cuenta y no toca nada.
 * Con `--descongelar` borra el corte y el contador vuelve a correr.
 */
import { openDb, q, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

const enSerio = process.argv.includes('--en-serio');
const descongelar = process.argv.includes('--descongelar');
const elegido = process.argv.find((a) => a.startsWith('--en='))?.slice('--en='.length);

if (elegido && Number.isNaN(Date.parse(elegido))) {
  console.error(`\n  No entiendo la fecha "${elegido}". Usá ISO: 2026-10-14T22:05:00Z\n`);
  process.exit(1);
}

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const repos = createRepositories();

const antes = await repos.settings.read();

/*
  hour12 FALSE a mano, por lo mismo que en cortar-para-facturar: Node formatea
  es-AR en doce horas Y se come el a.m./p.m., así que las 14:25 se imprimían
  "02:25". En una fecha que define quién paga qué, doce horas no es un detalle.
*/
const fmt = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Tucuman', hour12: false });

if (descongelar) {
  if (!antes.cobroHasta) {
    console.log('\n  El contador ya estaba corriendo: no había corte de cierre.\n');
    await closeDb();
    process.exit(0);
  }
  console.log(`\n  El corte de cierre era ${fmt(antes.cobroHasta)}.`);
  if (!enSerio) {
    console.log('  Esto fue solo la cuenta: NO se tocó nada.');
    console.log('  Para borrarlo de verdad, volvé a correrlo con --en-serio\n');
    await closeDb();
    process.exit(0);
  }
  /*
    `write` limpia los blancos antes de guardar, así que mandar '' NO borraría
    el corte: lo dejaría como está. Se borra con SQL sobre el JSON.
  */
  await q(
    `UPDATE settings SET value = (value - 'cobroHasta') WHERE key = 'bot'`,
    [],
  );
  const ahora = await repos.settings.read();
  console.log(
    `  ${ahora.cobroHasta ? 'NO pude borrarlo: sigue en ' + fmt(ahora.cobroHasta) : 'Borrado: el contador vuelve a correr.'}\n`,
  );
  await closeDb();
  process.exit(ahora.cobroHasta ? 1 : 0);
}

const desde = antes.cobroDesde;
if (!desde) {
  console.error('\n  No hay corte de arranque cargado. Revisalo en Ajustes antes de seguir.\n');
  await closeDb();
  process.exit(1);
}

const corte = elegido ? new Date(elegido).toISOString() : new Date().toISOString();

const [cuenta] = await q<any>(
  `SELECT COALESCE(SUM(cost_usd), 0) AS costo, COUNT(*) AS turnos
     FROM model_turns
    WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz`,
  [desde, corte],
);

/*
  Lo que queda del otro lado del corte. No se cobra —es de la key del local—
  pero se muestra, porque es la forma de ver que el corte quedó donde tenía que
  quedar. Si acá aparecen cien turnos, el corte se puso tarde.
*/
const [despuesDelCorte] = await q<any>(
  `SELECT COALESCE(SUM(cost_usd), 0) AS costo, COUNT(*) AS turnos
     FROM model_turns WHERE created_at >= $1::timestamptz`,
  [corte],
);

const dias = (Date.parse(corte) - Date.parse(desde)) / 86_400_000;

console.log('\n  ╔══ LO QUE QUEDA ADEUDADO, Y NO SE MUEVE MÁS ════════════');
console.log(`  ║  desde   ${fmt(desde)}`);
console.log(`  ║  hasta   ${fmt(corte)}${elegido ? '  (a mano)' : '  (ahora)'}`);
console.log(`  ║  son     ${dias.toFixed(1)} días`);
console.log('  ║');
console.log(`  ║  TURNOS    ${Number(cuenta.turnos).toLocaleString('es-AR')}`);
console.log(`  ║  A COBRAR  USD ${Number(cuenta.costo).toFixed(2)}`);
console.log('  ║');
console.log(
  `  ║  del otro lado del corte: ${Number(despuesDelCorte.turnos).toLocaleString('es-AR')} turnos, ` +
    `USD ${Number(despuesDelCorte.costo).toFixed(2)}`,
);
console.log('  ║  (eso lo paga la key del local y NO se cobra)');
console.log('  ╚════════════════════════════════════════════════════════\n');

if (!enSerio) {
  console.log('  Esto fue solo la cuenta: NO se tocó nada.');
  console.log('  Para congelarlo de verdad, volvé a correrlo con --en-serio\n');
  await closeDb();
  process.exit(0);
}

const despues = await repos.settings.write({ cobroHasta: corte });
const final = await repos.metrics.facturacion(despues.cobroDesde, despues.cobroHasta);

console.log(`  Congelado en ${fmt(despues.cobroHasta)}.`);
console.log(
  `  El panel va a mostrar USD ${final.costoUsd.toFixed(2)} (${final.turnos.toLocaleString('es-AR')} turnos), quieto.`,
);
console.log('  No hace falta deploy: el panel lee los ajustes en cada consulta.\n');

await closeDb();
