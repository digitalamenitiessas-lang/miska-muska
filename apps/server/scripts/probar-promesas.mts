/**
 * El detector de promesas, contra los mensajes que ya salieron.
 *
 * Lo que se mide NO es que encuentre "lo chequeo y te confirmo". Es cuántas
 * charlas marcaría por día y cuántas de esas son de verdad: cada aviso de más
 * es una charla que alguien abre para descubrir que no hacía falta, y un aviso
 * que se enciende de gusto es un aviso que dejan de mirar.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-promesas.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { prometeConsultar, motivoDeLaPromesa } from '../src/core/policies/promesas.js';

let mal = 0;
const chequear = (ok: boolean, nota: string): void => {
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${nota}`);
};

console.log('\n  Lo que SÍ es una promesa\n');

chequear(
  prometeConsultar('Dale, perfecto. Dejame que lo chequeo en la agenda y te respondo a la brevedad 🙌🏼'),
  'el caso real de la torta de Pauly',
);
chequear(prometeConsultar('Uy, eso lo chequeo y te confirmo 🙈'), 'la forma corta');
chequear(
  prometeConsultar('Lo consulto en cocina para ver qué posibilidades hay con la torta 3 leches'),
  'nombrando con quién se consulta',
);
chequear(
  prometeConsultar('Dame un minuto que lo veo con el local y te aviso'),
  '"dame un minuto que lo veo"',
);
chequear(
  prometeConsultar('Te confirmo en un ratito si llegamos con eso'),
  '"te confirmo en un ratito"',
);

console.log('\n  Lo que NO hay que marcar\n');

chequear(
  !prometeConsultar('Cuando mandes el comprobante te confirmo el pedido 🙌🏼'),
  'un "te confirmo" que depende de que ella haga algo primero',
);
chequear(
  !prometeConsultar('Listo! Tu pedido quedó anotado para mañana a las 10 🩷'),
  'una confirmación, que no promete nada',
);
chequear(
  !prometeConsultar('El Box Popurrí sale $33.000 y viene con budín, cookie y brownie'),
  'un precio',
);
chequear(
  !prometeConsultar('Apenas esté listo te avisamos para que mandes el Uber'),
  'el aviso de cuando esté listo: eso lo dispara el local, no una consulta',
);
chequear(
  !prometeConsultar('Hola! Cómo estás? Contame qué te gustaría llevar 😊'),
  'un saludo',
);

console.log(`\n  Un motivo de ejemplo, que es lo que van a leer en la bandeja:\n`);
console.log(
  '  ' + motivoDeLaPromesa('Dejame que lo chequeo en la agenda y te respondo a la brevedad 🙌🏼'),
);

/* --------------------------------------------------------------------- */

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

/*
  El corpus: se recorre la charla de verdad y se reconstruye qué habría hecho el
  barrido. Para cada mensaje del bot que promete, se mira si una persona del
  local escribió después y cuánto tardó. Es exactamente la cuenta del pipeline.
*/
const DIAS = 14;
/*
  El filtro grueso de la primera consulta NO es la regla: es para no correr una
  subconsulta por cada uno de los diez mil mensajes del bot (así se cortaba la
  conexión). Quien decide es `prometeConsultar`, abajo, en TypeScript. Por eso
  el filtro es más ancho que las expresiones de verdad: si dejara algo afuera,
  la medición diría menos de lo que hay.
*/
const GRUESO = 'chequ|consult|pregunt|averigu|confirmo|aviso|fijo|lo veo';
const filas = await q<{ c: string; t: string; texto: string; espera: string | null }>(
  `with salidas as (
     select m.conversation_id c, m.created_at, coalesce(m.text,'') texto
       from messages m
      where m.direction='out' and m.author='bot' and m.text is not null
        and m.created_at > now() - interval '${DIAS} days'
        and m.text ~* '${GRUESO}'
   )
   select s.c, to_char(s.created_at at time zone $1,'DD/MM HH24:MI') t, s.texto,
          (select round(extract(epoch from min(h.created_at) - s.created_at)/60)
             from messages h
            where h.conversation_id = s.c and h.direction='out' and h.author='human'
              and h.created_at > s.created_at)::text espera
     from salidas s`,
  [TIMEZONE],
);

/*
  Ahora el aviso sale en el acto, así que cada promesa ES un aviso. Lo que
  define si el volumen es sano no es cuántos se encienden sino cuántos se
  APAGAN SOLOS: el aviso se borra apenas alguien del local escribe en la charla.
*/
const promesas = filas.filter((f) => prometeConsultar(f.texto));
const espera = (f: { espera: string | null }) =>
  f.espera === null ? Infinity : Number(f.espera);
const seApaganSolos = promesas.filter((f) => espera(f) <= 15);
const nadieContesto = promesas.filter((f) => f.espera === null);

console.log(`\n  Corpus: ${filas.length} mensajes del bot en ${DIAS} días\n`);
console.log(
  `  ${promesas.length} prometen consultar → ${(promesas.length / DIAS).toFixed(1)} avisos por día`,
);
console.log(
  `  ${seApaganSolos.length} se contestan en 15 min o menos (${(seApaganSolos.length / DIAS).toFixed(1)}/día): ` +
    'esos se apagan solos y nadie los ve',
);
console.log(
  `  ${nadieContesto.length} nadie contestó nunca (${(nadieContesto.length / DIAS).toFixed(1)} por día): ` +
    'esos quedan encendidos, y son los que hoy se pierden callados',
);

/*
  El número que decide si esto sirve: cuántas de las que se rescatarían son
  charlas sin pedido. Una charla que ya terminó en pedido no necesita el aviso.
*/
const ids = [...new Set(nadieContesto.map((f) => f.c))];
if (ids.length) {
  const [conv] = await q<{ sin_pedido: string; con_pedido: string }>(
    `select count(*) filter (where o.c is null)::text sin_pedido,
            count(*) filter (where o.c is not null)::text con_pedido
       from unnest($1::text[]) ch(id)
       left join (select distinct conversation_id c from orders where status <> 'cancelado') o
              on o.c = ch.id`,
    [ids],
  );
  console.log(
    `\n  Esas son ${ids.length} charlas: ${conv.sin_pedido} nunca terminaron en pedido y ` +
      `${conv.con_pedido} sí.`,
  );
}

console.log('\n  Una muestra de lo que se marcaría:\n');
for (const f of nadieContesto.slice(0, 5)) {
  console.log(`  ${f.t}  "${f.texto.replace(/\s+/g, ' ').slice(0, 120)}"`);
}

/*
  Y el freno: si el detector marcara una porción enorme de todo lo que dice el
  bot, estaría agarrando cualquier cosa y hay que volver a las expresiones.

  Contra TODO lo que dijo el bot, no contra lo que pasó el filtro grueso: ese ya
  está sesgado a favor, y medir contra él daría un número inflado que no
  significa nada.
*/
const [todos] = await q<{ n: string }>(
  `select count(*)::text n from messages
    where direction='out' and author='bot' and text is not null
      and created_at > now() - interval '${DIAS} days'`,
);
const proporcion = promesas.length / Math.max(Number(todos.n), 1);
if (proporcion > 0.15) {
  mal++;
  console.log(
    `\n  ✗ marca el ${(proporcion * 100).toFixed(1)}% de TODO lo que dice el bot: es demasiado.`,
  );
} else {
  console.log(`\n  ✓ marca el ${(proporcion * 100).toFixed(1)}% de lo que dice el bot.`);
}

console.log(mal ? `\n  ${mal} fallaron.\n` : '\n  Pasa todo.\n');
await closeDb();
process.exit(mal ? 1 : 0);
