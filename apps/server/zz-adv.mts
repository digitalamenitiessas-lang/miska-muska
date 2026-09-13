import { openDb, q, closeDb } from './src/core/store/db.js';

const CON_QUIEN_SE_CONSULTA: Array<[string, RegExp, string]> = [
  ['C1', /\s+con\s+(?:el\s+local|la\s+encargada|cocina)\b(?!\s+y\s+con\b)/gi, ''],
  ['C2', /\s+a\s+la\s+encargada\b/gi, ''],
  ['C3', /\s+(?:a|con)\s+(?:alguien|una\s+persona)\s+del\s+local\b/gi, ''],
  ['C4', /\s+al\s+equipo\s+del\s+local\b/gi, ''],
  [
    'C5',
    /(?<!\bte\s(?:lo|la|los|las)\s)\b((?:cheque|confirm|consult|revis|averigu)\w*(?:\s+[^\s.,;:!?¡¿]+){0,3}?)\s+en\s+el\s+local\b/gi,
    '$1',
  ],
  ['C6', /\ben\s+el\s+local\s+(?=(?:cheque|confirm|consult|revis|averigu)\w*\b)/gi, ''],
  [
    'C7',
    /\b((?:cheque|confirm|consult|revis|averigu)\w*(?:\s+[^\s.,;:!?¡¿]+){0,3}?)\s+(?:en|de|desde|a)\s+cocina\b/gi,
    '$1',
  ],
  ['C8', /\s+(?:de|desde)\s+cocina\b/gi, ''],
];

function aplicar(t: string): { out: string; pats: string[] } {
  let out = t;
  const pats: string[] = [];
  for (const [n, re, to] of CON_QUIEN_SE_CONSULTA) {
    re.lastIndex = 0;
    const limpio = out.replace(re, to);
    if (limpio !== out) {
      pats.push(n);
      out = limpio;
    }
  }
  return { out, pats };
}

function probar(etiqueta: string, casos: Array<[string, boolean]>) {
  console.log(`\n======== ${etiqueta} ========`);
  for (const [texto, deberiaTocarse] of casos) {
    const { out, pats } = aplicar(texto);
    const toco = out !== texto;
    const ok = toco === deberiaTocarse;
    console.log(`${ok ? '  ok  ' : ' >>FP '} ${toco ? '[' + pats.join(',') + ']' : '[    ]'} ${texto}`);
    if (toco) console.log(`        -> ${out}`);
  }
}

// ---- 1) Las promesas de seguridad que hace la propuesta, textuales ----
probar('LAS QUE LA PROPUESTA DICE QUE RESPETA (esperado: NO tocar)', [
  ['El jugo de naranja con mango y maracuyá lo tenemos, pero el precio te lo confirman en el local cuando vayas a pedirlo 🙈', false],
  ['Dale, sin problema. Cuando esté en camino avisame y coordinamos la entrega en el local 🙌🏼', false],
  ['Si preferís, también podés retirarlo en el local o mandar un Uber a buscarlo.', false],
  ['Con tarjeta sí se puede, pero en el local, que tiene 10% de recargo.', false],
  ['Cafetería no enviamos 🙏🏻 pero te esperamos en el local para tomar algo rico, estamos en Marcos Paz 473', false],
  ['El total son $46.000. Antes de las 12 lo tengo que chequear con cocina y con el cadete', false],
  ['Perfecto! Ya chequeo en la agenda si tenemos disponibilidad y te respondo a la brevedad 🙌🏼', false],
  ['te la puedo dejar encargada para retirar en el local', false],
  ['es día a día así que no se puede dejar encargada', false],
  ['En un rato te contacta alguien del local para ver la cotización 💕', false],
]);

// ---- 2) VARIANTES DE UNA PALABRA de esas mismas frases ----
probar('MISMA REGLA, OTRA FORMA DE DECIRLA (esperado: NO tocar)', [
  // la regla de cafetería, sin el "te lo" que la salva
  ['El precio lo confirmás en el local cuando vayas a pedirlo 🙈', false],
  ['El precio te lo van a confirmar en el local cuando vayas.', false],
  ['Ese precio lo confirman en el local, porque cambia seguido.', false],
  ['La cafetería no tiene precio fijo: se confirma en el local.', false],
  ['Los precios de cafetería los consultás en el local 🙏🏻', false],
  ['El precio exacto te lo confirma la chica en el local.', false],
  // pago con tarjeta / efectivo: la plata se confirma EN EL LOCAL
  ['El pago lo confirmás en el local con tarjeta, tiene 10% de recargo.', false],
  ['Con tarjeta sí, pero lo abonás y confirmás en el local.', false],
  ['La seña la podés dejar confirmada en el local si preferís.', false],
  // retiro / entrega
  ['Cuando lo retires confirmá en el local que está todo 🙌🏼', false],
  ['Dale! Confirmás y te esperamos en el local 💕', false],
  ['Avisame cuando salgas y lo coordinamos y confirmamos en el local.', false],
  ['Cualquier cosa lo revisás en el local antes de llevártelo.', false],
  // la encargada como persona a la que va el CLIENTE
  ['Cuando llegues avisale a la encargada que venís de parte nuestra 🙌🏼', false],
  ['Pedile a la encargada que te lo muestre antes de llevarlo.', false],
  ['El reclamo se lo hacés a la encargada directamente en el mostrador.', false],
  // "con el local" como indicación al cliente
  ['Si querés lo arreglás directamente con el local cuando pases 🙏🏻', false],
  ['Eso lo podés hablar con el local el día que retires.', false],
  // "de cocina" fuera de la consulta
  ['Tenemos el Taller de cocina dulce, sale $35.000 🙌🏼', false],
  ['Las cookies salen recién horneadas de cocina, todavía tibias 🍪', false],
  ['El taller es hands-on: entrás de cocina y te llevás lo que armaste.', false],
  ['Es una isla de cocina de madera, la usamos para el taller.', false],
  ['Ese es el jefe de cocina, él arma las tortas personalizadas.', false],
  ['Usamos papel de cocina para envolverlas, no plástico.', false],
  ['El equipo de cocina trabaja desde las 5 de la mañana 🥐', false],
  ['Te sale directo de cocina, recién hecho.', false],
]);

// ---- 3) idempotencia sobre los aciertos ----
console.log('\n\n======== IDEMPOTENCIA + ESPACIOS/PUNTUACION sobre los 299 reales ========');
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const bot = await q<any>(
  `select id, text from messages
    where direction='out' and author='bot' and text is not null and text <> ''
      and created_at >= now() - interval '14 days'`,
);
let tocados = 0;
let noIdem = 0;
const raros: string[] = [];
for (const m of bot) {
  const { out } = aplicar(m.text);
  if (out === m.text) continue;
  tocados++;
  const { out: out2 } = aplicar(out);
  if (out2 !== out) {
    noIdem++;
    console.log('  NO IDEMPOTENTE:', JSON.stringify(out.slice(0, 160)));
  }
  if (/ {2}/.test(out) && !/ {2}/.test(m.text)) raros.push('ESPACIO DOBLE: ' + out.slice(0, 160));
  if (/\b(con|a|de|en|para|por)\s*[.,;!?]/i.test(out) && !/\b(con|a|de|en|para|por)\s*[.,;!?]/i.test(m.text))
    raros.push('PREPOSICION COLGADA: ' + out.slice(0, 200));
}
console.log(`  tocados=${tocados}  no-idempotentes=${noIdem}  rarezas=${raros.length}`);
for (const r of raros.slice(0, 20)) console.log('   ! ' + r);

// ---- 4) distribución REAL de "cocina" y "en el local" en TODO el corpus ----
console.log('\n\n======== TODOS LOS USOS DE "cocina" EN EL CORPUS (bot + humano + cliente) ========');
const todo = await q<any>(
  `select direction, author, text from messages
    where text ilike '%cocina%' and created_at >= now() - interval '60 days'`,
);
console.log('mensajes con "cocina" en 60d:', todo.length);
const senses: Record<string, number> = {};
for (const m of todo) {
  for (const mm of String(m.text).matchAll(/(\S+\s+\S+\s+)?(\S*cocina\w*)/gi)) {
    const ctx = (mm[0] || '').toLowerCase().trim();
    senses[ctx] = (senses[ctx] || 0) + 1;
  }
}
const ord = Object.entries(senses).sort((a, b) => b[1] - a[1]);
for (const [k, v] of ord.slice(0, 60)) console.log(`   ${String(v).padStart(3)}  …${k}`);

await closeDb();
