/**
 * Corrige el encabezado de stock que quedó demasiado ancho.
 *
 * Ayer, después de que el bot vendiera un Box de Cookies Edición Limitada
 * agotado, se le puso arriba de la ficha: "si un producto figura en HOY NO HAY,
 * no se ofrece". Eso arregla las cookies y ROMPE los desayunos.
 *
 * El local lo definió así, y tiene razón: "que estén apagados en el panel no
 * significa que el bot tenga que dejar de ofrecerlos. Lo que cambia es si puede
 * confirmar el pedido inmediatamente o necesita validación humana. El stock
 * sirve para saber qué se puede entregar en el momento, pero no para decidir
 * qué desayunos/box mostrar u ofrecer para encargos futuros".
 *
 * O sea: el stock decide QUÉ SE ENTREGA HOY, no QUÉ SE OFRECE. La diferencia
 * está entre una cookie —que no se produce por encargo, y si hoy no hay no hay—
 * y un desayuno, que se arma para la fecha que le pidan.
 *
 * Corre en seco por defecto; con --aplicar escribe.
 */
import { openDb, q, closeDb } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const aplicar = process.argv.includes('--aplicar');
const filas = await q<{ v: Record<string, unknown> }>(`select value as v from settings limit 1`, []);
const original = String((filas[0]?.v ?? {}).conocimiento ?? '');
if (!original) throw new Error('La ficha vino vacía: no toco nada.');

const VIEJO = `EL STOCK DEL DÍA MANDA SOBRE TODO LO QUE DICE ESTA FICHA.
Si un producto figura en HOY NO HAY, no se ofrece como disponible, no se cotiza como algo
que se puede comprar hoy y no se carga en un pedido de hoy — por más que más abajo diga
"ofrecelo siempre" o "tenemos disponible". Esas frases describen qué vendemos, no qué hay
hoy. Se dice que hoy no queda, se cuenta qué trae, y se ofrece lo que sí hay.
`;

const NUEVO = `EL STOCK DEL DÍA DICE QUÉ SE ENTREGA HOY, NO QUÉ SE OFRECE.
Es la distinción más importante de esta ficha y hay que tenerla clara en los dos sentidos.

LO QUE NO SE PRODUCE POR ENCARGO (cookies, brownies, alfajores, sorrentinos, cafetería):
si figura en HOY NO HAY, no se ofrece como disponible, no se cotiza como algo que se pueda
comprar hoy y no se cobra — por más que más abajo diga "ofrecelo siempre". Se dice que hoy
no queda, se cuenta qué trae, y se ofrece lo que sí hay. Ya se cobró un box de cookies que
no existía y hubo que devolver la plata.

LO QUE SÍ SE PRODUCE PARA UNA FECHA (tortas, box y desayunos): se ofrece SIEMPRE, esté
apagado o no. Que hoy no haya no dice nada sobre el sábado: se arma para esa fecha. Los
cuatro —Box Popurrí, Box Requete Feliz, Desayuno Miska Muska y Desayuno Buen Día— se
muestran siempre que pregunten por opciones o por algo para regalar.
Lo único que cambia con el stock apagado es CUÁNDO se puede confirmar:
  · para una fecha futura (mañana o más adelante), se toma normal;
  · para HOY o "para ya", NO se confirma: lo mira una persona del local;
  · y de noche, de las 20 en adelante, un desayuno para el día siguiente tampoco se
    confirma solo: lo confirma alguien a la mañana.
`;

let texto = original;
if (texto.startsWith(VIEJO)) {
  texto = NUEVO + texto.slice(VIEJO.length);
  console.log('  ok  encabezado reemplazado');
} else if (texto.startsWith(NUEVO)) {
  console.log('  (ya estaba el nuevo, no hago nada)');
} else {
  throw new Error('El encabezado no es el que esperaba. No toco la ficha.');
}

console.log(`\n  antes ${original.length} car → después ${texto.length} car`);

if (!aplicar) {
  console.log('\n  (en seco: no se escribió nada. Corré con --aplicar)');
} else if (texto !== original) {
  await q(`update settings set value = jsonb_set(value, '{conocimiento}', $1::jsonb)`, [
    JSON.stringify(texto),
  ]);
  const dsp = await q<{ v: Record<string, unknown> }>(`select value as v from settings limit 1`, []);
  const ok = String((dsp[0]?.v ?? {}).conocimiento ?? '') === texto;
  console.log(ok ? '\n  APLICADO y verificado.' : '\n  ALGO SALIÓ MAL al guardar.');
}
await closeDb();
