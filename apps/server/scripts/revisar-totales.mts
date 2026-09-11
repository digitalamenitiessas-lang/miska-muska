/**
 * ¿El bot suma bien?
 *
 * Del local, 15:47: "está haciendo mal la suma de los totales, está mandando
 * totales de pedidos que no corresponden".
 *
 * Esto no necesita el catálogo ni la base de pedidos: la cuenta está entera
 * DENTRO del mensaje. El bot escribe los renglones con su precio y abajo un
 * TOTAL. Se suman los renglones y se compara. Si no da, la suma está mal y no
 * hay nada que interpretar.
 *
 * Dos cosas que hay que leer bien o el resultado es basura:
 *
 *   - LAS CANTIDADES. "3 Budín carrot $4.000 c/u" son $12.000, no $4.000. Pero
 *     "Alfajor x3 — $12.900" YA es el subtotal. Lo que los separa es el "c/u":
 *     con c/u el precio es unitario y se multiplica; sin c/u ya viene sumado.
 *   - LA PROSA. "nuestras cajas de regalo van a partir de $26.000" tiene un
 *     precio y no es un renglón de la cuenta. Los renglones empiezan con un
 *     emoji, un guion o un número; la prosa empieza con una letra.
 *
 * Se parte por modelo para saber si esto empezó hoy o venía de antes.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/revisar-totales.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

/** El día y hora en que se cambió el modelo, en la hora de Tucumán. */
const HAIKU_DESDE = '11/09 08:06';

/**
 * Los pesos de un texto. En Argentina el punto separa los miles ("$12.900"), así
 * que se BORRA y no se interpreta como decimal.
 */
function pesos(texto: string): number[] {
  return [...texto.matchAll(/\$\s?([\d.]+)/g)]
    .map((m) => Number(m[1].replace(/\./g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** La cantidad de un renglón: "3 Budín", "2x Muffin", "Alfajor x3". */
function cantidad(linea: string): number {
  const m =
    linea.match(/(?:^|[^\w$])(\d{1,2})\s*x\b/i) ??
    linea.match(/\bx\s*(\d{1,2})\b/i) ??
    linea.match(/^[^\w$]*(\d{1,2})\s+[a-záéíóúñ]/i);
  const n = m ? Number(m[1]) : 1;
  return n >= 1 && n <= 50 ? n : 1;
}

/** Un renglón de la cuenta empieza con emoji, guion o número. La prosa, con letra. */
function esRenglon(linea: string): boolean {
  const l = linea.trim();
  if (!l || pesos(l).length !== 1) return false;
  if (/total/i.test(l)) return false;
  return !/^[a-záéíóúñ¿¡"(]/i.test(l);
}

const msgs = await q<{ conversation_id: string; text: string; t: string }>(
  `select conversation_id, text, to_char(created_at at time zone $1,'DD/MM HH24:MI') t
   from messages
   where direction='out' and author='bot' and text is not null
     and text ~* 'total'
     and created_at > now() - interval '7 days'
   order by created_at asc`,
  [TIMEZONE],
);

let mirados = 0;
const malos: Array<{ t: string; conv: string; dijo: number; suma: number; texto: string }> = [];

for (const m of msgs) {
  const lineas = m.text.split('\n');
  const iTotal = lineas.findIndex((l) => /total/i.test(l) && /\$/.test(l));
  if (iTotal <= 0) continue;

  const enElTotal = pesos(lineas[iTotal]);
  if (enElTotal.length !== 1) continue;
  const dijo = enElTotal[0];

  const renglones = lineas.slice(0, iTotal).filter(esRenglon);
  if (renglones.length < 2) continue;

  const suma = renglones.reduce((s, l) => {
    const precio = pesos(l)[0];
    // Con "c/u" el precio es unitario; sin "c/u" el renglón ya viene sumado.
    return s + (/c\/u|cada un|c\/u\./i.test(l) ? precio * cantidad(l) : precio);
  }, 0);
  mirados++;

  if (suma !== dijo) {
    malos.push({ t: m.t, conv: m.conversation_id, dijo, suma, texto: m.text.replace(/\s+/g, ' ').slice(0, 230) });
  }
}

const ar = (n: number) => '$' + n.toLocaleString('es-AR');

console.log(`\n  ${mirados} mensajes con una cuenta revisable, de 7 días.\n`);
if (!malos.length) {
  console.log('  Todas las sumas dan.\n');
} else {
  for (const b of malos) {
    const nuevo = b.t >= HAIKU_DESDE;
    const dif = b.dijo - b.suma;
    console.log(
      `  ${b.t} ${nuevo ? '(HAIKU) ' : '(sonnet)'} dijo ${ar(b.dijo)}, da ${ar(b.suma)} → ${dif > 0 ? 'cobra de más' : 'cobra de menos'} ${ar(Math.abs(dif))}`,
    );
    console.log(`     ${b.conv}`);
    console.log(`     ${b.texto}\n`);
  }
  const nuevos = malos.filter((b) => b.t >= HAIKU_DESDE).length;
  console.log(`  ${malos.length} de ${mirados} (${((malos.length / mirados) * 100).toFixed(1)}%).`);
  console.log(`  ${nuevos} con el modelo nuevo, ${malos.length - nuevos} con el anterior.\n`);
}

await closeDb();
