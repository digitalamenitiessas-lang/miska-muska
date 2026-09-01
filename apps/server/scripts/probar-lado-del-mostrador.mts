/**
 * De qué lado del mostrador habla el bot.
 *
 * Salió "hoy retiramos hasta las 21:30". Retirar lo hace la clienta; el local no
 * retira nada. Dicho en primera persona del plural queda al revés, y a quien lo
 * lee le suena a que somos nosotros los que vamos a buscar el pedido.
 *
 * La tabla es cerrada a propósito, así que este script vale sobre todo por los
 * casos de abajo que NO hay que tocar: "retiramos" tiene usos correctos.
 *
 *   npx tsx scripts/probar-lado-del-mostrador.mts
 */

import { normalizeWriting } from '../src/core/policies/writing.js';

type Caso = { entra: string; sale: string; porque: string };

const CASOS: Caso[] = [
  // --- Se corrige ---
  {
    entra: 'Sí, sin problema, hoy retiramos hasta las 21:30 🙌',
    sale: 'Sí, sin problema, hoy estamos hasta las 21:30 🙌',
    porque: 'el caso que reportó el local, textual',
  },
  {
    entra: 'Retiramos de 9 a 21:30',
    sale: 'Estamos de 9 a 21:30',
    porque: 'el mismo error con el rango horario',
  },
  {
    entra: 'Retiramos desde las 9 de la mañana',
    sale: 'Estamos desde las 9 de la mañana',
    porque: 'y con "desde"',
  },
  {
    entra: 'Retiramos los sábados hasta las 22',
    sale: 'Estamos los sábados hasta las 22',
    porque: 'con el día en vez de la hora',
  },

  // --- NO se toca: acá "retiramos" está bien dicho ---
  {
    entra: 'Si no lo retiran hoy, lo retiramos de la vitrina a la noche',
    sale: 'Si no lo retiran hoy, lo retiramos de la vitrina a la noche',
    porque: 'acá SÍ lo hace el local: no puede tocarse',
  },
  {
    entra: 'Podés retirarlo en el local hasta las 21:30',
    sale: 'Podés retirarlo en el local hasta las 21:30',
    porque: 'la forma correcta, en segunda persona',
  },
  {
    entra: 'Hoy estamos hasta las 21:30',
    sale: 'Hoy estamos hasta las 21:30',
    porque: 'ya está bien: no se toca dos veces',
  },
  {
    entra: 'El pedido lo retira un Uber que pedís vos',
    sale: 'El pedido lo retira un Uber que pedís vos',
    porque: 'tercera persona, correcta',
  },
];

let fallas = 0;
for (const { entra, sale, porque } of CASOS) {
  const dio = normalizeWriting(entra).text;
  const ok = dio === sale;
  console.log(`${ok ? 'ok   ' : 'FALLA'} ${JSON.stringify(entra.slice(0, 60))}`);
  if (!ok) {
    fallas++;
    console.log(`         dio:      ${JSON.stringify(dio)}`);
    console.log(`         esperaba: ${JSON.stringify(sale)}   (${porque})`);
  }
}

console.log(fallas ? `\n${fallas} falla(s) de ${CASOS.length}` : `\nTodo bien: ${CASOS.length} casos.`);
process.exit(fallas ? 1 : 0);
