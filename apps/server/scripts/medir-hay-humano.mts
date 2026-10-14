/*
  CUÁNTO HACE QUE HABLÓ ESA PERSONA.

  La guarda de encargos se apaga si alguien del local ya habló en la charla:
  ahí la torta está autorizada y discutirle a una empleada es peor que no tener
  guarda. El razonamiento es bueno; la implementación no tiene reloj.

  El 13 de octubre a las 23:08 el bot comprometió una Frutimiska para el día
  siguiente y pidió la seña. La clienta pagó $23.000. A la mañana una persona
  tuvo que escribirle que no hay frutillas en temporada.

  La guarda no corrió porque una persona del local había hablado en esa charla
  … el 7 de octubre, por otro pedido, que terminó con un "entregado!". Seis
  días antes.

  Esto mide, para cada mensaje que la guarda HABRÍA frenado, cuánto hacía que
  esa persona había hablado. De ahí sale dónde poner el corte.
*/
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { comprometeEncargo } from '../src/core/policies/encargos.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const msgs = await q<any>(
  `SELECT m.id, m.conversation_id c, m.created_at, m.text,
          to_char(m.created_at AT TIME ZONE $1,'DD/MM HH24:MI') h
     FROM messages m
    WHERE m.direction='out' AND m.author='bot' AND m.text IS NOT NULL
      AND m.created_at > now() - interval '14 days'
    ORDER BY m.created_at ASC`,
  [TIMEZONE],
);

/* Último mensaje de una persona del local, por charla, acumulando en el tiempo. */
const todos = await q<any>(
  `SELECT conversation_id c, created_at, direction, author, coalesce(text,'') text
     FROM messages WHERE created_at > now() - interval '21 days'
    ORDER BY created_at ASC`,
);

const ultimoHumano = new Map<string, number>();
const historial = new Map<string, string[]>();
const porAntiguedad = new Map<string, number>();
let frenaria = 0;
let apagadaPorHumano = 0;
const viejos: any[] = [];

const indice = new Map<string, any[]>();
for (const t of todos) {
  const l = indice.get(t.c) ?? [];
  l.push(t);
  indice.set(t.c, l);
}

for (const m of msgs) {
  const lista = indice.get(m.c) ?? [];
  const antes = lista.filter((x) => Date.parse(x.created_at) < Date.parse(m.created_at));
  const ctx = antes.slice(-2).map((x) => x.text).join(' ');
  const hayCookies = /\bcookies?\b/i.test(antes.slice(-10).map((x) => x.text).join(' ') + m.text);

  /* ¿La habría frenado si NO hubiera ninguna persona en la charla? */
  if (!comprometeEncargo(m.text, false, ctx, hayCookies)) continue;
  frenaria++;

  const humano = [...antes].reverse().find((x) => x.direction === 'out' && x.author === 'human');
  if (!humano) continue;
  apagadaPorHumano++;

  const horas = (Date.parse(m.created_at) - Date.parse(humano.created_at)) / 3_600_000;
  const cubo =
    horas < 1 ? 'menos de 1 h' : horas < 4 ? '1 a 4 h' : horas < 12 ? '4 a 12 h'
      : horas < 24 ? '12 a 24 h' : horas < 72 ? '1 a 3 días' : 'más de 3 días';
  porAntiguedad.set(cubo, (porAntiguedad.get(cubo) ?? 0) + 1);
  if (horas >= 12 && viejos.length < 12) {
    viejos.push({ h: m.h, horas: horas.toFixed(0), c: m.c, t: m.text.replace(/\s+/g, ' ').slice(0, 150) });
  }
}

console.log(`\n  ${msgs.length} mensajes del bot, 14 días.`);
console.log(`  La guarda frenaría ${frenaria} si no existiera la excepción.`);
console.log(`  De esas, ${apagadaPorHumano} se apagan porque alguien del local habló antes.\n`);
console.log('  CUÁNTO HACÍA QUE HABÍA HABLADO:\n');
for (const cubo of ['menos de 1 h', '1 a 4 h', '4 a 12 h', '12 a 24 h', '1 a 3 días', 'más de 3 días']) {
  const n = porAntiguedad.get(cubo) ?? 0;
  if (n) console.log(`    ${cubo.padEnd(14)} ${String(n).padStart(4)}  ${'█'.repeat(n)}`);
}

console.log('\n  LAS QUE SE APAGAN POR ALGUIEN QUE HABLÓ HACE MÁS DE 12 h:\n');
for (const v of viejos) {
  console.log(`    ${v.h}  (hace ${v.horas} h)  ${v.t}`);
}

/*
  Y el efecto del corte elegido, que es lo que hay que poder defender: cuántas
  se siguen respetando y cuántas vuelven a frenarse.
*/
const CORTE = 4;
let respetadas = 0;
let recuperadas = 0;
for (const [cubo, n] of porAntiguedad) {
  const dentro = cubo === 'menos de 1 h' || cubo === '1 a 4 h';
  if (dentro) respetadas += n;
  else recuperadas += n;
}
console.log(`\n  CON UNA VENTANA DE ${CORTE} HORAS:`);
console.log(`    ${respetadas} se siguen respetando (hay alguien encima de la charla)`);
console.log(`    ${recuperadas} vuelven a frenarse, ${(recuperadas / 14).toFixed(1)} por día\n`);

await closeDb();
