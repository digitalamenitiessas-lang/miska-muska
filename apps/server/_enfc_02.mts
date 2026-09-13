import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });

/*
  Base: cada vez que un mensaje SALIENTE nombra el alias de pedidos.
  Se agrupa por (conversacion, dia) = "una venta con alias".
*/
const filas = await q<any>(`
  with alias as (
    select m.conversation_id, m.id as msg_id, m.author, m.created_at,
           (m.created_at at time zone 'America/Argentina/Tucuman')::date as dia,
           row_number() over (partition by m.conversation_id,
             (m.created_at at time zone 'America/Argentina/Tucuman')::date
             order by m.created_at) as rn
    from messages m
    where m.direction = 'out' and lower(m.text) like '%miskapedidos%'
  )
  select a.dia, a.conversation_id, a.msg_id, a.author, a.created_at,
    (select count(*) from orders o
      where o.conversation_id = a.conversation_id
        and (o.created_at at time zone 'America/Argentina/Tucuman')::date = a.dia) as pedidos_ese_dia,
    (select string_agg(distinct o.created_by, ',') from orders o
      where o.conversation_id = a.conversation_id
        and (o.created_at at time zone 'America/Argentina/Tucuman')::date = a.dia) as quien
  from alias a
  where a.rn = 1
  order by a.dia, a.created_at
`);

const dias = new Map<string, any[]>();
for (const f of filas) {
  const d = String(f.dia).slice(0, 10);
  (dias.get(d) ?? dias.set(d, []).get(d)!).push(f);
}
console.log('dia        aliasBot aliasHum  conPedido  bot  humano  SIN NADA');
for (const [d, fs] of [...dias].sort()) {
  const bot = fs.filter((f) => f.author === 'bot').length;
  const hum = fs.length - bot;
  const con = fs.filter((f) => Number(f.pedidos_ese_dia) > 0).length;
  const porBot = fs.filter((f) => (f.quien ?? '').includes('bot')).length;
  const porHum = fs.filter((f) => (f.quien ?? '').includes('panel') || (f.quien ?? '').includes('human')).length;
  console.log(
    `${d}  ${String(bot).padStart(6)} ${String(hum).padStart(7)} ${String(con).padStart(9)} ` +
      `${String(porBot).padStart(5)} ${String(porHum).padStart(6)} ${String(fs.length - con).padStart(8)}`,
  );
}
const creadores = await q<any>(`select created_by, count(*) from orders group by 1`);
console.log('created_by:', JSON.stringify(creadores));
await closeDb();
