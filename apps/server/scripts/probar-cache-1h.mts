/**
 * ¿OpenRouter pasa el TTL de una hora, o lo descarta en silencio?
 *
 * La documentación de OpenRouter dice que sí. Eso no alcanza: lo que hay que
 * saber es si llega hasta Anthropic POR NUESTRA RUTA y con NUESTRO modelo, y un
 * parámetro que el intermediario ignora no da error, simplemente no hace nada.
 *
 * El experimento tiene control, que es lo único que lo hace concluyente:
 *
 *   A) un prefijo con `ttl: '1h'`
 *   B) un prefijo idéntico en forma pero distinto en contenido, sin ttl (5 min)
 *
 * Se escriben los dos, se espera más de cinco minutos, y se leen los dos.
 *   - Si A lee de caché y B reescribe → el ttl viaja y funciona.
 *   - Si los dos reescriben          → OpenRouter lo descarta.
 *   - Si los dos leen                → algo más está cacheando y la prueba no
 *                                      distingue nada; no se concluye.
 *
 * Cuesta unos centavos: cuatro llamadas con un prefijo de ~6.000 fichas y
 * respuestas de una palabra.
 *
 *   npx tsx --env-file=../../.env.produccion scripts/probar-cache-1h.mts
 */

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error('  Falta OPENROUTER_API_KEY.');
  process.exit(1);
}
const BASE = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const MODELO = 'anthropic/claude-haiku-4.5';

/** El hueco. Más de cinco minutos, que es lo que dura el caché corto. */
const ESPERA_MS = 6.5 * 60 * 1000;

/**
 * Un prefijo largo y estable. Tiene que pasar el mínimo cacheable del modelo
 * (entre 1.024 y 4.096 fichas según el modelo), así que se apunta a ~6.000 para
 * no quedar corto por poco y que la prueba mida otra cosa.
 */
function prefijo(semilla: string): string {
  const parrafo =
    `Este es el texto ${semilla} de una prueba de caché. Se repite a propósito para ` +
    'ocupar un prefijo estable y suficientemente largo, que es lo único que el caché ' +
    'de prompts necesita para engancharse. No dice nada útil y no hace falta que lo diga. ';
  return parrafo.repeat(220);
}

interface Uso {
  prompt_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  cost?: number;
}

async function llamar(texto: string, conTtl: boolean): Promise<Uso> {
  const cacheControl = conTtl
    ? { type: 'ephemeral', ttl: '1h' }
    : { type: 'ephemeral' };

  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${API_KEY}`,
      'content-type': 'application/json',
      'X-Title': 'miska-muska prueba de cache',
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 4,
      usage: { include: true },
      messages: [
        {
          role: 'system',
          content: [{ type: 'text', text: texto, cache_control: cacheControl }],
        },
        { role: 'user', content: 'Contestá solo: ok' },
      ],
    }),
  });

  const cuerpo = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${cuerpo.slice(0, 300)}`);
  const json = JSON.parse(cuerpo) as { usage?: Uso; error?: unknown };
  if (json.error) throw new Error(`OpenRouter devolvió un error: ${JSON.stringify(json.error)}`);
  return json.usage ?? {};
}

const mostrar = (etiqueta: string, u: Uso): { leido: number; escrito: number } => {
  const leido = u.prompt_tokens_details?.cached_tokens ?? 0;
  const escrito = u.prompt_tokens_details?.cache_write_tokens ?? 0;
  console.log(
    `  ${etiqueta.padEnd(26)} entrada ${String(u.prompt_tokens ?? 0).padStart(6)} · ` +
      `leido de cache ${String(leido).padStart(6)} · escrito ${String(escrito).padStart(6)} · ` +
      `USD ${(u.cost ?? 0).toFixed(6)}`,
  );
  return { leido, escrito };
};

const textoA = prefijo('A-una-hora');
const textoB = prefijo('B-cinco-minutos');

console.log(`\n  Modelo: ${MODELO}`);
console.log(`  Prefijo: ~${Math.round(textoA.length / 4)} fichas estimadas\n`);

console.log('  --- Primera vuelta: se escriben los dos ---');
const a1 = mostrar('A (ttl 1h)', await llamar(textoA, true));
const b1 = mostrar('B (ttl por defecto)', await llamar(textoB, false));

if (!a1.escrito && !b1.escrito) {
  console.log('\n  Ninguno de los dos escribió caché. Sin escritura no hay nada que medir:');
  console.log('  o el prefijo quedó corto, o esta ruta no cachea. No se concluye nada.\n');
  process.exit(2);
}

console.log(`\n  Esperando ${(ESPERA_MS / 60000).toFixed(1)} minutos, que es más de lo que dura`);
console.log('  el caché corto. Si el ttl no viajó, los dos van a reescribir.\n');
await new Promise((r) => setTimeout(r, ESPERA_MS));

console.log('  --- Segunda vuelta: la que contesta la pregunta ---');
const a2 = mostrar('A (ttl 1h)', await llamar(textoA, true));
const b2 = mostrar('B (ttl por defecto)', await llamar(textoB, false));

const aLeyo = a2.leido > 0 && a2.escrito === 0;
const bReescribio = b2.escrito > 0;

console.log('\n  ----------------------------------------------------------');
if (aLeyo && bReescribio) {
  console.log('  EL TTL DE UNA HORA VIAJA Y FUNCIONA.');
  console.log('  A leyó de caché después del hueco; B, con el ttl por defecto,');
  console.log('  tuvo que reescribir. Es exactamente la diferencia que buscábamos.');
} else if (!aLeyo && bReescribio) {
  console.log('  OPENROUTER DESCARTA EL TTL.');
  console.log('  Los dos reescribieron: poner `ttl: 1h` no cambia nada por esta ruta.');
} else if (aLeyo && !bReescribio) {
  console.log('  NO CONCLUYENTE: los dos leyeron de caché.');
  console.log('  Algo mantuvo vivo también al de cinco minutos, así que esta prueba');
  console.log('  no distingue. Habría que repetirla con un hueco más largo.');
} else {
  console.log('  NO CONCLUYENTE: el resultado no encaja en ningún caso esperado.');
  console.log('  Mirá los números de arriba antes de decidir nada.');
}
console.log('  ----------------------------------------------------------\n');
