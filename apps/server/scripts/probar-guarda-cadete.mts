/**
 * El bot no arranca un envío solo.
 *
 * El caso que la motivó, textual: "Como estás ahí ahora, te lo mandamos con
 * nuestro cadete en moto. Me confirmás el nombre de quien lo recibe...". Nadie
 * del local autorizó ese envío, ni ese cadete, ni esa moto.
 *
 * Lo que importa acá es la SEGUNDA lista: ofrecer el envío está bien, y una
 * guarda que también pise eso deja al bot sin poder vender.
 *
 *   npx tsx scripts/probar-guarda-cadete.mts
 */

import { comprometeNuestroCadete, elLocalHabloDelEnvio } from '../src/core/policies/envios.js';

/** Lo compromete: nadie decidió eso. */
const COMPROMETE: string[] = [
  'Como estás ahí ahora, te lo mandamos con nuestro cadete en moto.',
  'Perfecto, te lo llevamos con nuestro cadete 🙌',
  'Dale, te lo mandamos hoy mismo.',
  'Lo lleva nuestro cadete entre las 18 y las 19.',
  'Va con nuestro cadete, así que no hace falta que pidas nada.',
  'Sale nuestro cadete en un rato con tu pedido.',
  'Te lo manda el cadete apenas esté listo.',
  'Se lo enviamos a la dirección que nos pasaste.',
];

/** Solo lo ofrece o lo consulta: eso es lo que queremos que haga. */
const ESTA_BIEN: string[] = [
  'Dejame que consulto con el local si te lo podemos llevar nosotros 🙏🏻',
  'Podemos verlo con nuestro cadete, te confirmo en un ratito.',
  'Se puede con nuestro cadete o podés mandar un Uber, cómo preferís?',
  'Si el local puede, te lo llevamos nosotros. Lo confirmo y te aviso.',
  'Las cookies y los brownies se envían con nuestro cadete, o se retiran en el local.',
  'Le paso tu dirección a alguien del local para que te confirme el costo del envío.',
  'Podés retirarlo en Marcos Paz 473, o pedir un Uber moto para que lo busque.',
  'Perfecto, anoto la dirección: Diagonal Sur 2436.',
];

let fallas = 0;

for (const t of COMPROMETE) {
  const ok = comprometeNuestroCadete(t);
  console.log(`${ok ? 'ok   ' : 'FALLA'} compromete   ${JSON.stringify(t.slice(0, 62))}`);
  if (!ok) fallas++;
}

console.log();

for (const t of ESTA_BIEN) {
  const ok = !comprometeNuestroCadete(t);
  console.log(`${ok ? 'ok   ' : 'FALLA'} está bien    ${JSON.stringify(t.slice(0, 62))}`);
  if (!ok) fallas++;
}

// --- Y la puerta de escape: si el local ya habló, la guarda no se mete ---
console.log();
const conElLocal = [
  { direction: 'in', author: 'human', text: 'hacen envío a la Junín 254?' },
  { direction: 'out', author: 'bot', text: 'Dejame consultarlo' },
  { direction: 'out', author: 'human', text: 'dale, mandale con el cadete que va para ese lado' },
];
const sinElLocal = [
  { direction: 'in', author: 'human', text: 'hacen envío a la Junín 254?' },
  { direction: 'out', author: 'bot', text: 'Dejame consultarlo' },
  { direction: 'out', author: 'human', text: 'perfecto amor te esperamosss' },
];

const casos: Array<[string, boolean, boolean]> = [
  ['el local autorizó el cadete', elLocalHabloDelEnvio(conElLocal), true],
  ['el local escribió pero de otra cosa', elLocalHabloDelEnvio(sinElLocal), false],
  ['nadie del local escribió', elLocalHabloDelEnvio(sinElLocal.slice(0, 2)), false],
];
for (const [nombre, dio, espera] of casos) {
  const ok = dio === espera;
  console.log(`${ok ? 'ok   ' : 'FALLA'} ${nombre}: ${dio}`);
  if (!ok) fallas++;
}

const total = COMPROMETE.length + ESTA_BIEN.length + casos.length;
console.log(fallas ? `\n${fallas} falla(s) de ${total}` : `\nTodo bien: ${total} casos.`);
process.exit(fallas ? 1 : 0);
