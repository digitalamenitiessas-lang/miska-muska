/**
 * La proyección del gasto de WhatsApp.
 *
 * Lo que se prueba acá es la aritmética, que es donde se puede meter la pata sin
 * que nadie se dé cuenta: un número de más en el panel se lee como un hecho.
 *
 * Lo importante NO es que proyecte bien cuando hay datos —eso es una división—
 * sino que NO proyecte cuando no los hay. Los primeros días de cada mes Meta
 * cobra cero porque están los mil gratis, y ahí no existe tarifa que deducir.
 * Mostrar cualquier cosa en ese hueco sería inventar.
 *
 *   npx tsx scripts/probar-costo-whatsapp.mts
 */
import {
  MENSAJES_GRATIS_POR_MES,
  proyectarElMes as proyectar,
} from '../src/channels/whatsapp/costos.js';

let mal = 0;
const chequear = (ok: boolean, nota: string): void => {
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${nota}`);
};

console.log('\n  Cuándo NO hay que proyectar nada\n');

const dia5 = new Date('2026-10-05T12:00:00Z');
chequear(proyectar(26, 0, dia5) === null, 'el primer día, con todo gratis todavía');
chequear(proyectar(999, 0, dia5) === null, 'justo antes de agotar los mil gratis');
chequear(proyectar(1000, 0, dia5) === null, 'en los mil exactos: todavía no cobró nada');
chequear(proyectar(5000, 0, dia5) === null, 'muchos mensajes pero Meta informa cero');
chequear(proyectar(0, 0, dia5) === null, 'sin datos');

console.log('\n  Cuándo sí, y con qué número\n');

/*
  El caso real que esperamos: 766 salientes por día, la tarifa publicada de
  Argentina (ARS 37,6798). Al quinto día habría 3.830 mensajes, 2.830 cobrables,
  y Meta habría cobrado 2.830 × 37,6798 = 106.634.
*/
const mensajes5 = 766 * 5;
const costo5 = (mensajes5 - MENSAJES_GRATIS_POR_MES) * 37.6798;
const p = proyectar(mensajes5, costo5, dia5);

chequear(p !== null, 'con plata cobrada sí proyecta');
if (p !== null) {
  // 766 × 31 = 23.746 mensajes; menos los mil gratis = 22.746 × 37,6798 ≈ 857.065
  const esperado = (766 * 31 - MENSAJES_GRATIS_POR_MES) * 37.6798;
  const error = Math.abs(p - esperado) / esperado;
  chequear(error < 0.01, `da ${Math.round(p).toLocaleString('es-AR')}, esperaba ${Math.round(esperado).toLocaleString('es-AR')}`);
}

/*
  Y la trampa del día en curso: si contara solo las horas transcurridas, a las
  nueve de la mañana el ritmo se vería inflado por tres.
*/
const temprano = new Date('2026-10-05T09:00:00Z');
const tarde = new Date('2026-10-05T23:00:00Z');
chequear(
  proyectar(mensajes5, costo5, temprano) === proyectar(mensajes5, costo5, tarde),
  'la hora del día no cambia la proyección, solo la fecha',
);

/* La tarifa se deduce de Meta, no está escrita en ningún lado. */
const conTarifaDistinta = proyectar(mensajes5, costo5 * 2, dia5);
if (p !== null && conTarifaDistinta !== null) {
  chequear(
    Math.abs(conTarifaDistinta - p * 2) < 0.01,
    'si Meta cobrara el doble, la proyección se duplica sola',
  );
}

console.log(mal ? `\n  ${mal} fallaron.\n` : '\n  Pasa todo.\n');
process.exit(mal ? 1 : 0);
