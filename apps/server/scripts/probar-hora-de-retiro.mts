/**
 * La hora de retiro: cuándo hace falta y cuándo no.
 *
 * Del local, un viernes a la noche: "parece que el bot no está tomando ningún
 * pedido". Ese día cargó 8 contra los 22 a 39 de los días anteriores, y ninguno
 * después de las cuatro de la tarde.
 *
 * La causa: la validación exigía una hora de retiro para TODO lo que no fuera
 * nuestro cadete, y eso incluía el Uber. Con un Uber esa hora no existe cuando
 * se carga el pedido —se manda después, cuando el local avisa que está listo—,
 * así que el bot quedaba pidiendo un dato imposible y el pedido no entraba.
 *
 *   npx tsx scripts/probar-hora-de-retiro.mts
 */
import { datosFaltantes } from '../src/core/policies/rules.js';
import type { Product } from '../src/core/types/domain.js';

const COOKIE: Product = {
  id: 'p1',
  name: 'Cookie Kinder',
  category: 'cookies',
  price: 5000,
  availableToday: true,
  limitedEdition: false,
  pickupOnly: false,
  notes: null,
  sortOrder: 1,
  imageUrl: null,
} as Product;

const productos = new Map<string, Product>([[COOKIE.id, COOKIE]]);

const base = {
  customerName: 'Lourdes Alderete',
  items: [{ productId: COOKIE.id, description: 'Cookie Kinder', quantity: 2, unitPrice: 5000 }],
  total: 10000,
  address: null,
  recipientName: null,
  deliveryDate: null,
  deliveryTime: null,
};

type Caso = { nombre: string; draft: Record<string, unknown>; pideHora: boolean };

const CASOS: Caso[] = [
  {
    nombre: 'uber-cliente sin hora: NO se pide, la manda cuando le avisamos',
    draft: { ...base, deliveryMode: 'uber-cliente' },
    pideHora: false,
  },
  {
    nombre: 'retira-local sin hora: sí se pide, ella sabe cuándo pasa',
    draft: { ...base, deliveryMode: 'retira-local' },
    pideHora: true,
  },
  {
    nombre: 'cadete-miska sin hora: sí se pide, el cadete tiene que salir',
    draft: { ...base, deliveryMode: 'cadete-miska', address: 'San Lorenzo 1625' },
    pideHora: true,
  },
  {
    nombre: 'uber-cliente CON hora: tampoco molesta',
    draft: { ...base, deliveryMode: 'uber-cliente', deliveryTime: 'entre las 18 y las 19' },
    pideHora: false,
  },
];

let mal = 0;
console.log('\n  Cuándo se pide la hora\n');
for (const c of CASOS) {
  const faltan = datosFaltantes(c.draft as never, productos, null);
  const pide = faltan.some((f) => /hora/i.test(f));
  const ok = pide === c.pideHora;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${c.nombre}`);
  if (!ok) console.log(`      faltan: ${faltan.join(' · ') || '(nada)'}`);
}

console.log(mal ? `\n  ${mal} casos fallaron.\n` : '\n  Los casos pasan todos.\n');
process.exit(mal ? 1 : 0);
