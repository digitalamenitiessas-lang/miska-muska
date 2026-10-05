/**
 * El stock que queda NO llega al bot.
 *
 * Del local, el 3 de octubre: "no quiero que el bot diga el stock que queda al
 * cliente". Antes el contexto del día traía "quedan 287 de 300" para cada caja
 * de una campaña activa, y lo que el modelo tiene delante lo termina diciendo.
 *
 * No se arregló pidiéndoselo en la prosa. Se arregló sacándole el número: lo
 * único que entra es si todavía hay o si ya no hay, que es lo único que cambia
 * lo que el bot hace. El número completo sigue en el panel.
 *
 * Esto prueba el texto que se le manda al modelo, no la intención.
 *
 *   npx tsx scripts/probar-stock-de-campana.mts
 */
import { buildDailyContext } from '../src/core/agent/persona.js';
import { DEFAULT_SETTINGS } from '../src/core/store/repositories.js';

let mal = 0;
const chequear = (ok: boolean, nota: string): void => {
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${nota}`);
};

const campania = (stockTotal: number, stockUsed: number) => ({
  campaign: {
    id: 'camp_1',
    name: 'Día de la Madre 2026',
    startsOn: '2026-10-02',
    endsOn: '2026-10-17',
    active: true,
    pitch: 'Dos opciones de box.',
    createdAt: '2026-10-02T00:00:00Z',
  },
  skus: [
    {
      id: 'sku_1',
      campaignId: 'camp_1',
      name: 'Box gracias por todo',
      price: 46000,
      stockTotal,
      stockUsed,
      sortOrder: 1,
    },
  ],
});

/*
  Se mira SOLO el bloque de la campaña y no el contexto entero. La primera
  versión buscaba "quedan" en todo el texto y saltaba con una línea de otra
  sección que no tiene nada que ver —la de no pedir los datos del pedido de a
  uno—. Una prueba que se enciende por otra cosa no prueba lo que dice.
*/
const soloLaCampania = (ctx: string): string => {
  const i = ctx.indexOf('CAMPAÑA ACTIVA');
  if (i < 0) return '';
  const resto = ctx.slice(i);
  const fin = resto.indexOf('\n\n');
  return fin > 0 ? resto.slice(0, fin) : resto;
};

const contexto = (stockTotal: number, stockUsed: number) =>
  soloLaCampania(
    buildDailyContext({
    settings: DEFAULT_SETTINGS,
    products: [],
    campaigns: [campania(stockTotal, stockUsed)],
    quickReplies: [],
    contact: null,
    outsideHours: false,
      openOrders: [],
      pendingReview: [],
      courses: [],
    } as never),
  );

console.log('\n  Con stock de sobra\n');

const conStock = contexto(300, 13);
chequear(conStock.includes('Box gracias por todo'), 'la caja aparece');
chequear(conStock.includes('46.000'), 'con su precio');
chequear(!/\bquedan\b/i.test(conStock), 'NO dice "quedan"');
chequear(!conStock.includes('287'), 'NO dice cuántas quedan');
chequear(!conStock.includes('300'), 'NO dice el stock total');
chequear(!conStock.includes('13'), 'NO dice cuántas se vendieron');

console.log('\n  Agotada\n');

const sinStock = contexto(300, 300);
chequear(sinStock.includes('AGOTADO'), 'avisa que está agotada');
chequear(!/\bquedan\b/i.test(sinStock), 'tampoco acá dice "quedan"');
chequear(!sinStock.includes('300'), 'tampoco acá se escapa el número');

console.log('\n  Justo la última\n');

const unaSola = contexto(300, 299);
chequear(!unaSola.includes('AGOTADO'), 'con una que queda todavía se ofrece');
chequear(!unaSola.includes('299') && !unaSola.includes('300'), 'y sigue sin decir números');

console.log(mal ? `\n  ${mal} fallaron.\n` : '\n  Pasa todo.\n');
process.exit(mal ? 1 : 0);
