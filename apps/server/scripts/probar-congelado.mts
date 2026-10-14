/**
 * Que el corte de cierre no invente ni pierda plata.
 *
 * Es la misma lección del 1 de octubre, cuando lo que no se había cobrado
 * desapareció del panel al cambiar el mes: la plata que no se cobró no se
 * evapora, y hay que saber siempre de qué período es cada peso.
 *
 * Acá se verifica el invariante de la partición, que es lo único que tiene que
 * ser cierto para que el congelado sea seguro:
 *
 *     [desde → corte)  +  [corte → ahora)  ==  [desde → ahora)
 *
 * Si eso se cumple, ningún turno queda contado dos veces ni se cae por el
 * agujero del medio. Si no se cumple, alguien paga de más o de menos, y es la
 * clase de error que se descubre con la factura adelante.
 *
 * Se corre contra la base real, que es donde están los casos raros: turnos en
 * el borde exacto, días sin un solo turno, costos nulos.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-congelado.mts
 */
import { openDb, q, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const repos = createRepositories();

let fallas = 0;
const ok = (bien: boolean, que: string, detalle = '') => {
  console.log(`  ${bien ? 'ok  ' : 'FALLA'} ${que}${detalle ? `   ${detalle}` : ''}`);
  if (!bien) fallas++;
};

/* Un centavo de dólar partido en mil: el redondeo de punto flotante sumando
   miles de turnos no puede hacer fallar una prueba de contabilidad. */
const IGUALES = (a: number, b: number) => Math.abs(a - b) < 0.00001;

const [bordes] = await q<any>(
  `SELECT MIN(created_at) AS primero, MAX(created_at) AS ultimo, COUNT(*) AS n FROM model_turns`,
  [],
);
if (!Number(bordes.n)) {
  console.log('\n  No hay turnos en la base: no hay nada que verificar.\n');
  await closeDb();
  process.exit(0);
}

const desde = new Date(bordes.primero).toISOString();
console.log(`\n  ${Number(bordes.n).toLocaleString('es-AR')} turnos entre`);
console.log(`  ${desde}  y  ${new Date(bordes.ultimo).toISOString()}\n`);

const entero = await repos.metrics.facturacion(desde, '');
ok(!entero.congelado, 'sin corte, el período NO figura congelado');
ok(entero.hasta === '', 'sin corte, no hay fecha de cierre');

/*
  Se parte en varios puntos, no en uno: el medio, y además los bordes exactos,
  que es donde un `>=` de más o de menos cambia el resultado.
*/
const inicio = Date.parse(desde);
const fin = Date.parse(bordes.ultimo);
const cortes = [
  ['justo al principio', inicio],
  ['un cuarto', inicio + (fin - inicio) * 0.25],
  ['al medio', inicio + (fin - inicio) * 0.5],
  ['tres cuartos', inicio + (fin - inicio) * 0.75],
  ['justo al final', fin],
  ['después del último turno', fin + 60_000],
] as const;

for (const [nombre, ms] of cortes) {
  const corte = new Date(ms).toISOString();
  const izq = await repos.metrics.facturacion(desde, corte);
  const der = await repos.metrics.facturacion(corte, '');

  ok(
    IGUALES(izq.costoUsd + der.costoUsd, entero.costoUsd),
    `${nombre}: la plata de los dos lados suma el total`,
    `${izq.costoUsd.toFixed(4)} + ${der.costoUsd.toFixed(4)} = ${entero.costoUsd.toFixed(4)}`,
  );
  ok(
    izq.turnos + der.turnos === entero.turnos,
    `${nombre}: los turnos de los dos lados suman el total`,
    `${izq.turnos} + ${der.turnos} = ${entero.turnos}`,
  );
  ok(izq.congelado, `${nombre}: con corte, el período figura congelado`);
  ok(izq.hasta === corte, `${nombre}: la fecha de cierre vuelve tal cual`);
}

/*
  EL CASO QUE ROMPIÓ LA PRIMERA VERSIÓN: un período sin un solo turno adentro.
  Con el techo puesto en un WHERE en vez del JOIN, la consulta no devolvía
  ninguna fila y el panel no mostraba cero — no mostraba nada, que es lo mismo
  que decir "no se debe plata".
*/
const vacio = await repos.metrics.facturacion(desde, desde);
ok(vacio.costoUsd === 0, 'un período vacío devuelve cero, no nada', `${vacio.costoUsd}`);
ok(vacio.turnos === 0, 'un período vacío devuelve cero turnos');
ok(vacio.desde !== '', 'un período vacío igual dice desde cuándo contaba');

/*
  Congelar NO puede dar más que no congelar: si diera más, habría turnos
  contados dos veces.
*/
const mitad = await repos.metrics.facturacion(desde, new Date(inicio + (fin - inicio) / 2).toISOString());
ok(mitad.costoUsd <= entero.costoUsd, 'congelar nunca da más que el período abierto');

console.log(
  fallas
    ? `\n  ${fallas} ${fallas === 1 ? 'falla' : 'fallas'}. NO congeles nada hasta arreglarlo.\n`
    : '\n  Todo bien: el corte no inventa ni pierde un dólar.\n',
);

await closeDb();
process.exit(fallas ? 1 : 0);
