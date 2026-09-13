/**
 * El reglamento ocasional: que entre cuando hace falta y no cuando no.
 *
 * Cuatro temas —cursos, reservas, modificaciones y audios— pesan 12.385
 * caracteres juntos, una quinta parte de todo el reglamento, y el 81% de los
 * turnos no los toca nunca. Se separaron porque el modelo chico obedece peor
 * cuanto más carga, y hacerle leer cómo se toma una reserva de cumpleaños para
 * contestar cuánto sale una cookie le compite atención a todo lo demás.
 *
 * Los dos errores posibles no cuestan lo mismo:
 *   - incluirlo de más: se pierden unos 3.000 tokens de caché en ese turno.
 *   - NO incluirlo cuando hacía falta: el bot contesta mal una reserva.
 * Por eso el detector peca de generoso, y por eso acá se prueba sobre todo que
 * NO se le escape ninguno de los casos que sí lo necesitan.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-prosa-ocasional.mts
 */
import { openDb, q, closeDb } from '../src/core/store/db.js';
import {
  buildStablePrompt,
} from '../src/core/agent/persona.js';
import { necesitaLasOcasionales, POLICY_PROSE_OCASIONAL } from '../src/core/policies/rules.js';
import type { BotSettings } from '../src/core/types/domain.js';

type Caso = { nombre: string; mensajes: Array<{ text?: string | null; contentKind?: string | null }>; entra: boolean };

const CASOS: Caso[] = [
  // Tienen que entrar.
  { nombre: 'pregunta por un curso', mensajes: [{ text: 'hacen cursos de repostería?' }], entra: true },
  { nombre: 'pregunta por un taller', mensajes: [{ text: 'cuándo es el próximo taller?' }], entra: true },
  { nombre: 'quiere reservar un cumple', mensajes: [{ text: 'quiero reservar para un cumpleaños' }], entra: true },
  { nombre: 'mesa para tres', mensajes: [{ text: 'tienen mesa para 3 el sábado?' }], entra: true },
  { nombre: 'quiere cambiar el pedido', mensajes: [{ text: 'puedo cambiar la cookie por un brownie?' }], entra: true },
  { nombre: 'quiere cancelar', mensajes: [{ text: 'necesito cancelar el pedido' }], entra: true },
  { nombre: 'mandó un audio', mensajes: [{ contentKind: 'audio', text: null }], entra: true },
  {
    nombre: 'lo dijo al principio y después habló de otra cosa',
    mensajes: [{ text: 'quiero reservar un cumple' }, { text: 'y también dos cookies kinder' }],
    entra: true,
  },
  // NO tienen que entrar.
  { nombre: 'compra cookies', mensajes: [{ text: 'hola, tenés cookies kinder?' }], entra: false },
  { nombre: 'pregunta el precio', mensajes: [{ text: 'cuánto sale el box requete feliz?' }], entra: false },
  { nombre: 'pide envío', mensajes: [{ text: 'hacen envíos a Yerba Buena?' }], entra: false },
  { nombre: 'manda el comprobante', mensajes: [{ text: 'ahí te mando la transferencia' }], entra: false },
  { nombre: 'pregunta el horario', mensajes: [{ text: 'hasta qué hora están abiertos?' }], entra: false },
];

let mal = 0;
console.log('\n  Cuándo entran las reglas ocasionales\n');
for (const c of CASOS) {
  const r = necesitaLasOcasionales(c.mensajes);
  const ok = r === c.entra;
  if (!ok) mal++;
  console.log(`  ${ok ? '✓' : '✗'} ${c.entra ? 'entra ' : 'no    '} ${c.nombre}`);
}

/* Y lo que hace que todo esto valga: que la corta sea un PREFIJO de la larga. */
const settings = { transferAlias: 'miskapedidos', transferHolder: 'Mathias' } as BotSettings;
const corta = buildStablePrompt(settings, [], [], false);
const larga = buildStablePrompt(settings, [], [], true);
const esPrefijo = larga.startsWith(corta);
if (!esPrefijo) mal++;
console.log(`\n  ${esPrefijo ? '✓' : '✗'} la versión corta es un prefijo exacto de la larga`);
console.log(`      corta ${corta.length.toLocaleString('es-AR')} · larga ${larga.length.toLocaleString('es-AR')} · diferencia ${(larga.length - corta.length).toLocaleString('es-AR')}`);
if (!esPrefijo) {
  console.log('      SIN ESTO el caché se parte en dos y se paga el prompt entero dos veces.');
}

const traeTodo = POLICY_PROSE_OCASIONAL.length > 12_000;
if (!traeTodo) mal++;
console.log(`  ${traeTodo ? '✓' : '✗'} el bloque ocasional trae los cuatro temas (${POLICY_PROSE_OCASIONAL.length.toLocaleString('es-AR')} caracteres)`);

/* Contra el corpus: cuántos turnos se llevarían cuál. */
openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});
const filas = await q<{ c: string; text: string | null; kind: string | null }>(
  `select conversation_id c, text, content_kind kind from messages
   where created_at > now() - interval '7 days' order by created_at asc`,
);
const porCharla = new Map<string, Array<{ text?: string | null; contentKind?: string | null }>>();
for (const f of filas) {
  if (!porCharla.has(f.c)) porCharla.set(f.c, []);
  porCharla.get(f.c)!.push({ text: f.text, contentKind: f.kind });
}
let con = 0;
for (const [, ms] of porCharla) if (necesitaLasOcasionales(ms)) con++;
const total = porCharla.size;
console.log(`\n  Corpus: ${total} charlas de 7 días · ${con} se llevan las ocasionales (${Math.round((con / total) * 100)}%)`);
console.log(`  ${total - con} charlas (${Math.round(((total - con) / total) * 100)}%) ahorran ${(larga.length - corta.length).toLocaleString('es-AR')} caracteres por turno`);

console.log(mal ? `\n  ${mal} casos fallaron.\n` : '\n  Los casos pasan todos.\n');
await closeDb();
process.exit(mal ? 1 : 0);
