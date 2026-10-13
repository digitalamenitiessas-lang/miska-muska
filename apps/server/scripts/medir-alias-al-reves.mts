/*
  El bot pidiendo el alias en vez de darlo.

  El 13 de octubre: "Dale, entonces pasame el alias para que transfieras!".
  Eso lo dice la clienta, no nosotros. Y el efecto no es sonar raro: el bot
  NUNCA le pasó el alias. Esa venta se cerró porque ella lo tenía de un
  mensaje anterior; sin eso, se quedaba esperando.

  LA DISTINCIÓN QUE IMPORTA: "pasame TU alias" es correcto y se usa de verdad
  —cuando hay que devolverle plata a alguien, el local le pide su alias—. Lo
  que está mal es "pasame EL alias", que es el nuestro y lo tenemos que dar
  nosotros. Una regla que no las separe rompe las devoluciones.
*/
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const msgs = await q<any>(
  `SELECT to_char(created_at AT TIME ZONE $1,'DD/MM HH24:MI') h, author, direction,
          conversation_id c, text
     FROM messages
    WHERE text ILIKE '%alias%' AND created_at > now() - interval '30 days'
    ORDER BY created_at ASC`,
  [TIMEZONE],
);

/* Pedir el alias: "pasame", "me pasás", "mandame", "pasanos"… */
/*
  PEGADO, sin palabras en el medio. Con un hueco de 25 caracteres entraba
  "Una vez que me lo pasas, te doy el alias", donde el "me lo pasas" es el
  celular y el alias lo DA el bot. El error es pedir el alias como objeto
  directo: "pasame el alias".
*/
const PIDE_ALIAS =
  /\b(pasa(me|nos)|mand[áa]?(me|nos)|me pas[áa]s|nos pas[áa]s|envia(me|nos))\s+(el\s+)?alias\b/i;
/* El alias de ELLA, que sí se le pide, para devolverle plata. */
const ALIAS_DE_ELLA = /\b(tu|su)\s+alias\b/i;

const delBot = msgs.filter((m: any) => m.direction === 'out' && m.author === 'bot');
const mal: any[] = [];
const bien: any[] = [];

/*
  EL DISCRIMINADOR: si el mensaje trae el alias escrito, el bot lo está DANDO,
  por torcida que suene la frase. "Una vez que me lo pasas, te doy el alias" y
  "me pasás por transferencia al alias miskapedidos" entraban como errores y
  están bien dichas. El error de verdad es pedirlo sin darlo.
*/
const TRAE_EL_ALIAS = /\bmiska(pedidos|muskacursos)\b/i;

for (const m of delBot) {
  if (!PIDE_ALIAS.test(m.text)) continue;
  if (TRAE_EL_ALIAS.test(m.text)) continue;
  (ALIAS_DE_ELLA.test(m.text) ? bien : mal).push(m);
}

console.log(`\n  ${msgs.length} mensajes nombran el alias en 30 días.`);
console.log(`  ${delBot.length} son del bot.\n`);
console.log(`  El bot PIDE el alias: ${mal.length + bien.length}`);
console.log(`    ${bien.length} piden "TU alias" → correcto, es para devolver plata`);
console.log(`    ${mal.length} piden "EL alias" → al revés, lo tenemos que dar nosotros\n`);

console.log('  LOS QUE ESTÁN AL REVÉS:\n');
for (const m of mal) {
  console.log(`  ── ${m.h} · ${m.c}`);
  console.log(`     ${m.text.replace(/\s+/g, ' ').slice(0, 220)}\n`);
}

console.log('  LOS QUE PIDEN "TU ALIAS" Y ESTÁN BIEN:\n');
for (const m of bien.slice(0, 5)) {
  console.log(`  ── ${m.h}  ${m.text.replace(/\s+/g, ' ').slice(0, 160)}\n`);
}

/* Y para dimensionar: cuántas veces lo da bien. */
const DA_ALIAS = /\b(te paso el alias|el alias es|alias:?\s*miska|ac[áa] va el alias)\b/i;
console.log(`  Para dimensionar: lo da bien ${delBot.filter((m: any) => DA_ALIAS.test(m.text)).length} veces.\n`);

await closeDb();
