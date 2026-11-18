/**
 * "te late" no se usa: se traduce a "te gusta", igual que "te copa".
 * El 18 de noviembre el bot cerró tres charlas con "Cuál te late?".
 *
 *   npx tsx scripts/probar-te-late.mts
 */
import { normalizeWriting } from '../src/core/policies/writing.js';

const CASOS: Array<[string, string]> = [
  ['Cuál te late?', 'Cuál te gusta?'],
  ['cuál te late de las que hay?', 'cuál te gusta de las que hay?'],
  ['Te laten las de nutella?', 'Te gustan las de nutella?'],
  ['Te latería probar la nueva?', 'Te gustaría probar la nueva?'],
  ['Hoy hay latte de vainilla', 'Hoy hay latte de vainilla'],
  ['El late de la mañana', 'El late de la mañana'],
];
let mal = 0;
for (const [entra, sale] of CASOS) {
  const r = normalizeWriting(entra).text;
  const ok = r === sale;
  if (!ok) mal++;
  console.log(`${ok ? 'ok  ' : 'MAL '} "${entra}" -> "${r}"${ok ? '' : ` (esperaba "${sale}")`}`);
}
if (mal) process.exit(1);
console.log('\n  Pasa todo.');
