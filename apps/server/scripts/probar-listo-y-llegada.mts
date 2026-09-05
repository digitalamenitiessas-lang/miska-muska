/*
  Dos guardas de coherencia del final de la venta.

  1. Que el bot no contradiga al local cuando una persona ya dijo "está listo".
     El caso: pedido #3253, $37.000, alguien escribió "listo sofi para retirar!"
     y el bot le contestó "lo estamos chequeando y ya nos ponemos a armar tu
     pedido" dos mensajes después.

  2. Que "está afuera" se conteste con algo que le sirva a quien tiene un chofer
     en la vereda, y no con "ya le avisamos que está esperando" —que hizo que el
     local preguntara "¿a quién le avisa?"—.
*/
import { diceQueEstaListo, yaDijeronQueEstaListo } from '../src/core/policies/listo.js';
import { avisaQueLlego, RESPUESTA_A_LA_LLEGADA } from '../src/core/policies/llegadas.js';

let mal = 0;
const probar = (que: string, dio: boolean, espera: boolean) => {
  const ok = dio === espera;
  if (!ok) mal++;
  console.log(`  ${ok ? 'ok  ' : 'MAL '} ${espera ? 'SÍ ' : 'no '} ${que.slice(0, 74)}`);
};

console.log('=== el local dice que está listo ===\n');
for (const t of [
  'listo sofi para retirar!',
  'ya esta listo tu pedido',
  'siii ya esta listo',
  'esta lista!!',
  'ya impacto tu pago, tu pedido esta listo',
  'ya lo entregamos amor muchas gracias!',
  'pedi otro uber y le entregamos',
  'Ya esta listo su pedido!',
]) probar(t, diceQueEstaListo(t), true);

console.log('\n=== lo que se le parece y NO lo es ===\n');
for (const t of [
  'me podes pasar tu direccion y nombre y apellido porfa',
  'o en cuanto podes pasar?',
  'te esperamos mañana marilin',
  'apenas este listo te aviso',
  'te esperamos!',
  'y pedi el uber despues de enviar el comprobante',
  'cuando este listo te avisamos',
  'todavia no esta listo',
  'Si queres podes venir al local y comparar con las de 20 para que veas el tamaño',
]) probar(t, diceQueEstaListo(t), false);

console.log('\n=== y sobre el historial: solo cuenta lo que escribió una PERSONA ===\n');
const T1 = '2026-09-05T12:00:00.000Z';
const T2 = '2026-09-05T13:00:00.000Z';
const listoDeUnaPersona = [
  { direction: 'in', author: 'bot', text: 'hola', createdAt: T1 },
  { direction: 'out', author: 'human', text: 'listo sofi para retirar!', createdAt: T2 },
];
const listoDelBot = [
  { direction: 'out', author: 'bot', text: 'ya esta listo tu pedido', createdAt: T1 },
];
const entranteDelCliente = [
  { direction: 'in', author: 'bot', text: 'ya esta listo?', createdAt: T1 },
];
probar('una persona del local lo dijo', yaDijeronQueEstaListo(listoDeUnaPersona) !== null, true);
probar('devuelve CUANDO lo dijo', yaDijeronQueEstaListo(listoDeUnaPersona) === T2, true);
probar('lo dijo el bot: no cuenta', yaDijeronQueEstaListo(listoDelBot) !== null, false);
probar('lo dijo el cliente: no cuenta', yaDijeronQueEstaListo(entranteDelCliente) !== null, false);

console.log('\n=== avisan que el chofer llegó ===\n');
for (const t of ['Está afuera', 'ya esta el uber', 'el cadete esta en la puerta', 'Ya está llegando el Uber'])
  probar(t, avisaQueLlego(t), true);
for (const t of ['me llego todo gracias', 'llego el uber?', 'ahi esta el comprobante'])
  probar(t, avisaQueLlego(t), false);

console.log('\n=== la respuesta que va ===\n');
const r = RESPUESTA_A_LA_LLEGADA;
probar('nombra la ventanita', r.includes('ventanita'), true);
probar('pide que pregunte por su nombre', /pregunte por tu nombre/.test(r), true);
probar('NO dice "ya le avisamos"', /ya le avisamos/i.test(r), false);
probar('NO afirma una entrega que no pasó', /ya se lo entregamos/i.test(r), false);

console.log(`\n  ${mal === 0 ? 'todo bien' : mal + ' MAL'}`);
process.exit(mal ? 1 : 0);
