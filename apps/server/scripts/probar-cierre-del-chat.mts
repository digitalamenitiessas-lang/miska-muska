/**
 * Comprueba la única regla que Anthropic NO hace cumplir: el pedido al modelo
 * tiene que terminar con un mensaje del cliente.
 *
 * Existe porque el bug es invisible del lado de Anthropic (en vez de fallar,
 * continúa la frase del bot como si fuera un prefill). Los que sí lo rechazan
 * con un 400 son Google Vertex y Azure, y OpenRouter rutea a los tres. Si
 * alguien saca la nota de cierre, esto avisa; la producción no.
 *
 *   npx tsx scripts/probar-cierre-del-chat.mts
 */

import { toApiMessages } from '../src/core/agent/brain.js';
import type { StoredMessage } from '../src/core/types/domain.js';

type Linea = [dir: "in" | "out", autor: "human" | "bot" | "system", texto: string];

function historial(lineas: Linea[]): StoredMessage[] {
  return lineas.map(([direction, author, text], i) => ({
    id: `m${i}`,
    direction,
    author,
    text,
    contentKind: 'text',
  })) as unknown as StoredMessage[];
}

const casos: Array<{ nombre: string; lineas: Linea[] }> = [
  {
    nombre: 'el local contesta una consulta y el bot retoma',
    lineas: [
      ['in', 'human', 'hola, tienen torta sin tacc para el sabado?'],
      ['out', 'bot', 'Dejame consultarlo con el local y te aviso!'],
    ],
  },
  {
    nombre: 'escribio el operador y despues se fuerza el turno',
    lineas: [
      ['in', 'human', 'cuanto sale?'],
      ['out', 'bot', 'Ahora te digo'],
      ['out', 'human', 'son 12000'],
    ],
  },
  {
    nombre: 'charla normal, termina el cliente (no se toca)',
    lineas: [
      ['in', 'human', 'hola'],
      ['out', 'bot', 'Hola! En que te ayudo?'],
      ['in', 'human', 'queria una torta'],
    ],
  },
  {
    nombre: 'arranca el bot: se recorta el principio y no queda nada del cliente',
    lineas: [
      ['out', 'bot', 'Hola! Somos Miska Muska'],
      ['in', 'human', 'hola'],
    ],
  },
];

let fallas = 0;
for (const { nombre, lineas } of casos) {
  const msgs = toApiMessages(historial(lineas));
  const ultimo = msgs.at(-1);
  const ok = msgs.length > 0 && ultimo?.role === 'user';
  console.log(`${ok ? 'ok  ' : 'FALLA'} ${nombre}`);
  if (!ok) {
    fallas++;
    console.log('       termina en:', ultimo?.role ?? '(vacio)');
  }
}

// El cierre se agrega solo cuando hace falta: no debe ensuciar una charla sana.
const sana = toApiMessages(historial([['in', 'human', 'hola']]));
if (sana.length !== 1) {
  fallas++;
  console.log('FALLA la charla que ya terminaba en el cliente recibio una nota de mas');
}

console.log(fallas ? `
${fallas} falla(s)` : `
Todo bien: ${casos.length + 1} casos.`);
process.exit(fallas ? 1 : 0);
