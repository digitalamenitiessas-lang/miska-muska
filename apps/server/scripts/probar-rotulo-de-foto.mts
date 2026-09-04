/*
  La foto que el bot manda tiene que quedar registrada CON EL NOMBRE del
  producto, aunque el epígrafe no salga.

  Es el caso de Dani: dos fotos seguidas, "la segunda cuál es?", y el bot
  contestó Box Requete Feliz $23.000 cuando era el Desayuno Miska Muska de
  $40.000. En el historial las dos decían "[imagen]" y no había con qué acertar.
*/
import { describeOutbound } from '../src/core/types/message.js';

type Caso = { que: string; contenido: Parameters<typeof describeOutbound>[0]; espera: string };

const casos: Caso[] = [
  {
    que: 'foto sola, sin epígrafe: queda el rótulo',
    contenido: { kind: 'image', url: 'https://x/y.jpg', alt: 'Box Requete Feliz' },
    espera: '[imagen] Box Requete Feliz',
  },
  {
    que: 'el epígrafe manda cuando lo hay',
    contenido: { kind: 'image', url: 'https://x/y.jpg', caption: 'Mirá qué linda', alt: 'Cookie dubai' },
    espera: '[imagen] Mirá qué linda',
  },
  {
    que: 'sin nada, sigue siendo una imagen',
    contenido: { kind: 'image', url: 'https://x/y.jpg' },
    espera: '[imagen]',
  },
  {
    que: 'las dos cartas se distinguen',
    contenido: { kind: 'image', url: 'https://x/y.jpg', alt: 'Carta de cafetería' },
    espera: '[imagen] Carta de cafetería',
  },
  {
    que: 'el texto no se toca',
    contenido: { kind: 'text', text: 'Hola!' },
    espera: 'Hola!',
  },
];

let mal = 0;
for (const c of casos) {
  const dio = describeOutbound(c.contenido);
  const ok = dio === c.espera;
  if (!ok) mal++;
  console.log(`  ${ok ? 'ok  ' : 'MAL '} ${c.que.padEnd(44)} ${JSON.stringify(dio)}`);
}
console.log(`\n  ${casos.length - mal}/${casos.length} bien`);
process.exit(mal ? 1 : 0);
