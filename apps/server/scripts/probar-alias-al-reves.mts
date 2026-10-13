/**
 * El bot pidiendo el alias en vez de darlo.
 *
 * El 13 de octubre: "Dale, entonces pasame el alias para que transfieras!".
 * Eso lo dice la clienta. Y el daño no es sonar raro: el bot NUNCA le pasó el
 * alias. Esa venta se cerró porque ella lo tenía de un mensaje anterior.
 *
 * Esta guarda reescribe un mensaje y encima le AGREGA un dato, así que lo que
 * hay que medir no es que agarre los seis casos reales sino que no toque
 * ninguno de los 1.960 mensajes del bot que nombran el alias y están bien.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-alias-al-reves.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';
import { corregirElAliasAlReves } from '../src/core/policies/alias.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const s = await createRepositories().settings.read();
const CUENTAS = {
  aliasPedidos: s.transferAlias,
  titularPedidos: s.transferHolder,
  aliasCursos: s.transferAliasCursos,
  titularCursos: s.transferHolderCursos,
};

let mal = 0;
const chequear = (ok: boolean, nota: string): void => {
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${nota}`);
};

console.log('\n  El caso del 13 de octubre\n');

const ELCASO =
  'Se retira el sábado 17, sí! Pero el horario exacto de retiro te lo paso cuando llegue ' +
  'el comprobante de la transferencia ✨\n\nDale, entonces pasame el alias para que transfieras!';
const r = corregirElAliasAlReves(ELCASO, CUENTAS);
chequear(r.corregido, 'lo agarra');
chequear(r.texto.includes('te paso el alias'), 'lo da vuelta: "te paso el alias"');
chequear(!/pasame el alias/i.test(r.texto), 'y saca el "pasame"');
chequear(r.texto.includes(CUENTAS.aliasPedidos), 'ahora el alias SÍ está en el mensaje');
chequear(r.texto.includes(CUENTAS.titularPedidos), 'con el titular');
chequear(r.texto.includes('sábado 17'), 'y no se come el resto del mensaje');

console.log('\n  Lo que NO tiene que tocar\n');

chequear(
  !corregirElAliasAlReves(
    `Te paso el alias: ${CUENTAS.aliasPedidos} a nombre de ${CUENTAS.titularPedidos}`,
    CUENTAS,
  ).corregido,
  'cuando ya lo da bien',
);
chequear(
  !corregirElAliasAlReves('Una vez que me lo pasas, te doy el alias para transferir.', CUENTAS)
    .corregido,
  '"me lo pasas... te doy el alias": el que pasa el celular es ella',
);
chequear(
  !corregirElAliasAlReves(
    `me pasás por transferencia al alias ${CUENTAS.aliasPedidos} y listo`,
    CUENTAS,
  ).corregido,
  'cuando el mensaje ya trae el alias escrito',
);
chequear(
  !corregirElAliasAlReves('Pasame tu nombre y apellido porfa', CUENTAS).corregido,
  'pedir otros datos no se toca',
);
/*
  La devolución: cuando hay que devolverle plata, el local le pide SU alias.
  Si esta guarda lo diera vuelta, le estaría mandando el nuestro justo cuando
  la que tiene que cobrar es ella.
*/
chequear(
  !corregirElAliasAlReves('Buen día! Pasanos tu alias así te devolvemos la diferencia', CUENTAS)
    .corregido,
  'pedir SU alias para devolverle plata no se toca',
);

console.log('\n  Una charla de curso usa la otra cuenta\n');
const curso = corregirElAliasAlReves(
  'Dale! Para el curso de macarons pasame el alias y listo',
  CUENTAS,
);
chequear(curso.corregido, 'también lo agarra');
chequear(curso.texto.includes(CUENTAS.aliasCursos), 'y agrega el alias de CURSOS, no el de pedidos');

/* El corpus: todo lo que el bot dijo con la palabra alias en 30 días. */
const msgs = await q<{ t: string; text: string; c: string }>(
  `SELECT to_char(created_at AT TIME ZONE $1,'DD/MM HH24:MI') t, text, conversation_id c
     FROM messages
    WHERE direction='out' AND author='bot' AND text ILIKE '%alias%'
      AND created_at > now() - interval '30 days'
    ORDER BY created_at ASC`,
  [TIMEZONE],
);

let toca = 0;
console.log(`\n\n  Corpus: ${msgs.length} mensajes del bot con la palabra alias.\n`);
for (const m of msgs) {
  const res = corregirElAliasAlReves(m.text, CUENTAS);
  if (!res.corregido) continue;
  toca++;
  console.log(`  ── ${m.t}  [${m.c}]`);
  console.log(`     ${m.text.replace(/\s+/g, ' ').slice(0, 190)}\n`);
}
console.log(`  Corregiría ${toca} de ${msgs.length}. Cada uno tiene que ser un "pasame el alias".\n`);

console.log(mal ? `  ${mal} casos armados fallaron.\n` : '  Los casos armados pasan todos.\n');
await closeDb();
process.exit(mal ? 1 : 0);
