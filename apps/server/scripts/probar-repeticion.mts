/**
 * El bot no dice dos veces lo mismo.
 *
 * Los mensajes de abajo son los de la charla real que motivó la guarda: una
 * clienta recibió SEIS veces el mismo texto mientras contestaba "ya te lo
 * mandé" y "es joda?".
 *
 * Lo que importa acá es la segunda mitad: los acuses cortos SÍ se repiten en una
 * charla normal, y una guarda que también los frene deja al bot mudo.
 *
 *   npx tsx scripts/probar-repeticion.mts
 */

import { yaLoDijo, type MensajeParaRepeticion } from '../src/core/policies/repeticion.js';

const AHORA = new Date('2026-09-03T21:12:00Z').getTime();
const haceMinutos = (m: number) => new Date(AHORA - m * 60_000).toISOString();

const ALIAS =
  'Te paso el alias y apenas me mandes el comprobante te doy la dirección, así ya pedís el Uber 🫶🏻\nmiskapedidos (Mathias Exequiel Lovey)';

const historia: MensajeParaRepeticion[] = [
  { direction: 'in', author: 'human', text: 'Por favor', createdAt: haceMinutos(3) },
  { direction: 'out', author: 'bot', text: ALIAS, createdAt: haceMinutos(2) },
  { direction: 'in', author: 'human', text: 'Ya te lo mande', createdAt: haceMinutos(1) },
];

type Caso = { nombre: string; texto: string; historia: MensajeParaRepeticion[]; espera: boolean };

const CASOS: Caso[] = [
  {
    nombre: 'el caso real: el mismo mensaje del alias, dos minutos después',
    texto: ALIAS,
    historia,
    espera: true,
  },
  {
    nombre: 'el mismo texto con otros emojis y espacios sigue siendo el mismo',
    texto:
      'Te paso el alias y apenas me mandes el comprobante te doy la dirección,  así ya pedís el Uber 💕  miskapedidos (Mathias Exequiel Lovey)',
    historia,
    espera: true,
  },
  {
    nombre: 'el mismo mensaje pero de hace media hora: puede ir',
    texto: ALIAS,
    historia: [{ ...historia[1], createdAt: haceMinutos(31) }],
    espera: false,
  },
  {
    nombre: 'lo dijo una PERSONA del local, no el bot: no se toca',
    texto: ALIAS,
    historia: [{ ...historia[1], author: 'human' }],
    espera: false,
  },
  {
    nombre: 'un mensaje largo distinto',
    texto:
      'Perfecto! Entonces son 2 cookies de nutella y oreo, $10.000 en total. Te las mandamos con el Uber que pidas vos.',
    historia,
    espera: false,
  },

  // --- Los cortos SÍ se repiten, y tienen que poder ---
  {
    nombre: 'un acuse corto repetido: es normal en una charla',
    texto: 'Dale, cualquier cosa avisame 💕',
    historia: [
      { direction: 'out', author: 'bot', text: 'Dale, cualquier cosa avisame 💕', createdAt: haceMinutos(2) },
    ],
    espera: false,
  },
  {
    nombre: 'un gracias repetido',
    texto: 'Gracias a vos! 🥰',
    historia: [
      { direction: 'out', author: 'bot', text: 'Gracias a vos! 🥰', createdAt: haceMinutos(1) },
    ],
    espera: false,
  },
  {
    nombre: 'la dirección repetida, que es larga: eso sí se frena',
    texto: 'Nuestra dirección es Marcos Paz 473, San Miguel de Tucumán. Te esperamos! 📍',
    historia: [
      {
        direction: 'out',
        author: 'bot',
        text: 'Nuestra dirección es Marcos Paz 473, San Miguel de Tucumán. Te esperamos! 📍',
        createdAt: haceMinutos(4),
      },
    ],
    espera: true,
  },
  { nombre: 'sin historia, no hay con qué comparar', texto: ALIAS, historia: [], espera: false },
];

let fallas = 0;
for (const c of CASOS) {
  const dio = yaLoDijo(c.texto, c.historia, AHORA);
  const ok = dio === c.espera;
  console.log(`${ok ? 'ok   ' : 'FALLA'} ${c.espera ? 'frena ' : 'pasa  '} ${c.nombre}`);
  if (!ok) fallas++;
}

console.log(fallas ? `\n${fallas} falla(s) de ${CASOS.length}` : `\nTodo bien: ${CASOS.length} casos.`);
process.exit(fallas ? 1 : 0);
