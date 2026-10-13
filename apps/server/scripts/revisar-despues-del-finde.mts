/**
 * Repasa si los arreglos del 13 de octubre siguen andando, buscando el error
 * otra vez en lo que salió después de cada uno.
 *
 *   npx tsx --env-file=... scripts/revisar-despues-del-finde.mts            (una vez)
 *   npx tsx --env-file=... scripts/revisar-despues-del-finde.mts --vigilar  (hasta que aparezca algo)
 *
 * TRES COSAS QUE APRENDÍ A LOS GOLPES ESTA SEMANA, con monitores míos que
 * mintieron de tres formas distintas, y que están aplicadas acá:
 *
 *   1. Un corte de red no puede matar al vigilante. Su silencio se lee igual
 *      que "todo bien", así que los errores se reintentan y, si son muchos
 *      seguidos, se dice en voz alta en vez de fingir que vigila.
 *   2. Una alarma tiene que poder distinguir. "Mensaje largo" no servía porque
 *      el bot ya mandaba listas largas antes; "globito suelto" no servía
 *      porque eso ya no existe en la base. Las de acá buscan el error exacto.
 *   3. Las negativas correctas no son hallazgos. El bot diciendo "no se puede
 *      enviar" habla de envíos igual que el bot ofreciéndolos, así que se
 *      busca lo que SOLO aparece cuando está mal.
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const VIGILAR = process.argv.includes('--vigilar');
const DESDE = process.argv.find((a) => a.includes('+00')) ?? '2026-10-13 14:00:00+00';
const CADA_MS = 15 * 60 * 1000;
const HASTA = Date.now() + 8 * 60 * 60 * 1000;

interface Hallazgo {
  que: string;
  h: string;
  conv: string;
  texto: string;
}

async function buscar(): Promise<Hallazgo[]> {
  const out: Hallazgo[] = [];
  const sumar = (rs: any[], que: string) => {
    for (const r of rs) {
      out.push({
        que,
        h: r.h,
        conv: r.conversation_id,
        texto: String(r.t ?? '').replace(/\s+/g, ' ').slice(0, 280),
      });
    }
  };

  /*
    LA CONFIRMACIÓN DEL BOX. El 13 el bot la reescribió: se comió "de 14 a 21"
    y convirtió "recomendamos no enviar cadete" en "mandá el Uber Moto". Se
    marca la que NO trae la franja, y la que ofrece Uber sin ser para negarlo.
  */
  const conf = await q<any>(
    `SELECT to_char(created_at AT TIME ZONE $2,'DD/MM HH24:MI') h, conversation_id, text t
       FROM messages WHERE direction='out' AND author='bot' AND created_at > $1::timestamptz
        AND text ILIKE '%pedido fue tomado%'`,
    [DESDE, TIMEZONE],
  );
  sumar(
    conf.filter((c: any) => !/14 a 21/.test(c.t)),
    'CONFIRMACIÓN DE BOX SIN LA FRANJA DE 14 A 21',
  );
  sumar(
    conf.filter((c: any) => /\buber\b/i.test(c.t) && !/no enviar|no envi|no se puede envi/i.test(c.t)),
    'CONFIRMACIÓN DE BOX OFRECIENDO UBER',
  );

  /* El box antes de las 14: le contesta con el horario del local. */
  sumar(
    await q<any>(
      `SELECT to_char(created_at AT TIME ZONE $2,'DD/MM HH24:MI') h, conversation_id, text t
         FROM messages WHERE direction='out' AND author='bot' AND created_at > $1::timestamptz
          AND (text ILIKE '%box%' OR text ILIKE '%día de la madre%')
          AND (text ILIKE '%desde las 8%' OR text ILIKE '%a las 9%' OR text ILIKE '%9 am%'
               OR text ILIKE '%desde las 9%' OR text ILIKE '%a las 10%' OR text ILIKE '%10 am%')`,
      [DESDE, TIMEZONE],
    ),
    'BOX RETIRABLE ANTES DE LAS 14',
  );

  /* El envío gratis. Nunca se hizo uno. */
  sumar(
    await q<any>(
      `SELECT to_char(created_at AT TIME ZONE $2,'DD/MM HH24:MI') h, conversation_id, text t
         FROM messages WHERE direction='out' AND author='bot' AND created_at > $1::timestamptz
          AND (text ILIKE '%sin cargo%' OR text ILIKE '%sin costo%'
               OR text ILIKE '%envío gratis%' OR text ILIKE '%gratis el envío%')`,
      [DESDE, TIMEZONE],
    ),
    'ENVÍO SIN CARGO',
  );

  /*
    Domingo con el local cerrado. Se busca el compromiso inmediato, no la
    palabra "domingo": el bot nombra el domingo todo el tiempo con razón.
  */
  sumar(
    await q<any>(
      `SELECT to_char(created_at AT TIME ZONE $2,'DD/MM HH24:MI') h, conversation_id, text t
         FROM messages WHERE direction='out' AND author='bot' AND created_at > $1::timestamptz
          AND extract(dow FROM created_at AT TIME ZONE $2) = 0
          AND extract(hour FROM created_at AT TIME ZONE $2) < 14
          AND (text ILIKE '%ya salimos%' OR text ILIKE '%ya sale%' OR text ILIKE '%sale ahora%'
               OR text ILIKE '%te lo llevamos ahora%' OR text ILIKE '%en camino%')`,
      [DESDE, TIMEZONE],
    ),
    'DOMINGO A LA MAÑANA: PROMETIÓ ENTREGA CON EL LOCAL CERRADO',
  );

  /*
    Cookies frenadas como si fueran torta.

    SE BUSCA QUE LA GUARDA HAYA ACTUADO, no la frase suelta. "Chequeo en la
    agenda" también la escribe el bot por su cuenta y muchas veces con razón:
    el 13 a las 16:09 una clienta preguntó si tendrían Box Popurrí durante la
    semana para el sábado y el bot contestó que lo chequeaba. Eso está bien y
    la guarda ni se enteró —el handler era 'agent'—, pero mi alarma lo marcó
    igual y me hizo salir a buscar un bug que no existía.

    Cuando la guarda SÍ actúa, reemplaza la burbuja por su texto enlatado y
    deja el handler en 'escalate'. Esas dos cosas juntas no las produce nadie
    más.
  */
  sumar(
    await q<any>(
      `SELECT to_char(created_at AT TIME ZONE $2,'DD/MM HH24:MI') h, conversation_id, text t
         FROM messages m WHERE direction='out' AND author='bot' AND created_at > $1::timestamptz
          AND handler = 'escalate'
          AND text ILIKE 'Perfecto! Ya chequeo en la agenda%'
          AND EXISTS (SELECT 1 FROM messages x WHERE x.conversation_id=m.conversation_id
                       AND x.text ILIKE '%cookie%' AND x.created_at > $1::timestamptz)
          AND NOT EXISTS (SELECT 1 FROM messages y WHERE y.conversation_id=m.conversation_id
                           AND (y.text ILIKE '%torta%' OR y.text ILIKE '%desayuno%')
                           AND y.text NOT ILIKE '%mini torta%' AND y.created_at > $1::timestamptz)`,
      [DESDE, TIMEZONE],
    ),
    'COOKIES FRENADAS COMO TORTA',
  );

  /* El alias de la otra cuenta. La guarda lo corrige, así que no debería verse. */
  sumar(
    await q<any>(
      `SELECT to_char(created_at AT TIME ZONE $2,'DD/MM HH24:MI') h, conversation_id, text t
         FROM messages m WHERE direction='out' AND author='bot' AND created_at > $1::timestamptz
          AND text ILIKE '%miskamuskacursos%'
          AND NOT EXISTS (SELECT 1 FROM messages y WHERE y.conversation_id=m.conversation_id
                           AND (y.text ILIKE '%curso%' OR y.text ILIKE '%taller%'))`,
      [DESDE, TIMEZONE],
    ),
    'ALIAS DE CURSOS EN UNA VENTA DE PASTELERÍA',
  );

  return out;
}

const pulso = async () => {
  const [p] = await q<any>(
    `SELECT count(*) FILTER (WHERE direction='in') AS entraron,
            count(*) FILTER (WHERE direction='out' AND author='bot') AS contesto,
            count(DISTINCT conversation_id) AS charlas,
            to_char(max(created_at) AT TIME ZONE $2,'DD/MM HH24:MI') AS ultimo
       FROM messages WHERE created_at > $1::timestamptz`,
    [DESDE, TIMEZONE],
  );
  return `${p.entraron} entraron · ${p.contesto} contestó el bot · ${p.charlas} charlas · último ${p.ultimo}`;
};

const yaVisto = new Set<string>();
let fallosSeguidos = 0;
let fallosEnTotal = 0;
let primera = true;

while (primera || (VIGILAR && Date.now() < HASTA)) {
  primera = false;
  let hallazgos: Hallazgo[];
  try {
    hallazgos = await buscar();
    fallosSeguidos = 0;
  } catch (err) {
    fallosSeguidos++;
    fallosEnTotal++;
    if (fallosSeguidos >= 6) {
      console.log(`\n  ⚠ No pude consultar la base seis veces seguidas. Dejo de vigilar.`);
      console.log(`     ${(err as Error).message}\n`);
      break;
    }
    await new Promise((r) => setTimeout(r, CADA_MS));
    continue;
  }

  const nuevos = hallazgos.filter((x) => {
    const k = `${x.que}|${x.conv}|${x.h}`;
    if (yaVisto.has(k)) return false;
    yaVisto.add(k);
    return true;
  });

  if (nuevos.length) {
    console.log(`\n  ⚠ ${nuevos.length} cosa(s) para mirar:\n`);
    for (const x of nuevos) {
      console.log(`  ── ${x.que}`);
      console.log(`     ${x.h} · ${x.conv}`);
      console.log(`     ${x.texto}\n`);
    }
    break;
  }

  if (!VIGILAR) {
    try {
      console.log(`\n  Sin novedades. ${await pulso()}\n`);
    } catch {
      console.log('\n  Sin novedades (no pude leer el pulso).\n');
    }
    break;
  }
  await new Promise((r) => setTimeout(r, CADA_MS));
}

if (VIGILAR && !yaVisto.size) {
  try {
    console.log(`\n  Se terminó la vigilancia sin hallazgos. ${await pulso()}`);
  } catch {
    console.log('\n  Se terminó la vigilancia sin hallazgos.');
  }
  if (fallosEnTotal) console.log(`  (${fallosEnTotal} consulta(s) fallaron y se reintentaron.)`);
  console.log();
}

await closeDb();
