/**
 * Los totales del pote + cookie salen sumados por el código, no por el modelo.
 *
 * El 18 de noviembre el bot dijo "pote + cookie red velvet $9.000" (son $8.500).
 *
 *   npx tsx scripts/probar-combos-helado.mts
 */
import { combosDeHelado } from '../src/core/agent/persona.js';
import type { Product } from '../src/core/types/domain.js';

const p = (id: string, name: string, category: string, price: number, availableToday = true) =>
  ({ id, name, category, price, availableToday }) as unknown as Product;

const HOY = [
  p('pote-helado-americana', 'Pote helado americana', 'HELADO', 4000),
  p('pote-helado-dulce-de-leche', 'Pote helado dulce de leche', 'HELADO', 4000),
  p('cookie-red-velvet', 'Cookie red velvet', 'cookies', 4500),
  p('cookie-nutella', 'Cookie nutella', 'cookies', 5500),
  p('cookie-kinder', 'Cookie kinder', 'cookies', 5500, false),
  p('brownie-oreo', 'Brownie Oreo', 'cuadrados', 5500),
];

let fallas = 0;
const esperar = (nombre: string, ok: boolean, detalle = '') => {
  console.log(`${ok ? 'ok  ' : 'MAL '} ${nombre}${ok ? '' : `\n     ${detalle}`}`);
  if (!ok) fallas++;
};

const hoy = combosDeHelado(HOY) ?? '';
esperar('red velvet + pote = $8.500', hoy.includes('Cookie red velvet + pote → $8.500'), hoy);
esperar('nutella + pote = $9.500', hoy.includes('Cookie nutella + pote → $9.500'), hoy);
esperar('no suma una cookie apagada', !hoy.includes('kinder'), hoy);
esperar('no suma lo que no es cookie', !hoy.includes('Brownie'), hoy);
esperar('un solo precio de pote: sin subtítulos por sabor', !hoy.includes('Con Pote'), hoy);

esperar(
  'sin helado prendido, no hay bloque',
  combosDeHelado(HOY.map((x) => (x.category === 'HELADO' ? { ...x, availableToday: false } : x))) === null,
);
esperar(
  'sin cookies prendidas, no hay bloque',
  combosDeHelado(HOY.map((x) => (x.category === 'cookies' ? { ...x, availableToday: false } : x))) === null,
);

const distintos = combosDeHelado(
  HOY.map((x) => (x.id === 'pote-helado-dulce-de-leche' ? { ...x, price: 4500 } : x)),
) ?? '';
esperar('con dos precios de pote, suma cada uno', distintos.includes('$9.000') && distintos.includes('$8.500') && distintos.includes('$10.000'), distintos);

console.log('\n' + hoy);
if (fallas) {
  console.log(`\n${fallas} caso(s) mal`);
  process.exit(1);
}
