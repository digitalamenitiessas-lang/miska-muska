import { openDb, q, closeDb, TIMEZONE } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const repos = createRepositories();
console.log('  === lo que dice el contador del panel ===');
console.log('  ', JSON.stringify(await repos.conversations.contar()));
console.log('\n  === lo que trae el filtro de atencion ===');
const lista = await repos.conversations.list({ needsAttention: true, limit: 100 });
console.log(`  ${lista.length} charlas`);
for (const c of lista.slice(0, 8)) {
  const ct = await repos.contacts.get(c.contactId);
  console.log(`    ${(ct?.fullName || ct?.displayName || '?').slice(0,20).padEnd(21)} ${c.mode.padEnd(6)} ${String(c.attentionReason ?? '').slice(0,46)}`);
}
console.log('\n  === cuantas se apagaron hoy, y cuantas se dejaron de encender ===');
const ap = await q<{ n: number }>(
  `select count(*)::int n from conversations
   where attention_cleared_at > now() - interval '24 hours'`, []);
console.log(`  apagadas en 24 h: ${ap[0].n}`);
await closeDb();
