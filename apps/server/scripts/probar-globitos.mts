/**
 * Juntar los globitos en un solo mensaje.
 *
 * Lo pidió el local para que Meta cobre menos: desde octubre cada mensaje
 * pasado del cupo sale ARS 37,6798. La consigna fue "menos mensajes pero la
 * misma información", así que lo que se prueba acá, antes que nada, es que no
 * se pierda una sola palabra.
 *
 *   npx tsx scripts/probar-globitos.mts
 */
import { juntarLosGlobitos } from '../src/core/policies/globitos.js';

let mal = 0;
const chequear = (ok: boolean, nota: string): void => {
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${nota}`);
};
const texto = (text: string) => ({ kind: 'text' as const, text });
const foto = (url: string) => ({ kind: 'image' as const, url } as never);

console.log('\n  Lo que tiene que juntar\n');

const tres = juntarLosGlobitos([
  texto('Holaa! Qué necesitás?'),
  texto('Hoy tenemos cookies de kinder, dubai y ferrero.'),
  texto('Cuál te late?'),
]);
chequear(tres.length === 1, 'tres globitos quedan en un mensaje');
chequear(
  tres[0].kind === 'text' &&
    tres[0].text.includes('Holaa') &&
    tres[0].text.includes('dubai') &&
    tres[0].text.includes('Cuál te late'),
  'y no se pierde ni una palabra',
);
chequear(
  tres[0].kind === 'text' && tres[0].text.split('\n\n').length === 3,
  'quedan separados por un renglón en blanco',
);

console.log('\n  Lo que NO tiene que tocar\n');

const conFoto = juntarLosGlobitos([
  texto('Mirá este:'),
  foto('https://x/box.jpg'),
  texto('Sale $46.000.'),
]);
chequear(conFoto.length === 3, 'una foto en el medio corta la serie');
chequear(conFoto[1].kind === 'image', 'y la foto queda intacta en su lugar');

const dosFotos = juntarLosGlobitos([foto('https://x/1.jpg'), foto('https://x/2.jpg')]);
chequear(dosFotos.length === 2, 'dos fotos siguen siendo dos mensajes');

const unoSolo = juntarLosGlobitos([texto('Listo!')]);
chequear(unoSolo.length === 1 && unoSolo[0].kind === 'text' && unoSolo[0].text === 'Listo!', 'un mensaje solo pasa igual');

chequear(juntarLosGlobitos([]).length === 0, 'sin nada, nada');

console.log('\n  Los bordes\n');

const conVacio = juntarLosGlobitos([texto('Hola'), texto('   '), texto('Chau')]);
chequear(
  conVacio.length === 1 && conVacio[0].kind === 'text' && conVacio[0].text === 'Hola\n\nChau',
  'un globito vacío se descarta y no deja renglones de más',
);

/*
  El techo: un turno que se fue de largo no se convierte en un ladrillo. Dos de
  mil caracteres pasan de 1.500 y se dejan separados.
*/
const largos = juntarLosGlobitos([texto('a'.repeat(1000)), texto('b'.repeat(1000))]);
chequear(largos.length === 2, 'si al juntarlos pasan de 1.500 caracteres, no se juntan');

const justo = juntarLosGlobitos([texto('a'.repeat(700)), texto('b'.repeat(700))]);
chequear(justo.length === 1, 'pero 700 y 700 sí entran');

/* Y el caso de tres donde los dos primeros entran y el tercero no. */
const mixto = juntarLosGlobitos([texto('a'.repeat(700)), texto('b'.repeat(700)), texto('c'.repeat(700))]);
chequear(mixto.length === 2, 'junta lo que entra y corta donde no');

console.log(mal ? `\n  ${mal} fallaron.\n` : '\n  Pasa todo.\n');
process.exit(mal ? 1 : 0);
