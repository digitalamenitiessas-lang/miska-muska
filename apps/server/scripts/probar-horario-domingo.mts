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
import {
  horaDeApertura,
  isOutsideBusinessHours,
  proximaHoraDePedidos,
  sePuedenTomarPedidos,
} from '../src/core/policies/rules.js';
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

/*
  LA FRANJA DE PEDIDOS TAMBIÉN TENÍA QUE SABERLO.

  El domingo 25 de octubre, entre las 10:31 y las 11:12, el bot cargó tres
  pedidos para ese mismo día. `isOutsideBusinessHours` ya decía cerrado, pero
  la guarda de `crear_pedido` mira `sePuedenTomarPedidos`, y esa usaba
  `pedidosDesde` (08:00) para los siete días. A una clienta le dijo "Ya podés
  pedir el Uber" y el Uber llegó a un local cerrado.
*/
console.log('\n  La franja de pedidos del domingo\n');

const PEDIDOS = { ...AJUSTES, pedidosDesde: '08:00', pedidosHasta: '21:30' } as BotSettings;

chequear(!sePuedenTomarPedidos(PEDIDOS, enTucuman('2026-10-25T14:03:00Z')), 'domingo 25/10 11:03 (el caso): NO se toman pedidos');
chequear(!sePuedenTomarPedidos(PEDIDOS, enTucuman('2026-10-25T16:59:00Z')), 'domingo 13:59, todavía no');
chequear(sePuedenTomarPedidos(PEDIDOS, enTucuman('2026-10-25T17:00:00Z')), 'domingo 14:00, sí');
chequear(sePuedenTomarPedidos(PEDIDOS, enTucuman('2026-10-26T11:00:00Z')), 'lunes 08:00, sí, como siempre');
chequear(!sePuedenTomarPedidos(PEDIDOS, enTucuman('2026-10-26T10:59:00Z')), 'lunes 07:59, no, como siempre');

console.log('\n  Y el bot dice la hora correcta en que se retoman\n');

chequear(proximaHoraDePedidos(PEDIDOS, enTucuman('2026-10-25T14:03:00Z')) === '14:00', 'domingo a la mañana: "a las 14:00"');
chequear(proximaHoraDePedidos(PEDIDOS, enTucuman('2026-10-25T02:00:00Z')) === '14:00', 'sábado 23:00: también "a las 14:00", porque mañana es domingo');
chequear(proximaHoraDePedidos(PEDIDOS, enTucuman('2026-10-26T01:00:00Z')) === '08:00', 'domingo 22:00: "a las 08:00", porque mañana es lunes');
chequear(proximaHoraDePedidos(PEDIDOS, enTucuman('2026-10-26T10:00:00Z')) === '08:00', 'lunes 07:00: "a las 08:00"');

console.log(mal ? `\n  ${mal} fallaron.\n` : '\n  Pasa todo.\n');
process.exit(mal ? 1 : 0);
