import { openDb, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';
import { isOutsideBusinessHours } from '../src/core/policies/rules.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const s = await createRepositories().settings.read();

console.log(`\n  openHour : ${s.openHour}`);
console.log(`  closeHour: ${s.closeHour}`);
console.log(`  scheduleText:\n    ${(s.scheduleText ?? '').replace(/\n/g, '\n    ')}`);

/*
  El caso real: domingo 11 de octubre, 10:10 de Tucumán. El local abre a las 14
  los domingos. ¿El bot sabía que estaba cerrado?
*/
const domingoAlas10 = new Date('2026-10-11T13:10:00Z'); // 10:10 en Tucumán
const lunesAlas10 = new Date('2026-10-12T13:10:00Z');
console.log(`\n  ¿Fuera de horario el DOMINGO a las 10:10? ${isOutsideBusinessHours(s, domingoAlas10)}`);
console.log(`  ¿Fuera de horario el LUNES a las 10:10?   ${isOutsideBusinessHours(s, lunesAlas10)}`);

const f = s.conocimiento ?? '';
console.log('\n  Lo que dice la ficha de domingos y de costo de envío:\n');
for (const l of f.split('\n')) {
  if (/domingo|sin cargo|costo del env|cuesta el env|precio del env|envío se (cobra|abona)/i.test(l)) {
    console.log(`    ${l.trim().slice(0, 180)}`);
  }
}

await closeDb();
