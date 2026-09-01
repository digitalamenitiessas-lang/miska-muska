/**
 * Comprueba `nombreDeWhatsApp()` contra los nombres de perfil que de verdad
 * aparecen en la base del local, no contra ejemplos inventados.
 *
 * El local pidió que el bot deje de preguntar el nombre, porque "ya lo sabe por
 * el WhatsApp". Lo sabe a medias: de 277 contactos, todos traen algo y casi
 * ninguno trae un nombre y apellido. Esta guarda decide qué se puede usar, y
 * los casos de acá abajo son los que hicieron que exista.
 *
 *   npx tsx scripts/probar-nombre-de-whatsapp.mts
 */

import { nombreDeWhatsApp } from '../src/core/policies/rules.js';

type Caso = {
  perfil: string | null;
  espera: { nombre: string; pareceCompleto: boolean } | null;
  porque: string;
};

const CASOS: Caso[] = [
  // --- Sirven, y alcanzan para cargar el pedido si el cliente los confirma ---
  {
    perfil: 'Ariana Robles',
    espera: { nombre: 'Ariana Robles', pareceCompleto: true },
    porque: 'el caso limpio: nombre y apellido, se confirma y no se pregunta',
  },
  {
    perfil: 'xime batueca',
    espera: { nombre: 'xime batueca', pareceCompleto: true },
    porque: 'en minúscula sigue siendo nombre y apellido',
  },
  {
    perfil: 'Lu Delgado 👑',
    espera: { nombre: 'Lu Delgado', pareceCompleto: true },
    porque: 'la corona se va, el apellido queda',
  },
  {
    perfil: 'María Fernández-Paz',
    espera: { nombre: 'María Fernández-Paz', pareceCompleto: true },
    porque: 'tildes y guion intactos: hay apellidos así',
  },
  {
    perfil: "Malena O'Connor",
    espera: { nombre: "Malena O'Connor", pareceCompleto: true },
    porque: 'el apóstrofo tampoco se toca',
  },

  {
    perfil: 'Ana❤️Robles',
    espera: { nombre: 'Ana Robles', pareceCompleto: true },
    porque: 'el emoji PEGADO entre dos letras: el selector de variación no puede quedar adentro',
  },
  {
    perfil: '1️⃣Ana',
    espera: { nombre: 'Ana', pareceCompleto: false },
    porque: 'el keycap deja dos marcas invisibles, y las dos tienen que irse',
  },
  {
    perfil: 'José Günther',
    espera: { nombre: 'José Günther', pareceCompleto: true },
    porque: 'el acento descompuesto se compone, no se pierde: es lo que hace que el panel lo encuentre',
  },

  // --- Sirven para saludar, pero falta el apellido ---
  {
    perfil: 'Maite',
    espera: { nombre: 'Maite', pareceCompleto: false },
    porque: 'nombre de pila solo: se saluda con él y se pide el apellido',
  },
  {
    perfil: 'SofiSalvatierra✨',
    espera: { nombre: 'SofiSalvatierra', pareceCompleto: false },
    porque: 'pegado es una sola palabra, así que no se da por completo',
  },
  {
    perfil: 'Fernanda🖤',
    espera: { nombre: 'Fernanda', pareceCompleto: false },
    porque: 'el corazón se va',
  },
  {
    perfil: 'Pato⚽️👩🏽',
    espera: { nombre: 'Pato', pareceCompleto: false },
    porque: 'los emojis con modificador de tono tampoco dejan restos',
  },
  {
    perfil: 'Lu🏹',
    espera: { nombre: 'Lu', pareceCompleto: false },
    porque: 'dos letras es el mínimo, y Lu llega',
  },

  // --- No sirven para nada: mejor no pasarle nada al modelo ---
  {
    perfil: '.',
    espera: null,
    porque: 'hay DOS contactos que se llaman así; saludar a "." es peor que no saludar',
  },
  {
    perfil: '+5493812154991',
    espera: null,
    porque: 'el fallback del adaptador cuando el perfil no tiene nombre',
  },
  {
    perfil: '+54 9 381 215-4991',
    espera: null,
    porque: 'el mismo teléfono con separadores',
  },
  {
    perfil: '🌸🌸🌸',
    espera: null,
    porque: 'solo emojis: no queda ninguna letra',
  },
  {
    perfil: 'A',
    espera: null,
    porque: 'una letra sola no es un nombre',
  },
  { perfil: '', espera: null, porque: 'vacío' },
  { perfil: null, espera: null, porque: 'sin dato' },
];

let fallas = 0;
for (const { perfil, espera, porque } of CASOS) {
  const dio = nombreDeWhatsApp(perfil);
  const ok =
    (dio === null && espera === null) ||
    (dio !== null &&
      espera !== null &&
      dio.nombre === espera.nombre &&
      dio.pareceCompleto === espera.pareceCompleto);
  const mostrar = (v: typeof dio) => (v ? `"${v.nombre}"${v.pareceCompleto ? ' +apellido' : ''}` : 'nada');
  console.log(`${ok ? 'ok   ' : 'FALLA'} ${JSON.stringify(perfil)} -> ${mostrar(dio)}   (${porque})`);
  if (!ok) {
    fallas++;
    console.log(`         esperaba: ${mostrar(espera)}`);
  }
}

console.log(fallas ? `\n${fallas} falla(s)` : `\nTodo bien: ${CASOS.length} casos.`);
process.exit(fallas ? 1 : 0);
