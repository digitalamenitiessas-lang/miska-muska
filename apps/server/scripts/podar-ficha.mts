/**
 * Poda de la ficha del local: saca lo que ya está en el código.
 *
 * La ficha viaja ENTERA en cada mensaje, así que cada línea repetida es lugar
 * que el local no tiene para poner una regla nueva. El pedido, textual: "si hay
 * muchas reglas puestas por el local y ya están configuradas por nosotros en el
 * system prompt o por guardas, achicarlas para que puedan seguir poniendo
 * comportamientos realmente nuevos".
 *
 * QUÉ SE SACA, y solo esto:
 *   · lo que hoy hace una guarda o dice el prompt,
 *   · lo que la ficha se repite a sí misma,
 *   · precios que ya están en el catálogo (el catálogo manda: si cambian uno en
 *     el panel, la ficha mentiría sin que nadie se entere).
 *
 * QUÉ NO SE TOCA: todo lo que decide el local. El Día del Maestro, el Día de la
 * Secretaria, el Box Edición Limitada, el regalo de Karinat, qué trae cada box,
 * a qué zonas se envía. Eso lo manejan ellas y no es asunto del código.
 *
 * Corre sin argumentos para VER el diff; con --aplicar para escribirlo.
 */
import { writeFileSync } from 'node:fs';
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

/** Un corte: el texto exacto que se va, y por qué se puede ir. */
type Corte = { que: string; porque: string; texto: string; queda?: string };

const CORTES: Corte[] = [
  {
    que: 'Tortas grandes: solo retiro',
    porque: 'las reglas ya dicen que las tortas no se envían y salen en Uber auto',
    texto: `TORTAS GRANDES – SOLO RETIRO POR EL LOCAL

Cuando un cliente consulte, encargue o compre una torta grande, tener en cuenta que las tortas grandes son exclusivamente para retiro por el local.

IMPORTANTE:

* NO ofrecer envío a domicilio para tortas grandes.
* NO preguntar “¿es para retiro o envío?”.
* Asumir directamente que es para retirar por el local y continuar tomando el pedido normalmente.
* Si el cliente pregunta específicamente por envío, aclarar amablemente que por seguridad y cuidado del producto, las tortas grandes se retiran únicamente por el local `,
  },
  {
    que: 'Las 6 reglas que repiten el tip de las cookies',
    porque: 'el tip queda arriba, entero; esto lo vuelve a explicar y "no lo repitas" ya es una guarda',
    texto: `REGLAS IMPORTANTES:

* Dar esta recomendación siempre que el pedido incluya cookies, aunque el cliente no pregunte sobre conservación.
* Aplica a todas las variedades de cookies.
* No indicar que deben conservarse en heladera.
* Recomendar exactamente 10 segundos de microondas.
* Para conservarlas, indicar bolsa cerrada + temperatura ambiente.
* No repetir el mensaje varias veces durante el mismo pedido. Decirlo una sola vez, preferentemente cuando el pedido quede definido o confirmado.

`,
  },
  {
    que: 'Precio del Box Requete Feliz',
    porque: 'contradecía al catálogo ($25.300 contra $23.000) y el catálogo es el que manda',
    texto: `Cuando un cliente pregunte, pida o quiera comprar el Box Requete Feliz, informar directamente que:

* 🥪 Viene con sanguchito de jamón y queso en pan de chipá.
* 💰 El precio final es $25.300.

IMPORTANTE: Usar este precio y esta composición directamente. NO decirle al cliente que es una promoción, que es un cambio temporal ni que es “solo por hoy”. Simplemente informar que el Box Requete Feliz sale $25.300 y viene con sanguchito en pan de chipá.`,
    queda: `El Box Requete Feliz viene con sanguchito de jamón y queso EN PAN DE CHIPÁ. El precio sale del catálogo. No es una promoción ni un cambio temporal: se informa y listo.`,
  },
  {
    que: 'Cafetería no se envía (segunda vez)',
    porque: 'ya está dicho más arriba, en la línea que presenta la cafetería',
    texto: `IMPORTANTE: Todos los productos de cafetería y bebidas son exclusivamente para consumir o comprar en el local. NO realizamos envíos de cafetería ni bebidas.

Si un cliente solicita alguno de estos productos para envío/delivery, explicarle amablemente que no están disponibles para envío y que puede consumirlos en nuestro local.

`,
  },
  {
    que: 'Cafetería no se envía (tercera vez)',
    porque: 'la misma regla por tercera vez, y encima quedó cortada a la mitad',
    texto: `REGLA IMPORTANTE PARA EL BOT

Nunca ofrecer cafetería ni bebidas como parte de un envío. Si el cliente está armando un pedido con envío y solicita, por ejemplo, un café, una chocolatada, un jugo o una gaseosa, aclarar:

`,
  },
  {
    que: 'Precios sin TACC',
    porque: 'los tres están en el catálogo, con los mismos números',
    texto: `Si vendemos productos sin tacc, aptos para celiacos. Vendemos: brownie con nueces $5500, alfajor de maicena $4300 y cookie con chips de chocolate $5100. Solo si te preguntan, nuestros demás productos, no son sin tacc.`,
    queda: `Sí vendemos productos sin TACC, aptos para celíacos: están en el catálogo con su precio. Solo si te preguntan: los demás productos NO son sin TACC.`,
  },
  {
    que: 'Precios de tazas, mates y cuadernos',
    porque: 'los cinco están en el catálogo, con los mismos números',
    texto: `Si un cliente pregunta por tazas, mates o cuadernos, respondeles el precio. Lo pueden agregar a su pedido o para un regalo. Las tazas salen $18000, el set con plato y taza $33000, el mate $15500 con bombilla, el cuaderno chiquito $12500 y el cuaderno grande $17000.`,
    queda: `Si preguntan por tazas, mates o cuadernos, pasales el precio del catálogo. Lo pueden sumar al pedido o llevarlo de regalo.`,
  },
  {
    que: 'Horario nocturno: no confirmar stock ni ventas',
    porque: 'es una guarda: de 21:30 a 08:30 crear_pedido rechaza y el prompt lo avisa desde el primer mensaje',
    texto: `HORARIO NOCTURNO – NO CONFIRMAR STOCK NI VENTAS

Entre las 21:30 y las 8:30 hs, el bot NO debe confirmar stock, disponibilidad, tomar pedidos, reservar productos ni cerrar ventas, porque primero debe confirmar la disponibilidad una persona del local.

Durante ese horario, el bot SÍ puede responder consultas, brindar información sobre los productos, explicar qué contiene cada uno y dar precios normalmente.

Si el cliente quiere comprar o encargar, informarle que por la mañana, a partir de las 8:30 hs, una persona del local le confirmará el stock y podrá continuar con el pedido.

IMPORTANTE: Durante ese horario nunca asegurar que un producto está disponible, aunque figure con stock en el sistema.

`,
  },
  {
    que: 'No decir que el pedido ya salió',
    porque: 'es una guarda: si el bot lo escribe, se le reemplaza el mensaje y se avisa al local',
    texto: `Si un cliente hizo un pedido, por mas que ya sea el horario que lo pidio, no le respondas que ya salio o que esta en camino. No decidas cosas asi porque eso lo tiene que decidir y responder un humano. 

`,
  },
  {
    que: 'Los audios no se escuchan',
    porque: 'ya está en las reglas, con el texto que hay que contestar',
    texto: `Cuando el cliente mande audios respondele que estamos desde una computadora en el local, que no podemos escuchar, si es tan amable de escribirte.

`,
  },
  {
    que: 'Cortar cuando el pedido terminó',
    porque: 'ahora el bot tiene una herramienta para callarse, y las reglas dan los ejemplos',
    texto: `Cuando un cliente termina un pedido cortá la conversación, no sigas escribiendo muchas veces más. Por ejemplo si termina con OK, no respondas ese OK con mensajes como “sigo aca para ayudarte”. Corta la conversacion. No seas insistente.

`,
  },
  {
    que: 'El envío siempre se cobra',
    porque: 'las reglas ya lo dicen, y recomendar el Uber Moto ahora es la regla por defecto',
    texto: `Todos los envíos a domicilio tienen costo. Varía según la zona del envío. Pero recomendales pedir uber moto para retirar su pedido, que será más rapido y economico

`,
  },
  {
    que: 'Horario de retiro',
    porque: 'ya está en el horario de atención de la ficha, que el bot cita aparte',
    texto: `Los clientes pueden retirar pedidos de 8 a 21.30 hs. Por mas que a la siesta cerremos tambien lo pueden retirar del carrito

`,
  },
];

let texto = original;
const hechos: Array<{ corte: Corte; saco: number }> = [];
const fallados: string[] = [];

for (const corte of CORTES) {
  const veces = texto.split(corte.texto).length - 1;
  if (veces !== 1) {
    fallados.push(`${corte.que} — ${veces === 0 ? 'no lo encontré' : `aparece ${veces} veces`}`);
    continue;
  }
  const reemplazo = corte.queda ? corte.queda : '';
  texto = texto.replace(corte.texto, () => reemplazo);
  hechos.push({ corte, saco: corte.texto.length - reemplazo.length });
}

// Tres saltos de línea seguidos o más quedan en dos: si no, la poda deja agujeros.
texto = texto.replace(/\n{3,}/g, '\n\n').trim() + '\n';

console.log('  === lo que se saca ===\n');
for (const { corte, saco } of hechos) {
  console.log(`  −${String(saco).padStart(5)}  ${corte.que}`);
  console.log(`          porque ${corte.porque}`);
  if (corte.queda) console.log(`          queda: "${corte.queda.slice(0, 96)}…"`);
}
if (fallados.length) {
  console.log('\n  === NO se pudo cortar (la ficha cambió desde que la leí) ===\n');
  for (const f of fallados) console.log(`  ⚠ ${f}`);
}

console.log('\n  === el resultado ===\n');
console.log(`  antes   ${original.length} caracteres, ${original.split('\n').length} líneas`);
console.log(`  después ${texto.length} caracteres, ${texto.split('\n').length} líneas`);
console.log(`  achica  ${original.length - texto.length} (${((1 - texto.length / original.length) * 100).toFixed(0)}%)`);

writeFileSync('ficha-antes.txt', original, 'utf8');
writeFileSync('ficha-despues.txt', texto, 'utf8');
console.log('\n  guardados: ficha-antes.txt y ficha-despues.txt');

if (!aplicar) {
  console.log('\n  (no se escribió nada en la base: corré con --aplicar para eso)');
} else if (fallados.length) {
  console.log('\n  NO APLICO: hubo cortes que fallaron y prefiero que lo mires.');
  process.exitCode = 1;
} else {
  await q(`update settings set value = jsonb_set(value, '{conocimiento}', $1::jsonb)`, [
    JSON.stringify(texto),
  ]);
  const dsp = await q<{ v: Record<string, unknown> }>(`select value as v from settings limit 1`, []);
  const guardado = String((dsp[0]?.v ?? {}).conocimiento ?? '');
  console.log(
    guardado === texto
      ? `\n  APLICADO: la ficha quedó en ${guardado.length} caracteres.`
      : '\n  ALGO SALIÓ MAL: lo guardado no coincide con lo que armé.',
  );
}

await closeDb();
