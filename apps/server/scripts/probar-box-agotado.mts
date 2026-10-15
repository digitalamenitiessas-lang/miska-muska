/**
 * La guarda que no deja vender un box del Día de la Madre que ya no está.
 *
 * Los casos de "FRENA" son textuales de la noche del 14 de octubre, cuando el
 * local ya había apagado los dos box y el bot siguió ofreciéndolos.
 *
 * Los de "DEJA PASAR" importan más: son los mensajes para las trescientas
 * personas que ya pagaron y preguntan por el retiro, el horario y la cadenita.
 * Si la guarda los tapa, el sábado 17 hay trescientas personas sin respuesta.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-box-agotado.mts
 */
import { vendeUnBoxQueNoEsta, type BoxApagado } from '../src/core/policies/diadelamadre.js';

/*
  Fijos, no leídos del catálogo: una prueba que saca su entrada de la base
  cambia de resultado cuando el local toca un botón y deja de ser una prueba.
*/
const APAGADOS: BoxApagado[] = [
  { id: 'box-madre-gracias-por-todo', name: 'Box gracias por todo' },
  { id: 'box-madre-te-amo-ma', name: 'Box te amo má' },
];
const NINGUNO: BoxApagado[] = [];

let fallas = 0;
const caso = (frena: boolean, texto: string, por: string, apagados = APAGADOS) => {
  const salio = vendeUnBoxQueNoEsta(texto, apagados).length > 0;
  const bien = salio === frena;
  if (!bien) fallas++;
  console.log(
    `  ${bien ? 'ok   ' : 'FALLA'} ${frena ? 'frena     ' : 'deja pasar'}  ${por}`,
  );
  if (!bien) console.log(`           "${texto.replace(/\n/g, ' ').slice(0, 110)}"`);
};

console.log('\n  LO QUE TIENE QUE FRENAR — textual del 14 de octubre a la noche:\n');

caso(
  true,
  'Holaa Sofi! 🫶🏼\n\nTenemos dos boxes especiales para el Día de la Madre que se retiran el sábado 17:\n\n🎁 Box "gracias por todo" — $46.000',
  'el de las 22:12, con el precio viejo',
);
caso(
  true,
  'Tenemos dos opciones hermosas para el Día de la Madre:\n🎁 Box "gracias por todo"\n🎁 Box "te amo má"',
  'ofrece los dos sin decir precio',
);
caso(
  true,
  'Para encargar el Box "gracias por todo" necesitás transferir la totalidad al alias miskapedidos',
  'pide la transferencia',
);
caso(
  true,
  'El Box "te amo má" sale $37.000. Trae taza de cerámica, mini brownie y mini pavlova.',
  'pone precio, aunque sea el correcto',
);
caso(
  true,
  'Para el día de la madre tenemos dos opciones de box, cuál te interesa?',
  'presenta las opciones y pregunta cuál',
);

console.log('\n  LO QUE NO PUEDE TAPAR — gente que ya pagó:\n');

caso(
  false,
  'Perfecto! Tu pedido fue tomado. Te esperamos el sábado 17 de octubre de 14 a 21 hs para retirar tu pedido de Marcos Paz 473 🫶🏼',
  'la confirmación de retiro',
);
caso(
  false,
  'Sí! El Box "gracias por todo" lo puede retirar otra persona, solo tiene que decir tu nombre y apellido.',
  'quién puede retirarlo',
);
caso(
  false,
  'El modelo de cadenita del video se agotó pero igualmente el Box "gracias por todo" lleva otro modelo hermoso de la misma marca 🤗',
  'el aviso de la cadenita',
);
caso(
  false,
  'El Box "te amo má" se retira el sábado de 14 a 21, no antes de esa hora.',
  'el horario de retiro',
);
caso(
  false,
  'Los box del Día de la Madre ya se agotaron y cerramos los pedidos 🥺',
  'decir que se agotaron NO es venderlos',
);
caso(
  false,
  'Uy, el Box "gracias por todo" ya no nos queda. Te muestro los otros box que sí tenemos?',
  'avisa que no hay y ofrece otra cosa',
);

console.log('\n  CUANDO EL LOCAL LOS VUELVE A ENCENDER, LA GUARDA SE APAGA SOLA:\n');

caso(
  false,
  'Tenemos dos opciones para el Día de la Madre: Box "gracias por todo" — $49.000 y Box "te amo má" — $37.000',
  'con el catálogo encendido no frena nada',
  NINGUNO,
);

console.log('\n  Y NO SE METE CON EL RESTO DEL CATÁLOGO:\n');

caso(
  false,
  'Tenemos el Box requete feliz a $23.000 y el Box popurrí a $33.000, cuál te gustaría?',
  'otros box de la casa',
);
caso(
  false,
  'El desayuno Miska Muska sale $40.000 y te lo llevamos a domicilio 🥰',
  'un desayuno',
);
caso(
  false,
  'Gracias por todo, que tengas lindo día! 🫶🏼',
  '"gracias por todo" como despedida, sin la palabra box',
);

console.log(
  fallas
    ? `\n  ${fallas} ${fallas === 1 ? 'falla' : 'fallas'}. NO lo despliegues así.\n`
    : '\n  Todo bien.\n',
);
process.exit(fallas ? 1 : 0);
