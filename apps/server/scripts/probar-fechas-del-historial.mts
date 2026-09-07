/*
  El historial que ve el modelo tiene que decir de qué día es cada cosa.

  El caso: el 6 a la noche el bot le dijo a una clienta "el Box de Cookies
  Edición Limitada HOY no nos queda". El 7 el local lo prendió a las 11:46, ella
  volvió a preguntar a las 18:05 y el bot repitió "ese hoy no nos queda" —
  leyendo su propio mensaje del día anterior, que venía sin fecha. Una persona lo
  corrigió: "perdón, acaban de salir".
*/
import { toApiMessages } from '../src/core/agent/brain.js';

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Tucuman' });
const ayer = new Date(`${HOY}T12:00:00Z`);
ayer.setUTCDate(ayer.getUTCDate() - 1);
const AYER = ayer.toISOString().slice(0, 10);

const msg = (dia: string, hora: string, dir: 'in' | 'out', text: string, author = 'bot') =>
  ({
    id: `${dia}-${hora}`,
    conversationId: 'c',
    channel: 'whatsapp',
    direction: dir,
    author,
    contentKind: 'text',
    text,
    createdAt: `${dia}T${hora}:00.000Z`,
  }) as never;

let mal = 0;
const probar = (que: string, ok: boolean) => {
  if (!ok) mal++;
  console.log(`  ${ok ? 'ok  ' : 'MAL '} ${que}`);
};

console.log('=== el caso de lu, reconstruido ===\n');
const api = toApiMessages([
  msg(AYER, '22:42', 'in', 'tienen disponible tdv la box de cookies??'),
  msg(AYER, '22:42', 'out', 'Uy, el Box de Cookies Edición Limitada hoy no nos queda 🙈'),
  msg(HOY, '21:04', 'in', 'hola hoy q tienen disponible?'),
  msg(HOY, '21:05', 'out', 'Hoy tenemos de todo un poco!'),
  msg(HOY, '21:05', 'in', 'box de galletas no tienen?'),
]);
for (const m of api) console.log(`  ${m.role.padEnd(9)} ${String(m.content).replace(/\n/g, ' ⏎ ')}`);

const texto = api.map((m) => String(m.content)).join('\n');
console.log();
probar('el bloque de ayer viene marcado como ayer', texto.includes('[ayer]'));
probar('el de hoy viene marcado como hoy', texto.includes('[hoy]'));
probar(
  'el "hoy no nos queda" viejo queda del lado de ayer',
  /\[ayer\][\s\S]*hoy no nos queda/.test(texto) &&
    !/\[hoy\][\s\S]*hoy no nos queda/.test(texto),
);

console.log('\n=== una charla de un solo día lleva una sola marca ===\n');
const unDia = toApiMessages([
  msg(HOY, '14:00', 'in', 'hola'),
  msg(HOY, '14:01', 'out', 'Hola!'),
  msg(HOY, '14:02', 'in', 'que cookies hay?'),
]);
probar('una sola marca', (unDia.map((m) => String(m.content)).join('\n').match(/\[hoy\]/g) ?? []).length === 1);
probar('no aparece [ayer]', !unDia.map((m) => String(m.content)).join('\n').includes('[ayer]'));

console.log('\n=== una charla vieja dice la fecha ===\n');
const viejo = toApiMessages([
  msg('2026-08-30', '14:00', 'in', 'hola'),
  msg(HOY, '14:01', 'in', 'sigo acá'),
]);
const t2 = viejo.map((m) => String(m.content)).join('\n');
console.log(`  ${t2.replace(/\n/g, ' ⏎ ')}`);
probar('la fecha vieja va escrita', /\[el 30\/8\/2026\]/.test(t2));

console.log('\n=== el operador sigue marcado ===\n');
const op = toApiMessages([
  msg(HOY, '14:00', 'in', 'hola'),
  msg(HOY, '14:01', 'out', 'listo, ya podés retirar', 'human'),
  msg(HOY, '14:02', 'in', 'gracias'),
]);
probar(
  'el prefijo del operador convive con la marca de día',
  op.some((m) => String(m.content).includes('[operador del local]')),
);

console.log(`\n  ${mal === 0 ? 'todo bien' : mal + ' MAL'}`);
process.exit(mal ? 1 : 0);
