/**
 * La guarda del box del Día de la Madre, contra los mensajes de verdad.
 *
 * Lo que se mide acá no es que encuentre los box —son dos nombres, eso es
 * fácil—. Es cuántas charlas VIEJAS encendería el cartel sin motivo. "Gracias
 * por todo" es el nombre de un box y también lo que escribe media clientela
 * cuando se va contenta; si la guarda no distingue, el local se come un aviso
 * por cada charla que termina bien y deja de mirarlos.
 *
 * Los box se cargaron el 2 de octubre de 2026. Todo lo anterior a esa fecha
 * que dé positivo es, por definición, un falso positivo.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-dia-de-la-madre.mts
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { hablaDelBoxDeLaMadre } from '../src/core/policies/diadelamadre.js';

const CASOS: Array<{ texto: string; esperado: boolean; nota: string }> = [
  { nota: 'la pregunta típica', texto: 'hola! tenés los box del día de la madre?', esperado: true },
  { nota: 'el nombre con box adelante', texto: 'quiero el box gracias por todo', esperado: true },
  { nota: 'el otro, con comillas como lo escribe Agus', texto: 'Box "te amo má": $35.000', esperado: true },
  { nota: 'te amo ma sin tilde', texto: 'me llevo el box te amo ma', esperado: true },
  { nota: 'dia sin tilde', texto: 'consulta por el dia de la madre', esperado: true },
  { nota: 'el bot mandando las dos opciones', texto: 'Para el día de la madre tenemos dos opciones de box', esperado: true },

  { nota: 'la despedida de siempre NO cuenta', texto: 'muchas gracias por todo! divinos como siempre 🥰', esperado: false },
  { nota: 'gracias por todo lejos de un box', texto: 'gracias por todo, la torta salió hermosa. Otro día encargo un box', esperado: false },
  { nota: 'un box cualquiera no es este', texto: 'me mandás el box popurrí?', esperado: false },
  { nota: 'la madre sin el día', texto: 'es para el cumple de mi madre', esperado: false },
  { nota: 'te amo suelto', texto: 'te amo miska muska, son lo más', esperado: false },
];

let mal = 0;
console.log('\n  Casos armados\n');
for (const c of CASOS) {
  const dio = hablaDelBoxDeLaMadre(c.texto);
  const ok = dio === c.esperado;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${c.nota}`);
  if (!ok) console.log(`      esperaba ${c.esperado}, dio ${dio}: "${c.texto}"`);
}

/*
  Y el corpus: 30 días de mensajes anteriores a que los box existieran. Todo lo
  que marque acá es ruido que el local se iba a comer.
*/
openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const msgs = await q<{ t: string; text: string; c: string; d: string }>(
  `select to_char(created_at at time zone $1,'DD/MM HH24:MI') t, text,
          conversation_id c, direction d
     from messages
    where text is not null and created_at > now() - interval '30 days'
      and created_at < '2026-10-02'
    order by created_at asc`,
  [TIMEZONE],
);

const marcados = msgs.filter((m) => hablaDelBoxDeLaMadre(m.text));
const charlas = new Set(marcados.map((m) => m.c));

console.log(`\n  Corpus: ${msgs.length} mensajes de 30 días, todos anteriores a los box.\n`);
console.log(`  Marcaría ${marcados.length} mensajes, en ${charlas.size} charlas.\n`);
for (const m of marcados.slice(0, 20)) {
  console.log(`  ${m.t} ${m.d}  ${m.text.replace(/\s+/g, ' ').slice(0, 150)}`);
}

/* Cuántas veces aparece "gracias por todo" suelto, que es lo que se esquiva. */
const sueltas = msgs.filter((m) => /gracias por todo/i.test(m.text));
console.log(
  `\n  Para dimensionar: "gracias por todo" aparece ${sueltas.length} veces en esos 30 días.`,
);
console.log(`  La guarda ignora ${sueltas.length - marcados.filter((m) => /gracias por todo/i.test(m.text)).length} de ellas.`);

/*
  LA MEDICIÓN QUE IMPORTA.

  Marcar una charla no enciende nada: la guarda recién actúa cuando además
  entra una imagen o un documento. O sea que el ruido real no son las charlas
  que hablan del Día de la Madre —fueron nueve en treinta días y todas eran
  consultas legítimas— sino las que encima mandaron una foto.
*/
const conFoto = await q<{ c: string; t: string; cuantas: string }>(
  `select conversation_id c, to_char(min(created_at) at time zone $1,'DD/MM HH24:MI') t,
          count(*)::text cuantas
     from messages
    where direction='in' and content_kind in ('image','document')
      and created_at > now() - interval '30 days' and created_at < '2026-10-02'
      and conversation_id = any($2::text[])
    group by conversation_id order by 2`,
  [TIMEZONE, [...charlas]],
);

console.log(`\n  De esas ${charlas.size} charlas, ${conFoto.length} recibieron además una foto.`);
console.log('  Esas son las que habrían encendido el cartel de más:\n');
for (const r of conFoto) console.log(`    ${r.t}  ${r.cuantas} foto(s)  [${r.c}]`);

console.log(mal ? `\n  ${mal} casos armados fallaron.\n` : '\n  Los casos armados pasan todos.\n');

await closeDb();
process.exit(mal ? 1 : 0);
