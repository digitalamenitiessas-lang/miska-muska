/**
 * El termómetro del nombre tiene que separar dos cosas que se parecen mucho:
 * PEDIR el nombre de cero (lo que el local quiere que baje) y CONFIRMAR uno que
 * ya tenemos (lo que queremos que haga en su lugar).
 *
 * Si las dos contaran igual, el número no podría bajar nunca.
 *
 *   npx tsx scripts/probar-guarda-nombres.mts
 */

import { pideElNombre } from '../src/core/policies/nombres.js';

const PIDE: string[] = [
  'Perfecto! Me pasás tu nombre y apellido, el teléfono y a qué hora lo retirás?',
  'Dale! A nombre de quién lo anoto?',
  'Cómo te llamás?',
  'Antes de cargarlo, cuál es tu nombre?',
  'Necesito tu nombre completo para el pedido',
  'Decime tu nombre así lo anoto',
  'Me pasás nombre y apellido?',
  'Para terminar, tu nombre y el teléfono 😊',
  'Genial! Me das tu nombre para dejarlo anotado?',
];

const NO_PIDE: string[] = [
  // Lo que queremos que haga en su lugar.
  'Te lo anoto a nombre de Ariana Robles?',
  'Lo dejo a nombre de Sharon Ibañez, dale?',
  'Perfecto! Queda a nombre de Maite Ramos',
  'Confirmame el nombre: Ariana Robles?',
  // Nada que ver con el nombre del cliente.
  'El alias es miska.muska, a nombre de Agustina Resino',
  'Son $12.400 en total. Te paso el alias?',
  'Tenemos cookies de nutella, de chocolate y de dulce de leche',
  'Ya salió! El repartidor se llama Nelson',
  'Holaa! Contame qué estabas buscando 💕',
];

let fallas = 0;

for (const t of PIDE) {
  const dio = pideElNombre(t);
  console.log(`${dio ? 'ok   ' : 'FALLA'} PIDE      ${JSON.stringify(t)}`);
  if (!dio) fallas++;
}

console.log();

for (const t of NO_PIDE) {
  const dio = pideElNombre(t);
  console.log(`${dio ? 'FALLA' : 'ok   '} no pide   ${JSON.stringify(t)}`);
  if (dio) fallas++;
}

const total = PIDE.length + NO_PIDE.length;
console.log(fallas ? `\n${fallas} falla(s) de ${total}` : `\nTodo bien: ${total} frases.`);
process.exit(fallas ? 1 : 0);
