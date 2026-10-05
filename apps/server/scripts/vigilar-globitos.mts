/*
  Mira el chat en vivo y corta apenas aparece algo raro. No reporta volumen:
  reporta problemas, y si no hay ninguno se queda callado hasta el final.

  Lo que busca, y por qué cada cosa:

  1. UN MENSAJE MUY LARGO. El empalme de globitos junta hasta 1.500 caracteres.
     Si aparecen de más de 1.200 seguido, el párrafo único dejó de leerse en un
     celular y hay que bajar el techo.
  2. GLOBITOS QUE SIGUEN SALIENDO SUELTOS. Después del cambio tendrían que ser
     casi cero; si vuelven, el empalme no se está aplicando en algún camino.
  3. UN BOX DEL DÍA DE LA MADRE CON ENVÍO. Es el bug del 5 de octubre: se
     ofrecieron para ese mismo día a domicilio. La categoría nueva lo tendría
     que haber cerrado, pero hasta no verlo con tráfico real no está probado.
  4. UN BOX OFRECIDO PARA HOY. La otra mitad del mismo bug.
  5. LA GUARDA DE STOCK PISANDO UNA CHARLA DE BOX. Es el falso positivo del
     2 de octubre, que le borró el precio a tres clientas.

  npx tsx --env-file=... scripts/vigilar-globitos.mts "2026-10-05 11:19:00+00"
*/
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const DESDE = process.argv[2] ?? '2026-10-05 11:19:00+00';
const HASTA = Date.now() + 8 * 60 * 60 * 1000;
const CADA_MS = 10 * 60 * 1000;
const LARGO_SOSPECHOSO = 1200;

interface Hallazgo {
  que: string;
  h: string;
  conv: string;
  texto: string;
}

async function buscar(desde: string): Promise<Hallazgo[]> {
  const out: Hallazgo[] = [];
  const linea = (r: any, que: string) => ({
    que,
    h: r.h,
    conv: r.conversation_id,
    texto: String(r.text ?? '').replace(/\s+/g, ' ').slice(0, 300),
  });

  const largos = await q<any>(
    `SELECT to_char(created_at AT TIME ZONE $2,'HH24:MI') h, conversation_id, text
       FROM messages WHERE direction='out' AND author='bot' AND content_kind='text'
        AND created_at > $1::timestamptz AND length(text) > ${LARGO_SOSPECHOSO}
      ORDER BY created_at`,
    [desde, TIMEZONE],
  );
  for (const r of largos) out.push(linea(r, `MENSAJE LARGO (${r.text.length} car.)`));

  /*
    NO SE BUSCAN GLOBITOS SUELTOS, aunque fue lo primero que puse. No se puede:
    el empalme pasa ANTES de guardar, así que en la base ya no existe un turno
    con dos globitos. Dos mensajes del bot seguidos son siempre dos turnos
    distintos, y eso es otra cosa.

    Lo vi en vivo: a las 09:03 una clienta mandó "Hola buenos días!" y veinte
    segundos después "tendrían un box desayuno para ahora". El bot contestó el
    primero y después el segundo. Dos mensajes, dos turnos, el empalme bien.
    Buscarlo acá solo producía alarmas que no significan nada.

    Que el bot conteste dos veces seguidas sí cuesta un mensaje de más ahora que
    Meta cobra, pero es un tema aparte y no se arregla juntando globitos.
  */

  /*
    El box con envío. Se pide que nombre el box Y que hable de llevarlo, y se
    descartan los que están diciendo justamente que NO se envía, que es la
    respuesta correcta y la más común.
  */
  const envios = await q<any>(
    `SELECT to_char(created_at AT TIME ZONE $2,'HH24:MI') h, conversation_id, text
       FROM messages WHERE direction='out' AND author='bot' AND content_kind='text'
        AND created_at > $1::timestamptz
        AND (text ILIKE '%gracias por todo%' OR text ILIKE '%te amo m%' OR text ILIKE '%día de la madre%')
        AND (text ILIKE '%a domicilio%' OR text ILIKE '%cadete%' OR text ILIKE '%lo llevamos%'
             OR text ILIKE '%dirección de%' OR text ILIKE '%franja horaria%')
        AND text NOT ILIKE '%no hacemos envío%' AND text NOT ILIKE '%no se envía%'
        AND text NOT ILIKE '%no enviamos%' AND text NOT ILIKE '%no mandamos%'
        AND text NOT ILIKE '%evitamos envío%' AND text NOT ILIKE '%recomendamos no enviar%'`,
    [desde, TIMEZONE],
  );
  for (const r of envios) out.push(linea(r, 'BOX DE LA MADRE CON ENVÍO'));

  const paraHoy = await q<any>(
    `SELECT to_char(created_at AT TIME ZONE $2,'HH24:MI') h, conversation_id, text
       FROM messages WHERE direction='out' AND author='bot' AND content_kind='text'
        AND created_at > $1::timestamptz
        AND (text ILIKE '%gracias por todo%' OR text ILIKE '%te amo m%')
        AND (text ILIKE '%para hoy%' OR text ILIKE '%hoy mismo%' OR text ILIKE '%hoy tenemos disponible%')`,
    [desde, TIMEZONE],
  );
  for (const r of paraHoy) out.push(linea(r, 'BOX DE LA MADRE OFRECIDO PARA HOY'));

  const stock = await q<any>(
    `SELECT to_char(updated_at AT TIME ZONE $2,'HH24:MI') h, id AS conversation_id,
            attention_reason AS text
       FROM conversations
      WHERE updated_at > $1::timestamptz AND attention_reason ILIKE '%[stock]%'
        AND id IN (SELECT conversation_id FROM messages
                    WHERE text ILIKE '%día de la madre%' OR text ILIKE '%gracias por todo%')`,
    [desde, TIMEZONE],
  );
  for (const r of stock) out.push(linea(r, 'GUARDA DE STOCK EN CHARLA DE BOX'));

  return out;
}

const yaVisto = new Set<string>();
let corte = DESDE;

while (Date.now() < HASTA) {
  const hallazgos = (await buscar(corte)).filter((x) => {
    const k = `${x.que}|${x.conv}|${x.h}`;
    if (yaVisto.has(k)) return false;
    yaVisto.add(k);
    return true;
  });

  if (hallazgos.length) {
    console.log(`\n  ⚠ ${hallazgos.length} cosa(s) para mirar:\n`);
    for (const x of hallazgos) {
      console.log(`  ── ${x.que}`);
      console.log(`     ${x.h} · ${x.conv}`);
      console.log(`     ${x.texto}\n`);
    }
    await closeDb();
    process.exit(0);
  }

  await new Promise((r) => setTimeout(r, CADA_MS));
}

const total = await q<any>(
  `SELECT count(*) n FROM messages WHERE direction='out' AND author='bot'
    AND content_kind='text' AND created_at > $1::timestamptz`,
  [DESDE],
);
console.log(`\n  Sin novedades. ${total[0].n} mensajes del bot revisados, nada raro.\n`);
await closeDb();
