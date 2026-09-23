/**
 * La guarda del Box de Edición Limitada, contra los mensajes que ya salieron.
 *
 * Lo que hay que medir NO es que agarre el caso de Agus —eso es una línea—.
 * Es que no marque ninguno de los cientos de mensajes en los que el bot nombra
 * el box CORRECTAMENTE al lado de otras cookies, que es lo que hace todo el
 * día. Esta guarda escala la charla a una persona: un falso positivo saca al
 * bot de una conversación que estaba bien.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-descripciones.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import {
  atribuyeAlBoxLoQueNoTiene,
  TEXTO_LO_CHEQUEO,
} from '../src/core/policies/descripciones.js';

let mal = 0;
const chequear = (ok: boolean, nota: string): void => {
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${nota}`);
};

console.log('\n  Lo que hay que agarrar\n');

chequear(
  atribuyeAlBoxLoQueNoTiene(
    'Pero tenemos la cookie nutella y oreo en el Box Edición Limitada (la del Volcán de ' +
      'Chocolate que es tipo brownie con oreo), o si preferís algo con oreo tenemos el Brownie Oreo.',
  ),
  'el caso real del 23/09',
);
chequear(
  atribuyeAlBoxLoQueNoTiene('El Box Edición Limitada trae franui, banana split y una cookie kinder.'),
  'atribuírsela con "trae"',
);
chequear(
  atribuyeAlBoxLoQueNoTiene('El box de cookies edición limitada viene con una cookie de nutella.'),
  'con "viene con"',
);
chequear(
  atribuyeAlBoxLoQueNoTiene('La cookie dubai del box edición limitada es espectacular.'),
  'con "del box"',
);

console.log('\n  Lo que NO hay que tocar\n');

chequear(
  !atribuyeAlBoxLoQueNoTiene(
    'Hoy sí tenemos cookie de pistacho y cookie dubai, y también el Box de cookies edición ' +
      'limitada, que trae franui, banana split, crème brûlée y volcán de chocolate.',
  ),
  'nombrar sueltas y el box en la misma oración',
);
chequear(
  !atribuyeAlBoxLoQueNoTiene(
    'De la cookie kinder hoy no nos queda 🙈 pero tenés la dubai, o si querés algo distinto ' +
      'está el Box Edición Limitada con esos 4 sabores nuevos.',
  ),
  'ofrecer el box como alternativa',
);
chequear(
  !atribuyeAlBoxLoQueNoTiene(
    'Entonces te queda: 1 cookie kinder, 1 cookie pistacho y el Box de Cookies Edición ' +
      'Limitada (que trae la franui, la volcán de chocolate, banana split y crème brûlée).',
  ),
  'un pedido que mezcla sueltas y el box',
);
chequear(
  !atribuyeAlBoxLoQueNoTiene(
    'El box de cookies edición limitada hoy no lo tenemos 🙈 pero manejamos varios sabores ' +
      'sueltos: red velvet, kinder, dubai, ferrero y nutella y oreo.',
  ),
  'decir que no hay box y listar las sueltas',
);
chequear(
  !atribuyeAlBoxLoQueNoTiene(
    'El Box de Cookies Edición Limitada sale $22.000 🍪 Viene con 4 sabores: Franui, ' +
      'Banana Split, Crème Brûlée y Volcán de Chocolate.',
  ),
  'la descripción correcta, que es la que sale todo el día',
);

/* --------------------------------------------------------------------- */

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const DIAS = 30;
const filas = await q<{ t: string; c: string; text: string }>(
  `select to_char(created_at at time zone $1,'DD/MM HH24:MI') t, conversation_id c, text
     from messages
    where direction='out' and author='bot' and text is not null
      and created_at > now() - interval '${DIAS} days'
      and text ~* 'edicion limitada|edición limitada'
    order by created_at desc`,
  [TIMEZONE],
);

const marcados = filas.filter((f) => atribuyeAlBoxLoQueNoTiene(f.text));

console.log(`\n  Corpus: ${filas.length} mensajes del bot nombran el box en ${DIAS} días\n`);
console.log(`  la guarda marca ${marcados.length}:`);
for (const m of marcados) {
  console.log(`    ${m.t}  ${m.text.replace(/\s+/g, ' ').slice(0, 170)}`);
}
if (!marcados.length) console.log('    (ninguno)');

/*
  El freno. Esta guarda ESCALA, así que cada marca de más saca al bot de una
  charla sana. Con un mensaje por mes el número tolerable es muy chico: si
  marcara más del 1% de lo que nombra el box, hay que volver a las expresiones
  antes de dejarla escalando.
*/
const proporcion = marcados.length / Math.max(filas.length, 1);
if (proporcion > 0.01) {
  mal++;
  console.log(
    `\n  ✗ marca el ${(proporcion * 100).toFixed(2)}% de los mensajes que nombran el box: ` +
      'es demasiado para una guarda que escala.',
  );
} else {
  console.log(`\n  ✓ marca el ${(proporcion * 100).toFixed(2)}% de los que nombran el box.`);
}

/*
  Y lo que sale en su lugar. La guarda REEMPLAZA el mensaje, así que el texto de
  reemplazo tiene que poder leerse solo, sin el contexto que tapó, y no puede
  volver a dispararla.
*/
console.log('\n  Lo que la clienta lee en su lugar:\n');
console.log(`    ${TEXTO_LO_CHEQUEO}\n`);
chequear(!atribuyeAlBoxLoQueNoTiene(TEXTO_LO_CHEQUEO), 'el reemplazo no se marca a sí mismo');
chequear(TEXTO_LO_CHEQUEO.length < 120, 'el reemplazo entra en una burbuja');

console.log(mal ? `\n  ${mal} fallaron.\n` : '\n  Pasa todo.\n');
await closeDb();
process.exit(mal ? 1 : 0);
