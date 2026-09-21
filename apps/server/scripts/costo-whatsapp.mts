/**
 * Cuánto va a costar WhatsApp desde el 1 de octubre de 2026.
 *
 * QUÉ CAMBIA. Hasta ahora los mensajes de servicio —cualquier cosa que sale de
 * nuestro lado dentro de la ventana de 24 h que abre el cliente— no se cobraban
 * desde noviembre de 2024. Desde el 1/10/2026 Meta los cobra POR MENSAJE, a la
 * misma tarifa que las plantillas de utilidad del país, con 1.000 gratis por
 * número por mes y sin descuento por volumen.
 *
 * POR QUÉ NOS PEGA DE LLENO, y esto no es opinión: el 99,5% de las charlas las
 * abre el cliente y no mandamos ni una campaña. O sea que prácticamente cada
 * mensaje que sale de Miska es de los que pasan a cobrarse.
 *
 * Lo que NO se cobra: lo que entra. Los 1.200 y pico de mensajes diarios que
 * nos escriben siguen siendo gratis.
 *
 * LA TARIFA es de Argentina y hay que confirmarla contra la lista oficial de
 * Meta: acá se usa la de utilidad publicada para el país. Se pasa por parámetro
 * justamente porque va a cambiar.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/costo-whatsapp.mts [tarifa] [dias]
 */
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

/** USD por mensaje saliente. Argentina, categoría utilidad. */
const TARIFA = Number(process.argv[2] ?? 0.012);
/** Sobre cuántos días completos promediar. */
const DIAS = Number(process.argv[3] ?? 14);
/** Lo que Meta regala por número y por mes. */
const GRATIS_POR_MES = 1000;

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const dia = `(created_at at time zone '${TIMEZONE}')::date`;
const ventana =
  `${dia} < (now() at time zone '${TIMEZONE}')::date ` +
  `and ${dia} >= (now() at time zone '${TIMEZONE}')::date - ${DIAS}`;

const [base] = await q<{ bot: string; humano: string; dias: string }>(
  `select
     count(*) filter (where direction='out' and author='bot')::text bot,
     count(*) filter (where direction='out' and author='human')::text humano,
     count(distinct ${dia})::text dias
   from messages where channel='whatsapp' and ${ventana}`,
);

const dias = Number(base.dias) || 1;
const botDia = Number(base.bot) / dias;
const humanoDia = Number(base.humano) / dias;
const salenDia = botDia + humanoDia;

const usd = (n: number) => '$' + n.toFixed(2);
const num = (n: number) => Math.round(n).toLocaleString('es-AR');

console.log(`\n  ═══ LO QUE MANDAMOS HOY (promedio de ${dias} días) ═══\n`);
console.log(`  del bot              ${num(botDia).padStart(7)} por día    ${num(botDia * 30).padStart(8)} por mes`);
console.log(`  de las chicas        ${num(humanoDia).padStart(7)} por día    ${num(humanoDia * 30).padStart(8)} por mes`);
console.log(`  ${''.padEnd(21)}${'───────'.padStart(7)}              ${'────────'.padStart(8)}`);
console.log(`  total saliente       ${num(salenDia).padStart(7)} por día    ${num(salenDia * 30).padStart(8)} por mes`);

const porMes = salenDia * 30;
const cobrables = Math.max(0, porMes - GRATIS_POR_MES);
const cuenta = cobrables * TARIFA;

console.log(`\n  ═══ LA FACTURA NUEVA (tarifa ${usd(TARIFA)} por mensaje) ═══\n`);
console.log(`  mensajes al mes                 ${num(porMes).padStart(8)}`);
console.log(`  menos los ${GRATIS_POR_MES} gratis            ${('-' + num(GRATIS_POR_MES)).padStart(8)}`);
console.log(`  se cobran                       ${num(cobrables).padStart(8)}`);
console.log(`  ${''.padEnd(32)}${'────────'.padStart(8)}`);
console.log(`  POR MES                         ${usd(cuenta).padStart(8)}`);
console.log(`  de eso, del bot                 ${usd(Math.max(0, botDia * 30 - GRATIS_POR_MES) * TARIFA).padStart(8)}`);
console.log(`  de eso, de las chicas           ${usd(humanoDia * 30 * TARIFA).padStart(8)}`);

/*
  LO QUE SE PUEDE RECORTAR SIN PERDER NADA: las respuestas partidas en varias
  burbujas. Hasta ahora eran gratis y hacían que el bot se leyera más humano;
  desde octubre cada burbuja extra es un cobro más.
*/
const [part] = await q<{ total: string; respuestas: string }>(
  `with m as (
     select conversation_id c, created_at, direction,
            lag(created_at) over (partition by conversation_id order by created_at) antes,
            lag(direction) over (partition by conversation_id order by created_at) dir_antes
       from messages where channel='whatsapp' and ${ventana}),
   marcado as (
     select *, case when direction='out' and dir_antes='out'
                     and created_at - antes < interval '90 seconds' then 0 else 1 end nueva
       from m where direction='out'),
   grupos as (select c, sum(nueva) over (partition by c order by created_at) g from marcado),
   tam as (select c, g, count(*) burbujas from grupos group by 1,2)
   select sum(burbujas)::text total, count(*)::text respuestas from tam`,
);

const extra = Number(part.total) - Number(part.respuestas);
const pctExtra = extra / Number(part.total);

console.log(`\n  ═══ LO QUE SE PUEDE RECORTAR ═══\n`);
console.log(
  `  ${num(Number(part.total))} mensajes salieron en ${num(Number(part.respuestas))} respuestas: ` +
    `${num(extra)} son burbujas extra (${(pctExtra * 100).toFixed(1)}%)`,
);
console.log(
  `  juntarlas en una sola burbuja ahorraría ${usd(cuenta * pctExtra)} por mes ` +
    `(quedaría en ${usd(cuenta * (1 - pctExtra))})`,
);

console.log(`\n  ═══ EN CONTEXTO ═══\n`);
const [gasto] = await q<{ c: string }>(
  `select coalesce(sum(cost_usd),0)::text c from model_turns
    where created_at > now() - interval '${DIAS} days'`,
);
const modeloMes = (Number(gasto.c) / DIAS) * 30;
console.log(`  el modelo (tokens) hoy        ${usd(modeloMes).padStart(8)} por mes`);
console.log(`  WhatsApp desde octubre        ${usd(cuenta).padStart(8)} por mes`);
console.log(`  ${''.padEnd(30)}${'────────'.padStart(8)}`);
console.log(`  variable total                ${usd(modeloMes + cuenta).padStart(8)} por mes`);
console.log(`  el aumento es del ${((cuenta / modeloMes) * 100).toFixed(0)}% sobre lo variable de hoy\n`);

const [pedidos] = await q<{ n: string }>(
  `select count(*)::text n from orders where created_at > now() - interval '${DIAS} days'
     and status <> 'cancelado'`,
);
const pedidosMes = (Number(pedidos.n) / DIAS) * 30;
console.log(`  ${num(pedidosMes)} pedidos por mes → ${usd(cuenta / pedidosMes)} de WhatsApp por pedido\n`);

await closeDb();
