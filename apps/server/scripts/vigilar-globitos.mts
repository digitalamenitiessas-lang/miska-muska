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
const UNA_VEZ = process.argv.includes("--una-vez");
const HASTA = UNA_VEZ ? 0 : Date.now() + 8 * 60 * 60 * 1000;
const CADA_MS = 10 * 60 * 1000;

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

  /*
    EL LARGO SE MIRA COMO PROPORCIÓN, NO MENSAJE POR MENSAJE.

    La primera versión avisaba por cada mensaje de más de 1.200 caracteres y
    saltó con una lista de precios de 1.280. Fui a ver y el bot ya mandaba
    listas así antes del cambio: 1.571 el 30/09, 1.203 el 03/10, 1.002 el 02/10.
    La alarma no distinguía un empalme pasado de rosca de una carta de
    productos.

    Y hay algo peor: no PUEDE distinguirlo. El empalme corta en 1.500, así que
    todo lo que pase de ahí lo escribió el modelo solo. Mirando un mensaje
    suelto no se sabe de dónde salió su largo.

    Lo que sí se puede medir es si la proporción de mensajes largos se movió. Si
    antes uno de cada veinte pasaba los 800 y ahora pasa uno de cada cinco, el
    empalme está apelmazando; si quedó igual, los largos son los de siempre.
  */
  const reparto = await q<any>(
    `SELECT
       count(*) FILTER (WHERE created_at > $1::timestamptz) AS n_desp,
       count(*) FILTER (WHERE created_at > $1::timestamptz AND length(text) > 800) AS largos_desp,
       count(*) FILTER (WHERE created_at <= $1::timestamptz) AS n_antes,
       count(*) FILTER (WHERE created_at <= $1::timestamptz AND length(text) > 800) AS largos_antes
     FROM messages
      WHERE direction='out' AND author='bot' AND content_kind='text'
        AND created_at > $1::timestamptz - interval '7 days'`,
    [desde],
  );
  const z = reparto[0];
  const despues = Number(z.n_desp);
  const antes = Number(z.n_antes);
  if (despues >= 60 && antes >= 200) {
    const pDesp = Number(z.largos_desp) / despues;
    const pAntes = Number(z.largos_antes) / antes;
    if (pDesp > Math.max(0.08, pAntes * 2)) {
      out.push({
        que: 'MÁS MENSAJES LARGOS QUE ANTES',
        h: '—',
        conv: `${despues} mensajes`,
        texto:
          `De más de 800 caracteres: antes ${(pAntes * 100).toFixed(1)}%, ` +
          `ahora ${(pDesp * 100).toFixed(1)}%. El empalme estaría apelmazando.`,
      });
    }
  }

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
    EL BOX CON ENVÍO. Lo que se busca NO es que el mensaje hable de envíos:
    ahora que el bot contesta bien, la respuesta correcta —"ese box solo se
    retira en el local, no se puede enviar"— habla de envíos todo el tiempo y
    hacía sonar la alarma. La primera versión intentaba descartarlas por
    lista ("no se envía", "no enviamos"…) y se le escapó "no se PUEDE enviar".

    Esa lista nunca va a estar completa. Lo que sí separa una cosa de la otra
    sin ambigüedad es PEDIR LOS DATOS DE ENTREGA: una negativa no pregunta la
    dirección ni la franja horaria ni quién lo recibe. Eso es lo que hizo el
    bot el 5 a las 8:43 y lo que no puede volver a hacer.
  */
  const envios = await q<any>(
    `SELECT to_char(created_at AT TIME ZONE $2,'HH24:MI') h, conversation_id, text
       FROM messages WHERE direction='out' AND author='bot' AND content_kind='text'
        AND created_at > $1::timestamptz
        AND (text ILIKE '%gracias por todo%' OR text ILIKE '%te amo m%' OR text ILIKE '%día de la madre%')
        AND (text ILIKE '%franja horaria%'
             OR (text ILIKE '%direcci%' AND text ILIKE '%recibe%')
             OR text ILIKE '%lo llevemos%'
             OR text ILIKE '%para que el cadete%')`,
    [desde, TIMEZONE],
  );
  for (const r of envios) out.push(linea(r, 'BOX DE LA MADRE: PIDIÓ DATOS DE ENTREGA'));

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

/*
  UN HIPO DE RED NO PUEDE MATAR AL VIGILANTE, y lo mató: se cayó con un
  `getaddrinfo ENOTFOUND` hacia Supabase y se quedó horas sin mirar nada. Lo
  peor de un monitor caído es que su silencio se lee igual que "todo bien".

  Así que los errores de consulta no tumban el ciclo: se cuentan, se avisa al
  final, y recién si fallan muchas seguidas se da por vencido —ahí ya no es un
  hipo, es que no hay red y conviene decirlo en vez de fingir que vigila—.
*/
let fallosSeguidos = 0;
let fallosEnTotal = 0;
const FALLOS_PARA_RENDIRSE = 6;

let primera = true;
while (primera || Date.now() < HASTA) {
  primera = false;
  let encontrados: Hallazgo[];
  try {
    encontrados = await buscar(corte);
    fallosSeguidos = 0;
  } catch (err) {
    fallosSeguidos++;
    fallosEnTotal++;
    if (fallosSeguidos >= FALLOS_PARA_RENDIRSE) {
      console.log(
        `\n  ⚠ No pude consultar la base ${fallosSeguidos} veces seguidas. Dejo de vigilar.\n` +
          `     ${(err as Error).message}\n`,
      );
      await closeDb();
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, CADA_MS));
    continue;
  }

  const hallazgos = encontrados.filter((x) => {
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

/*
  EL CIERRE TAMBIÉN VA PROTEGIDO, y esto lo aprendí a los golpes dos veces en
  el mismo día: blindé el bucle contra los cortes de red y me olvidé de esta
  consulta. El vigilante terminó sus ocho horas limpio y se cayó acá, contando.
  El resultado estaba —no hubo hallazgos— y lo perdí por el resumen.
*/
let total: any[] = [{ n: '?' }];
try {
  total = await q<any>(
    `SELECT count(*) n FROM messages WHERE direction='out' AND author='bot'
      AND content_kind='text' AND created_at > $1::timestamptz`,
    [DESDE],
  );
} catch {
  console.log('\n  (no pude contar los mensajes al cerrar, pero la vigilancia terminó sin hallazgos)');
}
/*
  Los fallos reintentados se dicen. Un "sin novedades" después de doce consultas
  que no salieron no es lo mismo que uno después de doce que sí.
*/
console.log(
  `\n  Sin novedades. ${total[0].n} mensajes del bot revisados, nada raro.` +
    (fallosEnTotal ? ` (${fallosEnTotal} consulta(s) fallaron y se reintentaron.)` : '') +
    '\n',
);
await closeDb();
