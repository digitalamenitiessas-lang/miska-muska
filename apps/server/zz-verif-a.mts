import { openDb, q, closeDb, TIMEZONE } from './src/core/store/db.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const rango = await q<any>(
  `select min(created_at at time zone $1) as desde, max(created_at at time zone $1) as hasta, count(*) as n
   from messages`,
  [TIMEZONE],
);
console.log('RANGO TOTAL:', rango[0]);

const kinds = await q<any>(
  `select direction, author, content_kind, count(*) as n
   from messages
   where created_at >= now() - interval '14 days'
   group by 1,2,3 order by n desc`,
  [],
);
console.log('\nKINDS ultimos 14 dias:');
for (const k of kinds) console.log(` ${k.direction} / ${k.author} / ${k.content_kind} -> ${k.n}`);

const dias = await q<any>(
  `select (created_at at time zone $1)::date as dia, count(*) as n
   from messages
   where direction='out' and author='bot' and created_at >= now() - interval '14 days'
   group by 1 order by 1`,
  [TIMEZONE],
);
console.log('\nMENSAJES BOT POR DIA (14d):');
for (const d of dias) console.log(` ${d.dia.toISOString().slice(0, 10)}  ${d.n}`);
console.log(' TOTAL:', dias.reduce((a: number, d: any) => a + Number(d.n), 0));

await closeDb();
