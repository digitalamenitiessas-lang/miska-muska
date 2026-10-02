/**
 * La tarjeta del gasto de WhatsApp: la proyección y el nombre del mes.
 *
 * Lo que se prueba acá es donde se puede meter la pata sin que nadie se dé
 * cuenta, porque un número en el panel se lee como un hecho. Y ya pasó dos
 * veces en dos días:
 *
 *   - El panel mostró "$87.998 proyectados en el mes" con $1.959 cobrados. La
 *     cuenta vieja deducía una tarifa dividiendo por "los mensajes pasados de
 *     los mil gratis", un cupo que no existe, y la aplicaba a todos.
 *   - Y el cartel decía "WhatsApp en SEPTIEMBRE" el 2 de octubre, porque el mes
 *     viajaba como instante ISO y se leía en hora local.
 *
 *   npx tsx scripts/probar-costo-whatsapp.mts
 */
import { mesDe, proyectarElMes as proyectar } from '../src/channels/whatsapp/costos.js';

let mal = 0;
const chequear = (ok: boolean, nota: string): void => {
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${nota}`);
};

console.log('\n  El mes no tiene zona horaria\n');

chequear(mesDe(new Date('2026-10-01T00:00:00Z')) === '2026-10', 'el 1 a medianoche UTC es octubre');
chequear(mesDe(new Date('2026-10-02T15:00:00Z')) === '2026-10', 'el 2 al mediodía es octubre');
chequear(mesDe(new Date('2026-10-31T23:59:00Z')) === '2026-10', 'el último día sigue siendo octubre');
chequear(mesDe(new Date('2026-11-01T02:00:00Z')) === '2026-11', 'el 1 de noviembre ya es noviembre');
chequear(mesDe(new Date('2026-01-05T12:00:00Z')) === '2026-01', 'enero va con cero adelante');

console.log('\n  Cuándo NO hay que proyectar\n');

chequear(proyectar(0, new Date('2026-10-15T12:00:00Z')) === null, 'sin un peso cobrado');
chequear(proyectar(-5, new Date('2026-10-15T12:00:00Z')) === null, 'con un costo negativo');
chequear(proyectar(2298, new Date('2026-10-01T12:00:00Z')) === null, 'el día 1: un solo día no es un mes');
chequear(proyectar(2298, new Date('2026-10-02T15:00:00Z')) === null, 'el día 2, que es el caso real');

console.log('\n  Cuándo sí, y con qué número\n');

/*
  Desde el día 3. Nueve mil pesos en tres días de un mes de 31 son 93.000:
  regla de tres sobre lo que Meta ya cobró, sin ninguna tarifa escrita.
*/
const dia3 = proyectar(9000, new Date('2026-10-03T10:00:00Z'));
chequear(dia3 !== null, 'el día 3 ya proyecta');
chequear(dia3 !== null && Math.round(dia3) === 93000, `da ${dia3 !== null ? Math.round(dia3) : '—'}, esperaba 93.000`);

const dia10 = proyectar(60000, new Date('2026-10-10T10:00:00Z'));
chequear(dia10 !== null && Math.round(dia10) === 186000, 'el día 10, con 60.000, proyecta 186.000');

/* Febrero tiene 28: el divisor sale del mes, no de un 30 escrito a mano. */
const feb = proyectar(7000, new Date('2026-02-07T10:00:00Z'));
chequear(feb !== null && Math.round(feb) === 28000, 'febrero proyecta sobre 28 días, no sobre 30');

/*
  Y la trampa del día en curso: si contara las horas transcurridas, a las nueve
  de la mañana el ritmo se vería inflado por tres.
*/
chequear(
  proyectar(9000, new Date('2026-10-03T09:00:00Z')) === proyectar(9000, new Date('2026-10-03T23:00:00Z')),
  'la hora del día no cambia la proyección, solo la fecha',
);

/* Es lineal: el doble cobrado proyecta el doble. Sin escalones inventados. */
const a = proyectar(9000, new Date('2026-10-03T10:00:00Z'));
const b = proyectar(18000, new Date('2026-10-03T10:00:00Z'));
chequear(a !== null && b !== null && Math.abs(b - a * 2) < 0.01, 'el doble cobrado proyecta el doble');

console.log(mal ? `\n  ${mal} fallaron.\n` : '\n  Pasa todo.\n');
process.exit(mal ? 1 : 0);
