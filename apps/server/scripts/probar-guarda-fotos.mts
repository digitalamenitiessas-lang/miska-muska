/**
 * La foto sale ANTES del texto, así que anunciarla es contar algo que ya pasó.
 *
 * La prohibición está en el prompt y en la descripción de `mandar_foto`, y aun
 * así salió tres veces en producción. La última fue "Ahí tenés toda la carta!"
 * con la carta arriba, y el local la marcó con un "ahí ta feo jaja".
 *
 *   npx tsx scripts/probar-guarda-fotos.mts
 */

import { sinAnuncioDeFoto } from '../src/core/policies/writing.js';

type Caso = { entra: string; sale: string; porque: string };

const CASOS: Caso[] = [
  // --- Se corta ---
  {
    entra: 'Ahí tenés toda la carta! Te gustaría encargar alguna? 🍪',
    sale: 'Te gustaría encargar alguna? 🍪',
    porque: 'el caso que reportó el local, textual',
  },
  {
    entra: 'Ahí la tenés! Contame qué producto te gustaría y te cuento si lo tenemos en stock',
    sale: 'Contame qué producto te gustaría y te cuento si lo tenemos en stock',
    porque: 'la variante corta',
  },
  {
    entra: 'Ahí te mando las dos. Fijate cuál te gusta más y armamos el pedido',
    sale: 'Fijate cuál te gusta más y armamos el pedido',
    porque: 'dos fotos, mismo anuncio',
  },
  {
    entra: 'Te paso la carta! Contame qué te tienta',
    sale: 'Contame qué te tienta',
    porque: 'anuncio sin "ahí"',
  },
  {
    entra: 'Mirá, esta es la carta con todo lo que tenemos! Contame qué buscabas',
    sale: 'Contame qué buscabas',
    porque: 'salió así en producción el 31 de agosto',
  },
  {
    entra: 'Acá lo tenés. El curso arranca el martes y quedan tres lugares',
    sale: 'El curso arranca el martes y quedan tres lugares',
    porque: 'el flyer de un curso',
  },

  // --- No se toca ---
  {
    entra: 'Contame qué producto te gustaría y te cuento si lo tenemos en stock',
    sale: 'Contame qué producto te gustaría y te cuento si lo tenemos en stock',
    porque: 'lo que queremos que escriba: sin anuncio, no hay nada que cortar',
  },
  {
    entra: 'Ahí tenés razón, me confundí con el precio',
    sale: 'Ahí tenés razón, me confundí con el precio',
    porque: 'no es un anuncio y además cortar dejaría minúscula',
  },
  {
    entra: 'Ahí va, dale un minuto que lo confirmo con el local',
    sale: 'Ahí va, dale un minuto que lo confirmo con el local',
    porque: 'coma y no signo: es una sola oración, cortarla la arruina',
  },
  {
    entra: 'Si querés venir a merendar es por orden de llegada 💕',
    sale: 'Si querés venir a merendar es por orden de llegada 💕',
    porque: 'un epígrafe normal',
  },
  {
    entra: 'Te paso el alias: miskapedidos. Cuando transfieras mandame la captura',
    sale: 'Te paso el alias: miskapedidos. Cuando transfieras mandame la captura',
    porque: 'IMPORTANTE: "te paso el alias" NO es una foto y no se toca',
  },
  {
    entra: 'Te mando la dirección: Marcos Paz 473. Pedí el Uber cuando quieras',
    sale: 'Te mando la dirección: Marcos Paz 473. Pedí el Uber cuando quieras',
    porque: 'tampoco es una foto',
  },
];

let fallas = 0;
for (const { entra, sale, porque } of CASOS) {
  const dio = sinAnuncioDeFoto(entra);
  const ok = dio === sale;
  console.log(`${ok ? 'ok   ' : 'FALLA'} ${JSON.stringify(entra.slice(0, 62))}`);
  if (!ok) {
    fallas++;
    console.log(`         dio:     ${JSON.stringify(dio)}`);
    console.log(`         esperaba:${JSON.stringify(sale)}   (${porque})`);
  }
}

console.log(fallas ? `\n${fallas} falla(s) de ${CASOS.length}` : `\nTodo bien: ${CASOS.length} casos.`);
process.exit(fallas ? 1 : 0);
