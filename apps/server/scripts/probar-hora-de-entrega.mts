import { primeraHora } from '../src/core/policies/rules.js';

const casos: Array<[string, number | null]> = [
  ['8:00 a 8:30', 8 * 60],
  ['a coordinar según recorrido del cadete', null],
  ['09:30', 9 * 60 + 30],
  ['08:30 a 09:00', 8 * 60 + 30],
  ['09:00 a 10:00', 9 * 60],
  ['16:00', 16 * 60],
  ['Para ahora', null],
  ['antes de las 12', 12 * 60],
  ['10:00 a 12:00', 10 * 60],
  ['8:00 a 12:00', 8 * 60],
  ['8:00 a 9:00', 8 * 60],
  ['8.30', 8 * 60 + 30],
  ['10', 10 * 60],
  ['11:30', 11 * 60 + 30],
  ['9:00 a 11:00', 9 * 60],
  ['14:30', 14 * 60 + 30],
  ['9:30 a 11:00', 9 * 60 + 30],
  ['8:30hs', 8 * 60 + 30],
  ['21:15 a 21:20', 21 * 60 + 15],
  ['después de las 18:00', 18 * 60],
  ['Nicolás (Av. Roca 455): 11 a 13hs · Brisa (Rotonda SOEME): 9 a 11hs', 11 * 60],
  ['Av. Roca 455', null],
  ['entre las 19 y las 21', 19 * 60],
  ['', null],
  ['a la tarde', null],
  ['13:30', 13 * 60 + 30],
  ['calle San Martín 1234', null],
  ['20hs', 20 * 60],
];

let mal = 0;
for (const [texto, esperado] of casos) {
  const dio = primeraHora(texto);
  const ok = dio === esperado;
  if (!ok) mal++;
  const fmt = (m: number | null) => (m === null ? 'null' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  console.log(`  ${ok ? 'ok  ' : 'MAL '} ${JSON.stringify(texto).slice(0, 62).padEnd(64)} ${fmt(dio).padEnd(6)} ${ok ? '' : '(esperaba ' + fmt(esperado) + ')'}`);
}
console.log(`\n  ${casos.length - mal}/${casos.length} bien`);
process.exit(mal ? 1 : 0);
