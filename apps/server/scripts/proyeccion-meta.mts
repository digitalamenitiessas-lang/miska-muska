/*
  LA PROYECCIÓN REAL DEL GASTO DE WHATSAPP.

  No sale de los dos días que lleva Meta cobrando, que son pocos y uno fue
  gratis entero. Sale de nuestro propio volumen, que tiene meses, calibrado
  contra Meta: el 1 de octubre Meta contó 1.164 entregados y nuestra base tiene
  1.164 salientes ese día. El mismo número, así que podemos proyectar con el
  nuestro.

  LA CUENTA:
    mensajes del mes  = salientes por día × días del mes
    gratis            = 1.000 del cupo de servicio
                      + los que llegan por un anuncio (72 h, no entran al cupo)
    se cobran         = el resto, a la tarifa publicada
*/
import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const TARIFA = 37.6798;
const CUPO_SERVICIO = 1000;
const DIAS_DEL_MES = 31;
/* Del 1 de octubre, el único día completo que Meta informó abierto por tipo. */
const PARTE_POR_ANUNCIO = 348 / 1164;

const dias = await q<any>(
  `SELECT to_char(created_at AT TIME ZONE $1,'YYYY-MM-DD') AS dia, count(*) AS n
     FROM messages
    WHERE direction='out' AND created_at > now() - interval '35 days'
    GROUP BY 1 ORDER BY 1`,
  [TIMEZONE],
);
/* El día de hoy está a la mitad: no entra en los promedios. */
const hoy = dias[dias.length - 1];
const completos = dias.slice(0, -1);

const ultimos = (n: number) => {
  const t = completos.slice(-n);
  return t.reduce((s, d) => s + Number(d.n), 0) / t.length;
};

console.log('\n  Salientes por día, los últimos catorce completos:\n');
for (const d of completos.slice(-14)) {
  const n = Number(d.n);
  console.log(`    ${d.dia}  ${String(n).padStart(5)}  ${'█'.repeat(Math.round(n / 40))}`);
}
console.log(`\n    hoy (incompleto)  ${hoy.dia}  ${hoy.n}`);

const escenarios: Array<[string, number]> = [
  ['los últimos 30 días', ultimos(30)],
  ['los últimos 7 días', ultimos(7)],
  ['el 1 de octubre, ya con la campaña', Number(completos[completos.length - 1].n)],
];

console.log('\n\n  PROYECCIÓN DEL MES\n');
console.log('  si el ritmo es…                        por día   del mes   gratis   se cobran        ARS');
console.log('  ' + '─'.repeat(92));
for (const [nombre, porDia] of escenarios) {
  const delMes = porDia * DIAS_DEL_MES;
  const porAnuncio = delMes * PARTE_POR_ANUNCIO;
  const gratis = porAnuncio + CUPO_SERVICIO;
  const cobran = Math.max(0, delMes - gratis);
  console.log(
    `  ${nombre.padEnd(36)} ${String(Math.round(porDia)).padStart(7)} ` +
      `${String(Math.round(delMes)).padStart(9)} ${String(Math.round(gratis)).padStart(8)} ` +
      `${String(Math.round(cobran)).padStart(10)}   ${Math.round(cobran * TARIFA).toLocaleString('es-AR').padStart(9)}`,
  );
}

/* Y si los de anuncio se cortaran, que es el peor caso razonable. */
console.log('\n  Y si dejaran de entrar por anuncio (peor caso):\n');
for (const [nombre, porDia] of escenarios) {
  const cobran = Math.max(0, porDia * DIAS_DEL_MES - CUPO_SERVICIO);
  console.log(`    ${nombre.padEnd(36)} ARS ${Math.round(cobran * TARIFA).toLocaleString('es-AR')}`);
}

console.log(`\n  Referencia: el informe que se le pasó a Agus decía ARS 1.063.324.\n`);

await closeDb();
