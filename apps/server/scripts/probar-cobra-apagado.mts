/**
 * No se cobra lo que hoy no hay.
 *
 * El 12 de septiembre a las 18:13 el bot escribió "2 x Cookie kinder, 1 x
 * Brownie pistacho, 1 x Alfajor block, Total: $19.800, te paso el alias". La
 * Cookie kinder se había apagado a las 13:02, cinco horas antes. La clienta
 * transfirió, el local escribió "tengo todo menos cookie kinder" y hubo que
 * devolver los $19.800.
 *
 * Esta guarda BLOQUEA el mensaje y escala, así que lo que más se mide acá es lo
 * que NO tiene que frenar: el bot habla de productos apagados todo el día con
 * razón —pasa la carta, pasa la lista de precios, dice "hoy no nos queda"— y
 * frenar eso sería una de cada cuatro respuestas.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-cobra-apagado.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { cobraLoQueNoHay } from '../src/core/policies/stock.js';
import { seEncargaConAnticipacion } from '../src/core/policies/rules.js';

const APAGADOS = [
  { id: 'cookie-kinder', name: 'Cookie kinder' },
  { id: 'cookie-pistacho', name: 'Cookie pistacho' },
  { id: 'chipa-x3', name: 'Chipa x3' },
  { id: 'mini-matilda', name: 'Mini torta Matilda' },
];

type Caso = { nombre: string; texto: string; frena: boolean };

const CASOS: Caso[] = [
  {
    nombre: 'EL CASO DE LA DEVOLUCIÓN: cobra una cookie apagada',
    texto:
      'Entonces queda:\n\n2 x Cookie kinder\n1 x Brownie pistacho\n1 x Alfajor block\n\nTotal: $19.800\n\nTe paso el alias: miskapedidos a nombre de Mathias Exequiel Lovey',
    frena: true,
  },
  {
    nombre: 'pide la transferencia con un apagado adentro',
    texto: 'Listo! Cookie kinder y un budín. Transferís al alias miskapedidos y me pasás la captura 🩷',
    frena: true,
  },
  // --- Lo que NO se toca ---
  {
    nombre: 'pasa la carta, sin pedir plata',
    texto:
      'Holaa! Acá están nuestras cookies:\n🍪 Cookie nutella — $5.000\n🍪 Cookie kinder — $5.000\n🍪 Cookie dubai — $5.000',
    frena: false,
  },
  {
    nombre: 'avisa que no hay, que es lo correcto',
    texto:
      'La cookie pistacho y el chipá no los tenemos disponibles hoy 🫣 Lo que sí tenemos es el budín de carrot. Te paso el alias cuando elijas!',
    frena: false,
  },
  {
    nombre: 'dice que se agotó y ofrece otra',
    texto: 'Uy, la Cookie kinder se nos agotó 🙈 Te puedo ofrecer la de dubai. Si te va, te paso el alias.',
    frena: false,
  },
  {
    nombre: 'la mini que va ADENTRO del desayuno',
    texto:
      'El Desayuno Miska Muska viene con Mini torta Matilda 🍰\n\nDesayuno Miska Muska: $40.000\n\nPara confirmarlo te paso el alias: miskapedidos',
    frena: false,
  },
  {
    nombre: 'cobra algo que sí hay',
    texto: 'Listo: 2 brownies y un alfajor, total $13.400. Te paso el alias: miskapedidos',
    frena: false,
  },
  {
    nombre: 'nombra un apagado pero está consultando, no cobrando',
    texto: 'Lo de la cookie kinder lo estoy consultando, en un rato te confirmo!',
    frena: false,
  },
];

let mal = 0;
console.log('\n  Casos\n');
for (const c of CASOS) {
  const r = cobraLoQueNoHay(c.texto, APAGADOS);
  const frena = r.length > 0;
  const ok = frena === c.frena;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${c.frena ? 'FRENA ' : 'sigue '} ${c.nombre}`);
  if (!ok) console.log(`      dio: ${r.map((x) => x.name).join(', ') || '(nada)'}`);
}

/*
  Y el corpus, que es lo que dice si esto se puede soltar en producción. El
  número que importa no es cuántos agarra sino cuántos FRENA por día: cada uno
  es una venta detenida y alguien del local que tiene que entrar.
*/
openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const productos = await q<{ id: string; name: string; category: string; available_today: boolean }>(
  'select id, name, category, available_today from products',
);
const apagados = productos
  .filter((p) => !p.available_today && !seEncargaConAnticipacion(p.category))
  .map((p) => ({ id: p.id, name: p.name }));

const msgs = await q<{ d: string; text: string; c: string }>(
  `select to_char(created_at at time zone $1,'DD/MM') d, text, conversation_id c
   from messages
   where direction='out' and author='bot' and text is not null
     and created_at > now() - interval '7 days'
   order by created_at asc`,
  [TIMEZONE],
);

const porDia = new Map<string, number>();
const ejemplos: string[] = [];
for (const m of msgs) {
  const r = cobraLoQueNoHay(m.text, apagados);
  if (!r.length) continue;
  porDia.set(m.d, (porDia.get(m.d) ?? 0) + 1);
  if (ejemplos.length < 6)
    ejemplos.push(`  ${m.d} [${r.map((x) => x.name).join(', ')}] ${m.text.replace(/\s+/g, ' ').slice(0, 100)}`);
}
const total = [...porDia.values()].reduce((a, b) => a + b, 0);

console.log(`\n  Corpus: ${msgs.length} mensajes del bot de 7 días. Frenaría:\n`);
for (const [d, n] of [...porDia].sort()) console.log(`    ${d}   ${n}`);
console.log(`\n  ${total} en 7 días · ${(total / 7).toFixed(1)} por día`);
console.log('\n  Una muestra:\n' + ejemplos.join('\n'));
console.log(
  '\n  OJO: los apagados son los de AHORA, no los de cuando salió cada mensaje.',
);
console.log('  El número real se va a poder medir bien cuando el historial de stock junte días.');
console.log(mal ? `\n  ${mal} casos fallaron.\n` : '\n  Los casos pasan todos.\n');

await closeDb();
process.exit(mal ? 1 : 0);
