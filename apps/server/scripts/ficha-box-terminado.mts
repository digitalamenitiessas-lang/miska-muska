/**
 * El Box de Cookies Edición Limitada terminó.
 *
 * Agus, por audio: "ya se terminó la edición limitada del box de cookies…
 * cuando preguntan por el box de cookies o la cookie de crème brûlée o la
 * cookie de volcán de chocolate o la cookie que trae cada una, que le diga:
 * eso eran productos de edición limitada y ya se terminaron, ya finalizó esa
 * edición. Próximamente sacaremos una, pero te puedo ofrecer esta cookie que
 * tenemos".
 *
 * POR QUÉ NO ALCANZA CON APAGAR EL PRODUCTO. Apagado, el bot dice "hoy no nos
 * queda", que es una promesa de que mañana sí. Y la ficha además le pide que
 * cuente qué trae "por si lo quiere otro día". Son las dos cosas que hay que
 * sacar: esto no es falta de stock, no vuelve.
 *
 * TOCA TRES LUGARES, porque el box estaba nombrado en tres:
 *   - la línea que anunciaba la Franui como "próximamente" (quedó al revés);
 *   - la sección de consultas por cookies, que lo ofrecía por iniciativa propia;
 *   - la sección de lanzamiento entera, con el regalo, el envío y el microondas.
 *
 * Las cuatro cookies no son productos del catálogo: viven solo en este texto,
 * así que no hay nada que apagar por ese lado. El box sí es un producto y ya
 * está en "hoy no hay"; conviene que el local lo saque del catálogo para que no
 * vuelva a prenderse de rebote en la carga de la mañana.
 *
 * El respaldo va con guion bajo adelante para que caiga en la regla del
 * .gitignore: es un volcado de la base, no parte del sistema.
 *
 * En seco por defecto. Con --aplicar escribe.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/ficha-box-terminado.mts
 *   npx tsx --env-file=../../.env.produccion scripts/ficha-box-terminado.mts --aplicar
 */
import { writeFileSync } from 'node:fs';
import { openDb, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

const APLICAR = process.argv.includes('--aplicar');

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const repos = createRepositories();
const settings = await repos.settings.read();
let texto = settings.conocimiento ?? '';

/** Cada reemplazo se verifica antes de aplicarse: si el texto cambió, no se toca nada. */
const CAMBIOS: Array<{ que: string; de: string; a: string }> = [
  {
    que: 'la línea que anunciaba la Franui como próxima',
    de: 'La cookie franui todavía no esta disponible, respondele que dentro de muy poquito podrán probarla.\n',
    a: '',
  },
  {
    que: 'la sección de consultas por cookies, que ofrecía el box sola',
    de:
      'Cada vez que un cliente pregunte qué cookies hay, qué sabores tienen disponibles, qué ' +
      'variedades de cookies venden o haga una consulta similar, además de informar las cookies ' +
      'habituales, ofrecer el Box de Cookies Edición Limitada — SIEMPRE QUE ESTÉ EN LA LISTA DE ' +
      'DISPONIBLES DE HOY. Si figura en HOY NO HAY, no se ofrece: se dice que hoy no queda y se ' +
      'cuenta qué trae, por si lo quiere otro día. Las cookies del box no son intercambiables ni ' +
      'se pueden modificar.\n\nPresentarlo como una opción disponible y mencionar sus 4 sabores:' +
      '\n\n🍓 Franui – base de brownie\n🍌 Banana Split\n🍮 Crème Brûlée\n🍫 Volcán de Chocolate' +
      '\n\nTambién informar que el Box Edición Limitada viene actualmente con una bolsa de Banana ' +
      'Bite de Karinat de regalo.\n\nIMPORTANTE: No esperar a que el cliente pregunte ' +
      'específicamente por el box. Si consulta por cookies disponibles, incluirlo automáticamente ' +
      'entre las opciones — salvo que hoy esté agotado, en cuyo caso no entra en la lista de ' +
      'opciones.',
    a:
      'Cuando pregunten qué cookies hay, qué sabores tienen o algo parecido, se informan las que ' +
      'estén en la lista de disponibles de hoy, con su precio. Nada más: no se ofrece nada que no ' +
      'esté en esa lista.',
  },
  {
    que: 'la sección de lanzamiento entera',
    de:
      'LANZAMIENTO – BOX DE COOKIES EDICIÓN LIMITADA\n\nSacamos un Box de Cookies Edición ' +
      'Limitada. Cuando un cliente pregunte por novedades, cookies nuevas, edición limitada o por ' +
      'este box, ofrecerlo SI HOY ESTÁ DISPONIBLE. Que exista el producto no significa que hoy ' +
      'haya: eso lo dice la lista del día, y esa lista manda.\n\nIncluye 4 sabores: indicalos de ' +
      'la siguiente forma, tal cual como dice abajo\n\n* ♥️ Cookie Franui: la cookie es tipo ' +
      'brownie 😱\n* 🍌 Cookie Banana Split.\n* 🍮 Cookie Crème Brûlée.\n* 🍫 Cookie Volcán de ' +
      'Chocolate.\n\n🎁 REGALO: Actualmente, TODOS los Box Edición Limitada van con tote bag de ' +
      'Bananas Bite de Karinat de regalo. Informar y promocionar este regalo al ofrecer el box (y ' +
      'no lo menciones si hoy no hay box). Por el momento NO es necesario consultar ' +
      'disponibilidad del regalo, ya que hay stock suficiente. Esta regla se mantendrá hasta que ' +
      'sea modificada.QUE ACLARE QUE ES UNA TOTE BAG\n\n🚗 ENVÍO: Cuando compren este box, ' +
      'priorizar y recomendar especialmente que envíen un Uber a retirarlo por el local, ' +
      'siguiendo el procedimiento habitual de envíos.\n\n🍪 IMPORTANTE – CÓMO CONSUMIRLAS:\nAl ' +
      'concretar la compra, recomendar calentar únicamente la Cookie Volcán de Chocolate durante ' +
      '5 segundos en el microondas.\n\nNO recomendar calentar las otras tres cookies, ya que ' +
      'contienen crema.\n\nEsta indicación reemplaza la recomendación general de calentar todas ' +
      'las cookies para este box',
    a:
      'BOX DE COOKIES EDICIÓN LIMITADA — ESA EDICIÓN YA TERMINÓ\n\nEl box no se vende más, y sus ' +
      'cuatro cookies —Franui, Banana Split, Crème Brûlée y Volcán de Chocolate— tampoco: eran de ' +
      'esa edición.\n\nCuando pregunten por el box, o por cualquiera de esas cuatro cookies, se ' +
      'contesta que eran de edición limitada y que esa edición ya finalizó, que próximamente sale ' +
      'una nueva, y se le ofrece alguna de las cookies que sí hay hoy.\n\nNO se dice "hoy no ' +
      'queda" ni "lo chequeo y te confirmo": no es falta de stock del día, no vuelve. Y no se ' +
      'ofrece por iniciativa propia en ninguna lista ni entre las opciones para regalar.',
  },
];

console.log(APLICAR ? '\n  APLICANDO\n' : '\n  EN SECO — no se escribe nada\n');
console.log(`  la ficha tiene ${texto.length} caracteres\n`);

let fallo = false;
for (const c of CAMBIOS) {
  const veces = texto.split(c.de).length - 1;
  if (veces !== 1) {
    fallo = true;
    console.log(`  ✗ ${c.que}: lo encontré ${veces} veces, esperaba 1. NO se toca nada.`);
    continue;
  }
  texto = texto.replace(c.de, c.a);
  console.log(`  ✓ ${c.que}`);
}

if (fallo) {
  console.log('\n  Alguna parte del texto cambió desde que se escribió esto. Revisalo a mano.\n');
  await closeDb();
  process.exit(1);
}

console.log(`\n  queda en ${texto.length} caracteres\n`);
console.log('  ═══ LO QUE VA A DECIR AHORA ═══\n');
const i = texto.indexOf('BOX DE COOKIES EDICIÓN LIMITADA — ESA EDICIÓN YA TERMINÓ');
console.log(texto.slice(i, i + 700).split('\n').map((l) => '  ' + l).join('\n'));

if (APLICAR) {
  const respaldo = `_ficha-antes-del-box-terminado-${new Date().toISOString().slice(0, 10)}.txt`;
  writeFileSync(respaldo, settings.conocimiento ?? '', 'utf8');
  console.log(`\n  respaldo de la ficha anterior en ${respaldo}`);
  await repos.settings.write({ conocimiento: texto });
  const control = await repos.settings.read();
  console.log(
    `  guardado: la ficha quedó en ${(control.conocimiento ?? '').length} caracteres.\n`,
  );
} else {
  console.log('\n  Nada de esto se escribió. Con --aplicar se hace de verdad.\n');
}

await closeDb();
