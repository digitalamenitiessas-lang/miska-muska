/**
 * Subordina las reglas de la ficha al stock del día.
 *
 * El domingo 6 el Box de Cookies Edición Limitada estaba apagado todo el día y
 * el bot lo ofreció 32 veces como disponible (y aclaró que no había otras 36:
 * mitad y mitad, el mismo día). Hubo que devolver plata y una clienta llamó
 * insultando.
 *
 * No fue una regla rota. Fue una contradicción:
 *
 *   contexto del día  →  "HOY NO HAY: Box de cookies edición limitada"
 *   la ficha          →  "ofrecer SIEMPRE el Box de Cookies Edición Limitada"
 *                        "Tenemos disponible para la venta un nuevo Box"
 *
 * El modelo la resolvió a cara o cruz. Hay una respuesta suya que lo dice todo:
 * "Ah mirá, me corrigen: sí tenemos Box Edición Limitada".
 *
 * Esto no borra las reglas del local —el box se sigue ofreciendo, que es lo que
 * ellas quieren— sino que les agrega la condición que faltaba: si hoy no está,
 * no está. Las palabras "SIEMPRE" y "Tenemos disponible" eran el problema.
 *
 * Corre en seco por defecto; con --aplicar escribe.
 */
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

const CAMBIOS: Array<{ que: string; de: string; a: string }> = [
  {
    que: 'El "SIEMPRE ofrecer el box" queda condicionado al stock',
    de: 'Cada vez que un cliente pregunte qué cookies hay, qué sabores tienen disponibles, qué variedades de cookies venden o haga una consulta similar, además de informar las cookies habituales, ofrecer SIEMPRE el Box de Cookies Edición Limitada.',
    a: 'Cada vez que un cliente pregunte qué cookies hay, qué sabores tienen disponibles, qué variedades de cookies venden o haga una consulta similar, además de informar las cookies habituales, ofrecer el Box de Cookies Edición Limitada — SIEMPRE QUE ESTÉ EN LA LISTA DE DISPONIBLES DE HOY. Si figura en HOY NO HAY, no se ofrece: se dice que hoy no queda y se cuenta qué trae, por si lo quiere otro día.',
  },
  {
    que: 'El "no esperar a que pregunte" ya no pisa el stock',
    de: 'IMPORTANTE: No esperar a que el cliente pregunte específicamente por el box. Si consulta por cookies disponibles, incluirlo automáticamente entre las opciones.',
    a: 'IMPORTANTE: No esperar a que el cliente pregunte específicamente por el box. Si consulta por cookies disponibles, incluirlo automáticamente entre las opciones — salvo que hoy esté agotado, en cuyo caso no entra en la lista de opciones.',
  },
  {
    que: 'El "tenemos disponible para la venta" pasa a ser un lanzamiento, no un estado',
    de: 'Tenemos disponible para la venta un nuevo Box de Cookies Edición Limitada. Cuando un cliente pregunte por novedades, cookies nuevas, edición limitada o por este box, ofrecerlo.',
    a: 'Sacamos un Box de Cookies Edición Limitada. Cuando un cliente pregunte por novedades, cookies nuevas, edición limitada o por este box, ofrecerlo SI HOY ESTÁ DISPONIBLE. Que exista el producto no significa que hoy haya: eso lo dice la lista del día, y esa lista manda.',
  },
  {
    que: 'El regalo de Karinat también depende de que haya box',
    de: '🎁 REGALO: Actualmente, TODOS los Box Edición Limitada van con una bolsa de Bananas Bite de Karinat de regalo. Informar y promocionar este regalo al ofrecer el box.',
    a: '🎁 REGALO: Actualmente, TODOS los Box Edición Limitada van con una bolsa de Bananas Bite de Karinat de regalo. Informar y promocionar este regalo al ofrecer el box (y no lo menciones si hoy no hay box).',
  },
];

let texto = original;
const hechos: string[] = [];
const fallados: string[] = [];
for (const c of CAMBIOS) {
  const veces = texto.split(c.de).length - 1;
  if (veces !== 1) {
    fallados.push(`${c.que} — ${veces === 0 ? 'no lo encontré' : `aparece ${veces} veces`}`);
    continue;
  }
  texto = texto.replace(c.de, () => c.a);
  hechos.push(c.que);
}

/*
  Y una regla de una línea, arriba de todo: el stock del día le gana a lo que
  diga cualquier otra parte de la ficha. Va PRIMERO porque la ficha se lee de
  arriba hacia abajo y esta tiene que enmarcar todo lo que viene después.
*/
const ENCABEZADO = `EL STOCK DEL DÍA MANDA SOBRE TODO LO QUE DICE ESTA FICHA.
Si un producto figura en HOY NO HAY, no se ofrece como disponible, no se cotiza como algo
que se puede comprar hoy y no se carga en un pedido de hoy — por más que más abajo diga
"ofrecelo siempre" o "tenemos disponible". Esas frases describen qué vendemos, no qué hay
hoy. Se dice que hoy no queda, se cuenta qué trae, y se ofrece lo que sí hay.

`;
if (!texto.startsWith('EL STOCK DEL DÍA MANDA')) texto = ENCABEZADO + texto;

console.log('  === cambios ===\n');
for (const h of hechos) console.log(`  ok  ${h}`);
for (const f of fallados) console.log(`  ⚠  ${f}`);
console.log(`  ok  encabezado: "el stock del día manda sobre todo lo que dice esta ficha"`);
console.log(`\n  antes ${original.length} car → después ${texto.length} car`);

if (!aplicar) {
  console.log('\n  (en seco: no se escribió nada. Corré con --aplicar)');
} else if (fallados.length) {
  console.log('\n  NO APLICO: hubo cambios que fallaron.');
  process.exitCode = 1;
} else {
  await q(`update settings set value = jsonb_set(value, '{conocimiento}', $1::jsonb)`, [
    JSON.stringify(texto),
  ]);
  const dsp = await q<{ v: Record<string, unknown> }>(`select value as v from settings limit 1`, []);
  const ok = String((dsp[0]?.v ?? {}).conocimiento ?? '') === texto;
  console.log(ok ? '\n  APLICADO y verificado.' : '\n  ALGO SALIÓ MAL al guardar.');
}
await closeDb();
