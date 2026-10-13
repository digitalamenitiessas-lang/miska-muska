/**
 * El local abre más tarde los domingos, y el bot tiene que saberlo.
 *
 * El domingo 11 de octubre a las 10:10 una clienta mandó el comprobante y el
 * bot contestó "Perfecto! Ya salimos a entregárselo 🙌🏼". El local abre a las
 * 14 los domingos. A las 12:02 ella escribió "estoy en el local", a las 12:03
 * "de Marcos Paz", y el bot contestó "Dale! 🙌🏼". Había ido a un local
 * cerrado.
 *
 * Del local: "el domingo un quilombo con esta chica que ha ido a buscar...
 * le dice que ya sale a entregarle y estábamos cerrados. Podés llegar a tener
 * quilombos grandes".
 *
 * El dato estaba en los ajustes pero SOLO EN PROSA —"Domingos de 14:00 a
 * 21:30" dentro del texto de horarios— y el número que mira el código era uno
 * solo para los siete días. Otra vez la prosa perdiendo contra el dato
 * estructurado.
 *
 *   npx tsx scripts/probar-horario-domingo.mts
 */
import { horaDeApertura, isOutsideBusinessHours } from '../src/core/policies/rules.js';
import { localDiaDeLaSemana } from '../src/core/store/db.js';
import type { BotSettings } from '../src/core/types/domain.js';

const AJUSTES = { openHour: 8, openHourDomingo: 14, closeHour: 22 } as BotSettings;

let mal = 0;
const chequear = (ok: boolean, nota: string): void => {
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${nota}`);
};

/* Tucumán es UTC-3, así que las 10:10 locales son las 13:10 UTC. */
const enTucuman = (iso: string) => new Date(iso);

console.log('\n  El día de la semana, en hora de Tucumán\n');

chequear(localDiaDeLaSemana(enTucuman('2026-10-11T13:10:00Z')) === 0, 'domingo al mediodía es domingo');
/*
  El borde que rompe getDay(): el domingo a las 22 de Tucumán ya es lunes en
  UTC, y el servidor corre en UTC.
*/
chequear(localDiaDeLaSemana(enTucuman('2026-10-12T01:00:00Z')) === 0, 'domingo 22:00 de Tucumán sigue siendo domingo');
chequear(localDiaDeLaSemana(enTucuman('2026-10-12T13:00:00Z')) === 1, 'lunes es lunes');
chequear(localDiaDeLaSemana(enTucuman('2026-10-17T13:00:00Z')) === 6, 'el sábado 17 es sábado');

console.log('\n  EL CASO REAL: domingo 11/10, 10:10\n');

const elCaso = enTucuman('2026-10-11T13:10:00Z');
chequear(horaDeApertura(AJUSTES, elCaso) === 14, 'ese día abre a las 14, no a las 8');
chequear(isOutsideBusinessHours(AJUSTES, elCaso), 'y el bot sabe que está CERRADO');

console.log('\n  El resto de la semana no se movió\n');

const lunes10 = enTucuman('2026-10-12T13:10:00Z');
chequear(horaDeApertura(AJUSTES, lunes10) === 8, 'el lunes sigue abriendo a las 8');
chequear(!isOutsideBusinessHours(AJUSTES, lunes10), 'y a las 10:10 está abierto');

const sabado10 = enTucuman('2026-10-17T13:10:00Z');
chequear(!isOutsideBusinessHours(AJUSTES, sabado10), 'el sábado 17 a las 10:10, abierto');

console.log('\n  Los bordes del domingo\n');

chequear(isOutsideBusinessHours(AJUSTES, enTucuman('2026-10-11T16:59:00Z')), 'domingo 13:59, todavía cerrado');
chequear(!isOutsideBusinessHours(AJUSTES, enTucuman('2026-10-11T17:00:00Z')), 'domingo 14:00, ya abierto');
chequear(!isOutsideBusinessHours(AJUSTES, enTucuman('2026-10-12T00:30:00Z')), 'domingo 21:30, abierto hasta las 22');
chequear(isOutsideBusinessHours(AJUSTES, enTucuman('2026-10-12T01:30:00Z')), 'domingo 22:30, cerrado');

console.log('\n  Y si no hay hora de domingo cargada, no se rompe nada\n');

const viejos = { openHour: 8, closeHour: 22 } as BotSettings;
chequear(horaDeApertura(viejos, elCaso) === 8, 'sin el ajuste, vuelve al comportamiento de antes');

console.log(mal ? `\n  ${mal} fallaron.\n` : '\n  Pasa todo.\n');
process.exit(mal ? 1 : 0);
