/**
 * La tarjeta del gasto de WhatsApp: la proyección y el nombre del mes.
 *
 * Acá se prueba donde se puede meter la pata sin que nadie se dé cuenta,
 * porque un número en el panel se lee como un hecho. Y ya pasó tres veces:
 *
 *   - El panel mostró "$87.998 proyectados" con $1.959 cobrados, porque la
 *     cuenta deducía una tarifa dividiendo por "los mensajes pasados de los
 *     mil" y la aplicaba a todos los del mes.
 *   - El cartel decía "WhatsApp en SEPTIEMBRE" el 2 de octubre, porque el mes
 *     viajaba como instante ISO y se leía en hora local.
 *   - Y se llegó a creer que no había cupo de mil, hasta que tres consultas
 *     seguidas mostraron los gratis clavados en 1.003 y lo cobrado subiendo.
 *
 *   npx tsx scripts/probar-costo-whatsapp.mts
 */
import { mesDe, proyectarElMes } from '../src/channels/whatsapp/costos.js';

let mal = 0;
const chequear = (ok: boolean, nota: string): void => {
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${nota}`);
};
const proyectar = (mensajes: number, costo: number, sinCargo: number, cuando: string) =>
  proyectarElMes({ mensajes, costo, sinCargo }, new Date(cuando));

console.log('\n  El mes no tiene zona horaria\n');

chequear(mesDe(new Date('2026-10-01T00:00:00Z')) === '2026-10', 'el 1 a medianoche UTC es octubre');
chequear(mesDe(new Date('2026-10-02T15:00:00Z')) === '2026-10', 'el 2 al mediodía es octubre');
chequear(mesDe(new Date('2026-10-31T23:59:00Z')) === '2026-10', 'el último día sigue siendo octubre');
chequear(mesDe(new Date('2026-11-01T02:00:00Z')) === '2026-11', 'el 1 de noviembre ya es noviembre');
chequear(mesDe(new Date('2026-01-05T12:00:00Z')) === '2026-01', 'enero va con cero adelante');

console.log('\n  Cuándo NO hay que proyectar\n');

/*
  El caso real del 1 de octubre: 1.164 mensajes, todos gratis, cero cobrado.
  Sin un peso cobrado no hay tarifa que deducir, y cualquier número sería
  inventado.
*/
chequear(proyectar(1164, 0, 1164, '2026-10-01T20:00:00Z') === null, 'el día 1: todo gratis todavía');
chequear(proyectar(5000, 0, 5000, '2026-10-15T12:00:00Z') === null, 'muchos mensajes pero Meta informa cero');
chequear(proyectar(0, 0, 0, '2026-10-15T12:00:00Z') === null, 'sin datos');
chequear(proyectar(1000, 0, 1000, '2026-10-20T12:00:00Z') === null, 'en el cupo justo, sin cobrar nada');

console.log('\n  Cuándo sí, y con qué número\n');

/*
  EL CASO REAL DEL 2 DE OCTUBRE. 1.537 entregados, 1.441 gratis, 96 cobrados
  por ARS 3.617,26. La tarifa que sale de ahí es 37,6798, clavada la publicada.

  Proyección: 1.537 / 2 días = 768,5 por día; faltan 29 días = 22.286 mensajes
  más, todos cobrables porque el cupo ya se agotó. Por 37,6798 son 839.730, más
  los 3.617 ya gastados.
*/
const real = proyectar(1537, 3617.2608, 1441, '2026-10-02T16:00:00Z');
chequear(real !== null, 'con plata cobrada sí proyecta');
if (real !== null) {
  const esperado = 3617.2608 + (1537 / 2) * 29 * (3617.2608 / 96);
  chequear(
    Math.abs(real - esperado) < 1,
    `da ARS ${Math.round(real).toLocaleString('es-AR')}, esperaba ${Math.round(esperado).toLocaleString('es-AR')}`,
  );
  /* Y lo importante: que NO dé el número chico de la regla de tres lineal. */
  const lineal = (3617.2608 / 2) * 31;
  chequear(real > lineal * 10, 'no se queda en la regla de tres lineal, que daba 56.000');
}

/* La tarifa sale de Meta, no está escrita: si cobrara el doble, el techo sube. */
const doble = proyectar(1537, 3617.2608 * 2, 1441, '2026-10-02T16:00:00Z');
chequear(
  real !== null && doble !== null && Math.abs(doble - real * 2) < 1,
  'si Meta cobrara el doble por mensaje, la proyección se duplica sola',
);

/* El último día del mes ya no queda nada por proyectar: es lo gastado. */
const ultimo = proyectar(30000, 900000, 1441, '2026-10-31T20:00:00Z');
chequear(ultimo !== null && Math.abs(ultimo - 900000) < 1, 'el día 31 la proyección es lo ya gastado');

/* La hora del día no mueve el ritmo, solo la fecha. */
chequear(
  proyectar(1537, 3617.26, 1441, '2026-10-02T09:00:00Z') ===
    proyectar(1537, 3617.26, 1441, '2026-10-02T23:00:00Z'),
  'la hora del día no cambia la proyección',
);

/* Febrero tiene 28: los días que faltan salen del mes, no de un 30 a mano. */
const feb = proyectar(2000, 1000, 1000, '2026-02-07T10:00:00Z');
const oct = proyectar(2000, 1000, 1000, '2026-10-07T10:00:00Z');
chequear(feb !== null && oct !== null && feb < oct, 'febrero proyecta menos que octubre, por los días');

console.log(mal ? `\n  ${mal} fallaron.\n` : '\n  Pasa todo.\n');
process.exit(mal ? 1 : 0);
