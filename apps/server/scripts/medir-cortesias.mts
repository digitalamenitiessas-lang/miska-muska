/*
  CUÁNTO CUESTA CONTESTAR "DE NADA".

  Del local: "un mensaje que ya no es respondible, digamos, que no le conteste,
  porque aquí le ha puesto OK y ahí le ha contestado. O pone gracias y le pone
  de nada. No sé si se puede hacer que no conteste, así vamos acortando los
  mensajes".

  Desde octubre cada mensaje que sale cuesta ARS 37,6798, así que un "de nada"
  ya no es gratis. Lo que hay que medir antes de tocar nada es cuántos son, y
  sobre todo cuántos de los que PARECEN cierre en realidad no lo son: callarse
  cuando la clienta todavía esperaba algo es peor que un mensaje de más.
*/
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const TARIFA = 37.6798;

/*
  Señales de cierre: mensajes que no piden nada. La lista es corta y literal a
  propósito —se compara el mensaje ENTERO, no que contenga la palabra— porque
  "gracias, y para cuándo lo tendrían?" sí necesita respuesta.
*/
/*
  SOLO LOS AGRADECIMIENTOS, y la primera versión de esto estaba mal.

  Había puesto también "ok", "dale", "listo", "si", "sisi", "perfecto". El
  corpus mostró que esas NO son cierres: son respuestas a preguntas que el bot
  acababa de hacer.

    «Si»    → "Para tomar el pedido necesito tu nombre y apellido"
    «Dale»  → "Cuando hayas transferido los $23.000 restantes…"
    «Sii»   → "El alias es miskapedidos… Total: $9.700"
    «Sisi»  → "Disculpá, con Uber o en el local?"
    «Listo» → "Recibido! Ya nos ponemos a armar tu pedido"

  Callar esas habría roto ventas en la mitad del camino. "Gracias" es otra
  cosa: nadie contesta "gracias" a "¿con Uber o en el local?".
*/
const CIERRE =
  /^(graciass*|much[ií]simas gracias|muchas gracias|mil gracias|gracias totales|gracias a (vos|uds|ustedes))[\s!¡.…🙌🙏🩷💕💗🥰😊😍🤍❤✨👍🫶💖🙂👌😘🤗💐🎉]*$/i;

/*
  Y lo que contesta tiene que ser PURA CORTESÍA. Un "gracias" también puede
  venir en el medio de una venta —«Gracias» → "Ahora lo chequeo y en un ratito
  te confirmo"— y ahí el mensaje lleva información que la clienta espera.
*/
const PURA_CORTESIA =
  /^(de nada|a vos|a vos!?|un gusto|gracias a vos|no hay de qu[eé]|por nada|siempre)\b/i;

const msgs = await q<any>(
  `SELECT m.id, m.conversation_id c, m.created_at, m.direction, m.author, m.content_kind,
          coalesce(m.text,'') text, m.cost_usd,
          to_char(m.created_at AT TIME ZONE $1,'DD/MM HH24:MI') h
     FROM messages m
    WHERE m.created_at > now() - interval '14 days'
    ORDER BY m.conversation_id, m.created_at`,
  [TIMEZONE],
);

/* Se recorre la charla y se busca: cierre de ella → respuesta del bot. */
let cierres = 0;
let contestados = 0;
let omitidos = 0;
let cortesias = 0;
const ejemplos: any[] = [];
const conFondo: any[] = [];
let costoUsd = 0;

for (let i = 0; i < msgs.length; i++) {
  const m = msgs[i];
  if (m.direction !== 'in' || m.content_kind !== 'text') continue;
  if (!CIERRE.test(m.text.trim())) continue;
  cierres++;

  /* ¿Qué pasó después, en la misma charla y dentro de cinco minutos? */
  const sig = msgs
    .slice(i + 1)
    .find((x: any) => x.c === m.c && Date.parse(x.created_at) - Date.parse(m.created_at) < 5 * 60_000);

  if (!sig || sig.direction === 'in') {
    omitidos++;
    continue;
  }
  if (sig.author !== 'bot') continue;
  contestados++;

  const limpio = sig.text.replace(/\s+/g, ' ').trim();
  const esCortesia = PURA_CORTESIA.test(limpio) && !limpio.includes('?') && limpio.length < 90;
  if (esCortesia) {
    cortesias++;
    costoUsd += Number(sig.cost_usd ?? 0);
    if (ejemplos.length < 15) ejemplos.push({ h: m.h, ella: m.text.trim(), bot: limpio.slice(0, 100) });
  } else if (conFondo.length < 15) {
    conFondo.push({ h: m.h, ella: m.text.trim(), bot: limpio.slice(0, 110) });
  }
}

const dias = 14;
console.log(`\n  ${msgs.length} mensajes en ${dias} días.\n`);
console.log(`  Mensajes de ella que son puro cierre: ${cierres}`);
console.log(`    el bot contestó      : ${contestados}`);
console.log(`      de esas, PURA CORTESÍA: ${cortesias}  (${(cortesias / dias).toFixed(1)} por día)`);
console.log(`      con información real  : ${contestados - cortesias}  ← estas NO se pueden callar`);
console.log(`    ya se quedó callado  : ${omitidos}  (${((omitidos / cierres) * 100).toFixed(0)}% — o sea que a veces ya lo hace)\n`);

const porMes = (cortesias / dias) * 31;
console.log(`  Si no contestara ninguno:`);
console.log(`    ${Math.round(porMes)} mensajes menos por mes`);
console.log(`    ARS ${Math.round(porMes * TARIFA).toLocaleString('es-AR')} de WhatsApp`);
console.log(`    USD ${((costoUsd / dias) * 31).toFixed(2)} de modelo\n`);

console.log('  QUÉ CONTESTA (una muestra):\n');
for (const e of ejemplos) {
  console.log(`    ${e.h}  «${e.ella.slice(0, 26)}»  →  ${e.bot}`);
}
console.log();

await closeDb();
