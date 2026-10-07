/**
 * La guarda del alias, contra los mensajes de verdad.
 *
 * Es la segunda guarda del sistema que REESCRIBE un texto en vez de avisar
 * —la otra es la de los totales— y por eso lo que importa medir no es que
 * agarre el error, sino que no toque ni uno de los mensajes que están bien.
 * Un alias cambiado de más manda la plata de una inscripción a la cuenta
 * equivocada, que es exactamente el daño que viene a evitar.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-alias.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';
import { corregirElAlias } from '../src/core/policies/alias.js';

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
console.log(`\n  pedidos: ${CUENTAS.aliasPedidos} (${CUENTAS.titularPedidos})`);
console.log(`  cursos : ${CUENTAS.aliasCursos} (${CUENTAS.titularCursos})\n`);

let mal = 0;
const chequear = (ok: boolean, nota: string): void => {
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${nota}`);
};

console.log('  El caso real del 7 de octubre\n');

const ELCASO = `Para el Box "te amo má" de $35.000 🫶🏼

Transfieren al alias ${CUENTAS.aliasCursos} a nombre de ${CUENTAS.titularCursos}, y cuando hagas la transferencia nos mandás la captura junto con estos cinco datos:

Nombre, apellido, DNI, celular y confirmar que es el Box "te amo má".`;

const r = corregirElAlias(ELCASO, CUENTAS, 'Hola! Te consulto para el desayuno del día de la madre');
chequear(r.corregido !== null, 'lo agarra');
chequear(r.texto.includes(CUENTAS.aliasPedidos), 'pone el alias de pedidos');
chequear(!r.texto.includes(CUENTAS.aliasCursos), 'y saca el de cursos');
chequear(r.texto.includes(CUENTAS.titularPedidos), 'cambia también el titular');
chequear(!r.texto.includes(CUENTAS.titularCursos), 'y saca el de la otra cuenta');
chequear(r.texto.includes('te amo má') && r.texto.includes('35.000'), 'no toca nada más del mensaje');

console.log('\n  Lo que NO tiene que tocar\n');

const inscripcion = `Genial! El curso de macarons sale $45.000. Transferís al alias ${CUENTAS.aliasCursos} a nombre de ${CUENTAS.titularCursos} y me mandás la captura.`;
chequear(
  corregirElAlias(inscripcion, CUENTAS, '').corregido === null,
  'una inscripción con el alias de cursos queda intacta',
);

const porContexto = `Dale! Transferís al alias ${CUENTAS.aliasCursos} a nombre de ${CUENTAS.titularCursos}.`;
chequear(
  corregirElAlias(porContexto, CUENTAS, 'quiero anotarme al taller del sábado').corregido === null,
  'y si el curso se nombró antes en la charla, tampoco se toca',
);

const normal = `Te paso el alias: ${CUENTAS.aliasPedidos} a nombre de ${CUENTAS.titularPedidos}`;
chequear(corregirElAlias(normal, CUENTAS, '').corregido === null, 'un pedido normal no se toca');
chequear(corregirElAlias('Hola! Qué necesitás?', CUENTAS, '').corregido === null, 'un mensaje sin alias tampoco');

/*
  EL CORPUS. Todo lo que el bot mandó con el alias de cursos: cada corrección
  es plata que cambia de cuenta, así que van impresas una por una.
*/
const msgs = await q<{ t: string; text: string; c: string }>(
  `SELECT to_char(created_at AT TIME ZONE $1,'DD/MM HH24:MI') t, text, conversation_id c
     FROM messages
    WHERE direction='out' AND author='bot' AND text ILIKE '%' || $2 || '%'
      AND created_at > now() - interval '60 days'
    ORDER BY created_at ASC`,
  [TIMEZONE, CUENTAS.aliasCursos],
);

let tocaria = 0;
console.log(`\n\n  Corpus: ${msgs.length} mensajes del bot con el alias de cursos, 60 días.\n`);
for (const m of msgs) {
  const previos = await q<{ text: string }>(
    `SELECT coalesce(text,'') text FROM messages
      WHERE conversation_id = $1 AND created_at < now() ORDER BY created_at DESC LIMIT 8`,
    [m.c],
  );
  const ctx = previos.map((p) => p.text).join(' ');
  const res = corregirElAlias(m.text, CUENTAS, ctx);
  if (!res.corregido) continue;
  tocaria++;
  console.log(`  ── ${m.t}  [${m.c}]`);
  console.log(`     ${m.text.replace(/\s+/g, ' ').slice(0, 220)}\n`);
}
console.log(`  Corregiría ${tocaria} de ${msgs.length}.`);
console.log('  Cada uno tiene que ser una venta de pastelería, no una inscripción.\n');

console.log(mal ? `  ${mal} casos armados fallaron.\n` : '  Los casos armados pasan todos.\n');
await closeDb();
process.exit(mal ? 1 : 0);
