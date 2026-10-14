/*
  Cuánto costaría el sábado 17 según qué se haga con el bot.

  Del local: "el sábado vamos a tener el local explotado… si yo pongo mensaje
  automático me va a cobrar todos esos mensajes, ¿verdad?". Sí. Esto pone el
  número al lado de cada opción, con los sábados que ya pasaron.
*/
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const TARIFA = 37.6798;

const sabados = await q<any>(
  `SELECT to_char(created_at AT TIME ZONE $1,'DD/MM') dia,
          count(*) FILTER (WHERE direction='in') AS entraron,
          count(DISTINCT conversation_id) FILTER (WHERE direction='in') AS personas,
          count(*) FILTER (WHERE direction='out' AND author='bot') AS bot,
          count(*) FILTER (WHERE direction='out' AND author='human') AS personas_local
     FROM messages
    WHERE created_at > now() - interval '45 days'
      AND extract(dow FROM created_at AT TIME ZONE $1) = 6
    GROUP BY 1 ORDER BY min(created_at)`,
  [TIMEZONE],
);

console.log('\n  LOS SÁBADOS QUE YA PASARON\n');
console.log('  día     entraron   personas   contestó el bot   contestó el local');
for (const s of sabados) {
  console.log(
    `  ${s.dia}   ${String(s.entraron).padStart(8)}   ${String(s.personas).padStart(8)}   ` +
      `${String(s.bot).padStart(15)}   ${String(s.personas_local).padStart(17)}`,
  );
}

const ult = sabados.slice(-3);
const prom = (k: string) => ult.reduce((a: number, s: any) => a + Number(s[k]), 0) / (ult.length || 1);
const personas = Math.round(prom('personas'));
const bot = Math.round(prom('bot'));

console.log(`\n  Promedio de los últimos tres: ${personas} personas escriben, el bot manda ${bot} mensajes.`);
console.log('  Y el 17 va a ser más que un sábado normal: están los box.\n');

const plata = (n: number) => `ARS ${Math.round(n * TARIFA).toLocaleString('es-AR')}`;

console.log('  QUÉ CUESTA CADA OPCIÓN\n');
console.log(`  1. Dejar el bot como está`);
console.log(`       ~${bot} mensajes  →  ${plata(bot)}`);
console.log(`       y sigue tomando pedidos, que es lo que paga eso.\n`);
console.log(`  2. Un mensaje automático de "hoy no atendemos por acá"`);
console.log(`       ~${personas} mensajes (uno por persona)  →  ${plata(personas)}`);
console.log(`       no toma ningún pedido.\n`);
console.log(`  3. Apagarlo del todo`);
console.log(`       0 mensajes  →  ARS 0`);
console.log(`       nadie recibe nada: ni respuesta ni aviso.\n`);

/* Lo que hoy ya se contesta sin gastar: el bot se calla solo bastante. */
const [c] = await q<any>(
  `SELECT count(*) n FROM messages
    WHERE direction='in' AND created_at > now() - interval '7 days'
      AND NOT EXISTS (SELECT 1 FROM messages o WHERE o.conversation_id = messages.conversation_id
                       AND o.direction='out' AND o.created_at > messages.created_at
                       AND o.created_at < messages.created_at + interval '5 minutes')`,
);
const [t] = await q<any>(
  `SELECT count(*) n FROM messages WHERE direction='in' AND created_at > now() - interval '7 days'`,
);
console.log(
  `  Dato de contexto: de ${t.n} mensajes que entraron esta semana, ${c.n} ya no recibieron ` +
    `respuesta\n  (${((Number(c.n) / Number(t.n)) * 100).toFixed(0)}%). El bot no contesta todo.\n`,
);

await closeDb();
