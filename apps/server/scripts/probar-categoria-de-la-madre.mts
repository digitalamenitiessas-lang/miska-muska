/**
 * Los box del Día de la Madre se encargan, pero no los llevamos nosotros.
 *
 * El 5 de octubre a las 8:43 entró alguien desde Irlanda pidiendo un regalo de
 * cumpleaños para ese mismo día con envío. El bot le ofreció los dos box del
 * Día de la Madre y le pidió la dirección, el nombre de quien recibe y la
 * franja horaria. Agus: "no hacemos envíos y menos hoy jaja".
 *
 * El bot no se desvió: hizo lo que decía nuestra tabla. Los box estaban
 * cargados en la categoría 'desayunos', y 'desayunos' significa literalmente
 * "va SIEMPRE con nuestro cadete". La ficha decía lo contrario en prosa y
 * perdió, como pierde siempre la prosa contra una regla de código.
 *
 * Esto fija las dos mitades de la categoría nueva: se encarga para otro día
 * (porque se entrega el 17) y NO arrastra nuestro cadete.
 *
 *   npx tsx scripts/probar-categoria-de-la-madre.mts
 */
import {
  CATEGORIAS_DE_FABRICA,
  canonizarCategoria,
  esDesayunoOBox,
  seEncargaConAnticipacion,
} from '../src/core/policies/rules.js';

let mal = 0;
const chequear = (ok: boolean, nota: string): void => {
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${nota}`);
};

const MADRE = 'dia-de-la-madre';

console.log('\n  La categoría existe\n');
chequear(CATEGORIAS_DE_FABRICA.includes(MADRE as never), 'está entre las de fábrica');
chequear(canonizarCategoria('Dia de la Madre', []) === MADRE, 'escrita a mano cae sobre la de fábrica');
chequear(canonizarCategoria('DÍA DE LA MADRE', []) === MADRE, 'con tildes y mayúsculas también');

console.log('\n  Lo que SÍ hereda\n');
chequear(seEncargaConAnticipacion(MADRE), 'se encarga con anticipación: se entrega el 17');

console.log('\n  Lo que NO hereda, que es el bug\n');
chequear(!esDesayunoOBox(MADRE), 'NO va siempre con nuestro cadete');
chequear(!esDesayunoOBox('Día de la Madre'), 'tampoco escrita a mano');

console.log('\n  Y que no se rompió lo de antes\n');
chequear(esDesayunoOBox('desayunos'), 'un desayuno sigue yendo con nuestro cadete');
chequear(seEncargaConAnticipacion('desayunos'), 'y sigue encargándose con anticipación');
chequear(seEncargaConAnticipacion('tortas'), 'una torta también se encarga');
chequear(!esDesayunoOBox('cookies'), 'una cookie sigue sin cadete propio');
chequear(!seEncargaConAnticipacion('cookies'), 'y sigue sin encargarse para otro día');

console.log(mal ? `\n  ${mal} fallaron.\n` : '\n  Pasa todo.\n');
process.exit(mal ? 1 : 0);
