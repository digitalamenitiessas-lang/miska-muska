import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });

const casos = await q<any>(`
  with alias as (
    select m.conversation_id, m.id as msg_id, m.created_at,
           row_number() over (partition by m.conversation_id,
             (m.created_at at time zone 'America/Argentina/Tucuman')::date
             order by m.created_at) rn
    from messages m
    where m.direction='out' and m.author='bot' and lower(m.text) like '%miskapedidos%'
  )
  select a.conversation_id, a.created_at as alias_at, o.number, o.items, o.total
  from alias a
  join lateral (
    select * from orders o2
    where o2.conversation_id = a.conversation_id and o2.created_by='bot'
      and abs(extract(epoch from (o2.created_at - a.created_at))) < 3600
    order by abs(extract(epoch from (o2.created_at - a.created_at))) limit 1
  ) o on true
  where a.rn=1 and a.created_at > now() - interval '4 days'
  order by random() limit 20
`);

for (const c of casos) {
  const prev = await q<any>(
    `select direction, author, text, created_at from messages
     where conversation_id=$1 and created_at <= $2 and content_kind='text'
     order by created_at desc limit 6`,
    [c.conversation_id, c.alias_at],
  );
  console.log('\n==================== pedido #' + c.number + '  $' + c.total);
  console.log('REAL:', (c.items as any[]).map((i) => `${i.quantity}x ${i.description} @${i.unitPrice}${i.productId ? '' : ' [A MEDIDA]'}`).join(' | '));
  for (const m of prev.reverse()) {
    const quien = m.direction === 'in' ? 'CLIENTE' : m.author === 'human' ? 'PERSONA' : 'BOT    ';
    console.log(`  ${quien}: ${String(m.text).replace(/\n/g, ' ⏎ ').slice(0, 400)}`);
  }
}
await closeDb();
