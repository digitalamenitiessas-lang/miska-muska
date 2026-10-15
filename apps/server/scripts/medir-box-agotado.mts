/**
 * Mide la guarda `vendeUnBoxQueNoEsta` contra los mensajes reales.
 *
 * LO QUE HAY QUE MIRAR PRIMERO SON LOS FALSOS POSITIVOS. Hay trescientas
 * personas con el box pago que van a preguntar por el retiro, el horario, la
 * cadenita y si lo puede buscar la hermana. Todos esos mensajes nombran el box
 * y NINGUNO se puede tapar: taparlos es dejar sin respuesta a quien ya pagó, el
 * día antes de ir a buscarlo.
 *
 * Después, los verdaderos: los cuatro mensajes de la noche del 14 que
 * ofrecieron los box ya apagados, que son los que tiene que frenar.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/medir-box-agotado.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { vendeUnBoxQueNoEsta, type BoxApagado } from '../src/core/policies/diadelamadre.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

/*
  Los dos box, fijos. NO se leen del catálogo a propósito: una prueba que saca
  su entrada de la base cambia de resultado cuando el local toca un botón, y
  entonces deja de ser una prueba. Ya pasó con `probar-stock-box-madre.mts`.
*/
const APAGADOS: BoxApagado[] = [
  { id: 'box-madre-gracias-por-todo', name: 'Box gracias por todo' },
  { id: 'box-madre-te-amo-ma', name: 'Box te amo má' },
];

const mensajes = await q<{ id: string; text: string; cuando: string; cid: string }>(
  `SELECT id, text, conversation_id AS cid,
          to_char(created_at AT TIME ZONE $1,'DD/MM HH24:MI') AS cuando
     FROM messages
    WHERE direction = 'out' AND author = 'bot'
      AND created_at > now() - interval '20 days'
      AND text <> ''
    ORDER BY created_at`,
  [TIMEZONE],
);

const marcados = mensajes.filter((m) => vendeUnBoxQueNoEsta(m.text, APAGADOS).length > 0);

console.log(`\n  Mensajes del bot en 20 días : ${mensajes.length.toLocaleString('es-AR')}`);
console.log(`  Que la guarda frenaría      : ${marcados.length.toLocaleString('es-AR')}`);
console.log(
  `  Sobre los que hablan del box: ${
    mensajes.filter((m) => /d[ií]a de la madre|gracias por todo|te amo m[aá]/i.test(m.text)).length
  }\n`,
);

/*
  La pregunta que decide si esto se puede desplegar: de los que frena, ¿cuántos
  eran respuestas legítimas a gente que ya pagó?
*/
const DE_QUIEN_YA_PAGO =
  /retir|buscar|horario|s[aá]bado|cadenita|direcci[oó]n|marcos paz|pedido fue tomado|ya est[aá] anotado|lo puede (buscar|retirar)/i;

const sospechosos = marcados.filter((m) => DE_QUIEN_YA_PAGO.test(m.text));

console.log(`  DE ESOS, LOS QUE PARECEN SER DE QUIEN YA PAGÓ: ${sospechosos.length}`);
console.log('  (cada uno es alguien que se quedaría sin respuesta)\n');
for (const m of sospechosos.slice(0, 15)) {
  console.log(`    ${m.cuando}  ${m.cid}`);
  console.log(`      ${m.text.replace(/\n/g, ' ').slice(0, 150)}\n`);
}

console.log('\n  UNA MUESTRA DE LO QUE FRENA (los últimos 12):\n');
for (const m of marcados.slice(-12)) {
  console.log(`    ${m.cuando}  ${m.cid}`);
  console.log(`      ${m.text.replace(/\n/g, ' ').slice(0, 150)}\n`);
}

/*
  Y al revés: de los mensajes que hablan del box y la guarda DEJA pasar, una
  muestra, para ver que lo que deja pasar es lo que tiene que dejar pasar.
*/
const hablanDelBox = mensajes.filter((m) =>
  /d[ií]a de la madre|gracias por todo|te amo m[aá]/i.test(m.text),
);
const dejaPasar = hablanDelBox.filter((m) => !marcados.includes(m));
console.log(`\n  DEJA PASAR ${dejaPasar.length} mensajes que hablan del box. Los últimos 8:\n`);
for (const m of dejaPasar.slice(-8)) {
  console.log(`    ${m.cuando}  ${m.text.replace(/\n/g, ' ').slice(0, 130)}\n`);
}

await closeDb();
