/**
 * Con quién lo está consultando no se cuenta.
 *
 * La regla existe en la prosa hace rato y la pidió el local así: "que en ningún
 * momento diga dónde deriva, el local, la encargada o lo que sea". Nadie que
 * atiende un mostrador dice "lo consulto con la encargada": dice "ahora lo
 * chequeo y te confirmo".
 *
 * El prompt no alcanzó: 299 veces en catorce días, 21 por día.
 *
 * Esta guarda CORRIGE el texto y sigue de largo — no frena ninguna venta, no
 * manda a nadie a la bandeja. Así que el riesgo no es bloquear de más sino
 * reescribir mal, y por eso la mitad de los casos de abajo son frases donde "en
 * el local" o "cocina" están BIEN dichos y no se tocan.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-donde-consulta.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { normalizeWriting } from '../src/core/policies/writing.js';

const CASOS: Array<[string, string]> = [
  // --- Se corrige ---
  ['Ahora lo chequeo con el local y te confirmo 🙌🏼', 'Ahora lo chequeo y te confirmo 🙌🏼'],
  ['Ya lo estamos chequeando en el local 🙏🏻', 'Ya lo estamos chequeando 🙏🏻'],
  ['Eso lo consulto en cocina y te aviso', 'Eso lo consulto y te aviso'],
  ['Ya le paso esto a alguien del local para que te confirme', 'Ya le paso esto para que te confirme'],
  ['Le paso esto a la encargada y en un rato te responde', 'Le paso esto y en un rato te responde'],
  ['Sigo esperando la confirmación de cocina 🙈', 'Sigo esperando la confirmación 🙈'],
  ['Dejame que lo chequeo con cocina', 'Dejame que lo chequeo'],

  // --- NO se toca: "en el local" y "cocina" bien dichos ---
  ['Podés retirarlo en el local hasta las 21:30', 'Podés retirarlo en el local hasta las 21:30'],
  ['Con tarjeta se puede, pero en el local', 'Con tarjeta se puede, pero en el local'],
  ['Te esperamos en el local 🩷', 'Te esperamos en el local 🩷'],
  [
    'El precio te lo confirman en el local cuando vayas a pedirlo',
    'El precio te lo confirman en el local cuando vayas a pedirlo',
  ],
  [
    'Coordinamos la entrega en el local, decime a qué hora pasás',
    'Coordinamos la entrega en el local, decime a qué hora pasás',
  ],
  [
    'En un rato te escribe alguien del local con la confirmación',
    'En un rato te escribe alguien del local con la confirmación',
  ],
  ['Hoy tenemos cookies Kinder y Dubai a $5.000', 'Hoy tenemos cookies Kinder y Dubai a $5.000'],
];

let mal = 0;
console.log('\n  Casos\n');
for (const [entra, espera] of CASOS) {
  const sale = normalizeWriting(entra).text;
  const ok = sale === espera;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${entra.slice(0, 62)}`);
  if (!ok) console.log(`      esperaba: ${espera}\n      salió:    ${sale}`);
}

/*
  El corpus. Acá lo que se mira es el ANTES y el DESPUÉS de cada mensaje que
  tocaría: un falso positivo en esta guarda no es ruido en un log, es una
  oración rota mandada a una clienta.
*/
openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const msgs = await q<{ d: string; text: string }>(
  `select to_char(created_at at time zone $1,'DD/MM') d, text
   from messages
   where direction='out' and author='bot' and text is not null
     and created_at > now() - interval '14 days'`,
  [TIMEZONE],
);

let tocaria = 0;
let rotos = 0;
const muestra: string[] = [];
for (const m of msgs) {
  const r = normalizeWriting(m.text);
  if (!r.fixes.includes('dónde se consulta')) continue;
  tocaria++;
  /*
    Una oración rota deja una preposición colgando, un espacio doble o un signo
    despegado. Se mira RENGLÓN POR RENGLÓN y no el mensaje entero: los saltos de
    párrafo y la sangría de las listas son espacios en blanco legítimos, y
    mirarlos todos juntos marcaba casi cualquier mensaje de varios renglones.
  */
  const roto = r.text
    .split('\n')
    .some((l) => /\s(con|a|de|en|al|del|para)\s*[.,;!?]|\s(con|a|de|en|al|del)\s*$|\S {2,}\S|\s[.,;]/.test(l));
  if (roto) {
    rotos++;
    console.log(`  ⚠ quedó raro: ${r.text.replace(/\s+/g, ' ').slice(0, 110)}`);
  }
  if (muestra.length < 6)
    muestra.push(
      `    antes: ${m.text.replace(/\s+/g, ' ').slice(0, 92)}\n    ahora: ${r.text.replace(/\s+/g, ' ').slice(0, 92)}`,
    );
}

console.log(`\n  Corpus: ${msgs.length} mensajes del bot de 14 días`);
console.log(`  tocaría ${tocaria} (${(tocaria / 14).toFixed(1)} por día) · quedaron raros: ${rotos}`);
if (rotos) mal++;
console.log('\n  Una muestra:\n\n' + muestra.join('\n\n'));
console.log(mal ? `\n  ${mal} problemas.\n` : '\n  Los casos pasan todos.\n');

await closeDb();
process.exit(mal ? 1 : 0);
