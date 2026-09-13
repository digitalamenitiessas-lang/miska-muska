/**
 * El cadete: el termómetro, con los patrones arreglados.
 *
 * OJO: esto NO bloquea. Estuvo a punto de salir como guarda dura y no salió —los
 * dos mensajes que el local marcó resultaron correctos: uno era un box que el
 * propio local entregó con su cadete cobrando $4.000 de envío, el otro un
 * desayuno—. Lo que se arregló son los patrones, que marcaban cero por un orden
 * de palabras invertido.
 *
 * El sábado de lluvia, con un solo cadete en el centro, el termómetro marcó CERO
 * mientras el bot escribía estos dos:
 *
 *   16:56  "Ahora el local ve si consigue cadete, sino te recomendamos pedir
 *           Uber Auto que llega rápido"
 *   18:06  "Tenés razón, nosotros lo llevamos 🙌🏼 ya sale para tu zona, avisanos
 *           cuando estés cerca para que el cadete sepa dónde ir"
 *
 * No los vio por una razón tonta: buscaba "lo llevamos nosotros" y el bot
 * escribió "nosotros lo llevamos". Los dos están acá abajo como casos.
 *
 * Lo que más importa medir sigue siendo lo que NO tiene que marcar: el bot
 * diciendo que no hay cadete —que es la respuesta correcta y la manda varias
 * veces por día— y el cadete que manda el cliente, que no es el nuestro. Si
 * algún día esto pasa a bloquear, esos son los casos que lo van a decidir.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-guarda-cadete-texto.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { ofreceCadeteDeMas } from '../src/core/policies/cadete.js';

type Caso = { nombre: string; texto: string; contexto?: string; frena: boolean };

const CASOS: Caso[] = [
  // --- Los dos del sábado de lluvia ---
  {
    nombre: 'EL DEL SÁBADO: "nosotros lo llevamos", orden invertido',
    texto:
      'Tenés razón, nosotros lo llevamos 🙌🏼 ya sale para tu zona, avisanos cuando estés cerca para que el cadete sepa dónde ir 💕',
    frena: true,
  },
  {
    nombre: 'EL OTRO DEL SÁBADO: "ve si consigue cadete"',
    texto: 'Recibido! Ahora el local ve si consigue cadete, sino te recomendamos pedir Uber Auto que llega rápido 🙌🏼',
    frena: true,
  },
  {
    nombre: 'las dos opciones, que es como empezó todo',
    texto:
      'Claro! Tenemos dos opciones: Nuestro cadete lo lleva al domicilio, el costo depende de la zona. O un Uber que mandes vos.',
    frena: true,
  },
  {
    nombre: 'promete el cadete sin nombrar el producto (lo dice el contexto)',
    texto: 'Dale, te lo llevamos nosotros a tu casa 🙌🏼',
    contexto: 'quiero dos cookies kinder y un brownie',
    frena: true,
  },
  // --- Lo que NO se toca ---
  {
    nombre: 'dice que NO hay cadete, la respuesta correcta',
    texto:
      'Por el momento estamos sin cadete disponible por la alta demanda 🙈 lo que sí podés hacer es mandar un Uber Moto a retirarlo.',
    frena: false,
  },
  {
    nombre: 'explica que el cadete es solo para desayunos',
    texto: 'Nuestro cadete lo usamos solo para desayunos y boxes de regalo 🙈 El Box de Cookies lo retirás con un Uber Moto.',
    frena: false,
  },
  {
    nombre: 'un desayuno: el cadete corresponde',
    texto: 'Los desayunos los llevamos nosotros con nuestro cadete 🚗 Necesito la dirección.',
    frena: false,
  },
  {
    nombre: 'un box: también corresponde',
    texto: 'El Box Requete Feliz te lo llevamos nosotros, es un regalo y alguien tiene que tocar el timbre 💕',
    frena: false,
  },
  {
    nombre: 'el cadete que manda el CLIENTE',
    texto: 'Perfecto, avisanos cuando mandes tu cadete y lo dejamos listo en la ventanita 🙌🏼',
    frena: false,
  },
  {
    nombre: 'recomienda el Uber por sobre el cadete',
    texto: 'El Uber Moto te llega más rápido que con nuestro cadete, y lo seguís desde la app.',
    frena: false,
  },
  {
    nombre: 'nada que ver',
    texto: 'Hoy tenemos cookies Kinder, Dubai y Ferrero, todas a $5.000. Cuál te late?',
    frena: false,
  },
];

let mal = 0;
console.log('\n  Casos\n');
for (const c of CASOS) {
  const r = ofreceCadeteDeMas(c.texto, c.contexto ?? '');
  const frena = r !== null;
  const ok = frena === c.frena;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${c.frena ? 'marca ' : 'limpio'} ${c.nombre}`);
  if (!ok) console.log(`      dio: ${r ?? '(nada)'}`);
}

/* El corpus: cuántas marca por día, y sobre todo cuántas de más. */
openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const msgs = await q<{ d: string; text: string; c: string; created_at: string }>(
  `select to_char(created_at at time zone $1,'DD/MM') d, text, conversation_id c, created_at
   from messages
   where direction='out' and author='bot' and text is not null
     and created_at > now() - interval '10 days'
   order by created_at asc`,
  [TIMEZONE],
);
const humanos = await q<{ c: string; t: string }>(
  `select conversation_id c, min(created_at) t from messages
   where direction='out' and author='human' and created_at > now() - interval '10 days'
   group by 1`,
);
const primero = new Map(humanos.map((h) => [h.c, new Date(h.t).getTime()]));

const porDia = new Map<string, number>();
const previos = new Map<string, string[]>();
const ejemplos: string[] = [];
for (const m of msgs) {
  const t0 = primero.get(m.c);
  const yaHablo = t0 !== undefined && t0 < new Date(m.created_at).getTime();
  const ctx = (previos.get(m.c) ?? []).slice(-6).join(' ');
  previos.set(m.c, [...(previos.get(m.c) ?? []), m.text].slice(-6));
  if (yaHablo) continue;
  const r = ofreceCadeteDeMas(m.text, ctx);
  if (!r) continue;
  porDia.set(m.d, (porDia.get(m.d) ?? 0) + 1);
  if (ejemplos.length < 8) ejemplos.push(`  ${m.d} [${r}] ${m.text.replace(/\s+/g, ' ').slice(0, 105)}`);
}
const total = [...porDia.values()].reduce((a, b) => a + b, 0);

console.log(`\n  Corpus: ${msgs.length} mensajes del bot de 10 días. Marcaría:\n`);
for (const [d, n] of [...porDia].sort()) console.log(`    ${d}   ${n}`);
console.log(`\n  ${total} en 10 días · ${(total / 10).toFixed(1)} por día`);
console.log('\n  Una muestra:\n' + ejemplos.join('\n'));
console.log(mal ? `\n  ${mal} casos fallaron.\n` : '\n  Los casos pasan todos.\n');

await closeDb();
process.exit(mal ? 1 : 0);
