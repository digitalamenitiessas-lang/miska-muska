/*
  El falso positivo del 2 de octubre: la guarda de stock le borró el precio a
  tres clientas que preguntaron por los box del Día de la Madre.

  El bot contestaba bien —las dos opciones con su contenido y su precio— y
  adentro del contenido decía "alfajor de pistacho" y "taza de cerámica". Los
  dos son nombres de productos del catálogo que están apagados, así que la
  guarda creyó que estaba vendiendo cosas agotadas y reemplazó el mensaje
  entero por "dame un minuto que confirmo".

  La clienta preguntó el precio tres veces y nunca lo recibió; a las 13:39 tuvo
  que entrar una persona a pegar el texto a mano.
*/
import { openDb, q, closeDb } from '../src/core/store/db.js';
import { cobraLoQueNoHay } from '../src/core/policies/stock.js';
import { hablaDelBoxDeLaMadre } from '../src/core/policies/diadelamadre.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const apagados = (
  await q<any>(`SELECT id, name, category FROM products WHERE available_today = false`)
).map((p) => ({ id: p.id, name: p.name, category: p.category }));

console.log(`  ${apagados.length} productos apagados en el catálogo.\n`);

/*
  EL CASO DEL 5 DE OCTUBRE A LAS 11:21, que el primer arreglo no agarró.

  La clienta preguntó el precio de los box. El bot mandó las dos fotos —con el
  nombre del box en el rótulo— y después una burbuja de texto con el contenido
  y el alias, SIN la palabra "box" en ninguna parte. Esa burbuja sola matchea
  "Alfajor brownie" y no matchea la excepción, así que la guarda se la comió y
  la clienta volvió a quedarse sin el precio.

  Por eso el pipeline ahora mira el turno entero —rótulos de fotos incluidos— y
  no una burbuja suelta. Esto prueba la burbuja huérfana: sigue dando positivo
  mirada sola, que es lo correcto; lo que la salva es el contexto.
*/
const BURBUJA_HUERFANA = `Te cuento qué trae cada uno: brownie franui, pavlova de durazno, shot de suspiro limeño, 2 alfajores y jugo de naranja.

Se abona por transferencia al alias miskapedidos.`;

/* El texto tal cual lo escribió el local, que es lo que el bot repite. */
const TEXTO_DE_AGUS = `Para el día de la madre tenemos dos opciones de box:

🎁 Box "gracias por todo":
✨ Brownie franui ✨ Pavlova de durazno ✨ Shot de suspiro limeño ✨ Shot de panacota ✨ Cookie de frambuesa ✨ 2 Alfajores ✨ Sandwich de jamón y queso ✨ 2 chipa ✨ Conito de dulce de leche ✨ Jugo de naranja
🎗️ Viene con una cadenita de regalo
Precio: $46.000

🎁 Box "te amo má":
✨ Taza de cerámica ✨ Mini brownie ✨ Mini pavlova ✨ Mini alfajor de pistacho ✨ Shot de suspiro limeño
Precio: $35.000

🛍️ Para encargar se abona previamente el box completo por transferencia al alias: miskapedidos`;

const CON_ALFAJORES = `Te cuento los dos box del Día de la Madre:

🎁 Box gracias por todo — $46.000: brownie franui, pavlova de durazno, 2 alfajores (uno de frutos rojos y uno de pistacho), sandwich de jamón y queso, 2 chipá y jugo de naranja.
🎁 Box te amo má — $35.000: taza de cerámica, mini brownie, mini pavlova y mini alfajor de pistacho.

Se abona por transferencia al alias miskapedidos.`;

const CASOS: Array<[string, string, boolean]> = [
  ['el texto del local, tal cual', TEXTO_DE_AGUS, false],
  ['la versión del bot con los alfajores', CON_ALFAJORES, false],
  /*
    Esta SÍ frena mirada sola, y está bien: sin el nombre del box, ese texto es
    indistinguible de alguien cobrando alfajores. Lo que la salva es que el
    turno nombra el box en el rótulo de la foto, y eso se chequea en el
    pipeline, no acá.
  */
  ['la burbuja huérfana del 5/10, sola, frena', BURBUJA_HUERFANA, true],
];

let mal = 0;
for (const [nota, texto, deberiaFrenar] of CASOS) {
  const r = cobraLoQueNoHay(texto, apagados);
  const frena = r.length > 0;
  const ok = frena === deberiaFrenar;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${nota}`);
  if (frena) console.log(`        marca: ${r.map((x) => x.name).join(', ')}`);
}

/*
  Y lo que NO hay que romper: la guarda tiene que seguir frenando cuando de
  verdad cobra algo apagado suelto.
*/
const unoApagado = apagados.find((p) => !/mini torta/i.test(p.name));
if (unoApagado) {
  const texto = `Te queda así:\n🍪 ${unoApagado.name} — $5.000\n\nTotal: $5.000\n\nTe paso el alias para la transferencia: miskapedidos`;
  const r = cobraLoQueNoHay(texto, apagados);
  const ok = r.length > 0;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} sigue frenando si cobra "${unoApagado.name}" suelto`);
}

/*
  Y la pieza que de verdad arregla el caso del 5/10: el turno entero. Se arma
  como lo arma el pipeline —el rótulo de cada foto más el texto— y se verifica
  que ahí sí se reconoce de qué se está hablando. Mirando solo la burbuja no
  alcanza, y eso es lo que costó las dos clientas.
*/
const turnoCompleto = ['Box gracias por todo', 'Box te amo má', BURBUJA_HUERFANA].join('\n');
const seReconoce = hablaDelBoxDeLaMadre(turnoCompleto);
if (!seReconoce) mal++;
console.log(`  ${seReconoce ? '✓' : '✗'} el turno entero, con el rótulo de la foto, SÍ se reconoce`);
const solaNo = !hablaDelBoxDeLaMadre(BURBUJA_HUERFANA);
if (!solaNo) mal++;
console.log(`  ${solaNo ? '✓' : '✗'} y la burbuja sola, como se esperaba, no`);

console.log(mal ? `\n  ${mal} fallaron.\n` : '\n  Pasa todo.\n');
await closeDb();
process.exit(mal ? 1 : 0);
