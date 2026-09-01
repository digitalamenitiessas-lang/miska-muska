/**
 * Carga el mensaje rápido de sorrentinos que escribió el local.
 *
 * El texto es de Agus, palabra por palabra. Los precios NO están escritos ahí:
 * salen del catálogo por {{sorrentinos}}, así que si mañana cambia un precio
 * desde el panel, el mensaje cambia solo. Un precio tipeado a mano en un
 * mensaje rápido es un precio que algún día va a estar viejo.
 *
 * OJO CON EL ORDEN: {{sorrentinos}} lo resuelve el servidor. Este mensaje NO se
 * puede cargar antes de desplegar el código, o el cliente recibe el texto con
 * "{{sorrentinos}}" a la vista.
 *
 *   npx tsx --env-file=.env scripts/cargar-rapido-sorrentinos.mts            (vista previa)
 *   npx tsx --env-file=.env scripts/cargar-rapido-sorrentinos.mts --aplicar  (lo carga)
 */

import { openDb, q, exec, closeDb } from '../src/core/store/db.js';
import { createRepositories } from '../src/core/store/repositories.js';
import { renderQuickReply } from '../src/core/agent/persona.js';

openDb({
  connectionString: process.env.DATABASE_URL!,
  password: process.env.DATABASE_PASSWORD,
  max: 2,
});

const CLAVE = 'sorrentinos';
const ETIQUETA = 'Sorrentinos (lista completa con precios)';
const DISPARADORES = ['sorrentinos', 'sorrentino', 'pastas', 'sorrentinos precio'];
const CUERPO =
  'Holaa!!☺️💞 Nuestros sorrentinos muuy miska muska vienen por docena congelados, tenemos de:\n' +
  '{{sorrentinos}}\n\n' +
  'Te gustaría alguno? 🤗';

const repos = createRepositories();
const [settings, products] = await Promise.all([repos.settings.read(), repos.products.list()]);

console.log('Así lo va a recibir la clienta:\n');
console.log('-------------------------------------------');
console.log(renderQuickReply(CUERPO, settings, products));
console.log('-------------------------------------------\n');

const existe = await q<{ key: string }>('SELECT key FROM quick_replies WHERE key = $1', [CLAVE]);
console.log(existe.length ? 'Ya existe: se va a REEMPLAZAR.' : 'No existe: se va a CREAR.');

if (!process.argv.includes('--aplicar')) {
  console.log('\nVista previa nada más. Para cargarlo de verdad: --aplicar');
  await closeDb();
  process.exit(0);
}

await exec(
  `INSERT INTO quick_replies (key, label, body, triggers, auto_send)
   VALUES ($1, $2, $3, $4::jsonb, false)
   ON CONFLICT (key) DO UPDATE
     SET label = EXCLUDED.label,
         body = EXCLUDED.body,
         triggers = EXCLUDED.triggers,
         updated_at = now()`,
  [CLAVE, ETIQUETA, CUERPO, JSON.stringify(DISPARADORES)],
);

const quedo = await q<{ body: string }>('SELECT body FROM quick_replies WHERE key = $1', [CLAVE]);
console.log(quedo[0]?.body === CUERPO ? '\nCargado y verificado.' : '\nAlgo salió mal, revisar.');

await closeDb();
