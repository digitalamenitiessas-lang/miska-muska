/** Configuración por variables de entorno. Un solo lugar lee `process.env`. */

const env = (key: string, fallback = ''): string => process.env[key]?.trim() || fallback;
const envNum = (key: string, fallback: number): number => {
  const raw = process.env[key];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

/** Orígenes permitidos para el panel, separados por coma. */
function parseOrigins(): string[] {
  const raw = env('DASHBOARD_ORIGIN', 'http://localhost:5173');
  return raw
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export const config = {
  port: envNum('PORT', 3001),
  host: env('HOST', '0.0.0.0'),
  /** Orígenes del panel, para CORS. En Vercel es otro dominio, así que importa. */
  dashboardOrigins: parseOrigins(),
  /** URL pública del servidor (para registrar webhooks). */
  publicUrl: env('PUBLIC_URL', ''),

  database: {
    /**
     * Cadena de conexión de Postgres. En Supabase usá la del POOLER en modo
     * session (no la de transaction, que no soporta prepared statements, ni la
     * conexión directa, que en proyectos nuevos es solo IPv6).
     */
    url: env('DATABASE_URL'),
    /**
     * Contraseña por separado, opcional pero recomendada con Supabase: las que
     * genera traen `%` y otros caracteres que dentro de una URL se interpretan
     * como escapes y rompen la conexión con errores que no dicen nada.
     * Si está definida, pisa la que traiga DATABASE_URL.
     */
    password: env('DATABASE_PASSWORD') || undefined,
    poolMax: envNum('DATABASE_POOL_MAX', 5),
    /** Se apaga solo para el Postgres local de desarrollo. */
    ssl: process.env.DATABASE_SSL ? env('DATABASE_SSL') !== '0' : undefined,
  },

  openrouter: {
    apiKey: env('OPENROUTER_API_KEY'),
    baseUrl: env('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
    /** Valor inicial; se puede cambiar desde el panel. */
    model: env('OPENROUTER_MODEL', 'anthropic/claude-sonnet-5'),
    /**
     * OpenRouter usa estos dos encabezados para atribuir el tráfico a tu app en
     * sus rankings. Son opcionales y no cambian el resultado.
     */
    appUrl: env('OPENROUTER_APP_URL', 'https://miskamuska.com.ar'),
    appTitle: env('OPENROUTER_APP_TITLE', 'Miska Muska Bot'),
    /**
     * Modelos de respaldo si el principal falla o está saturado. OpenRouter los
     * prueba en orden dentro de la misma llamada.
     */
    fallbackModels: env('OPENROUTER_FALLBACK_MODELS')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
  },

  telegram: {
    botToken: env('TELEGRAM_BOT_TOKEN'),
    /** 'polling' para desarrollo local, 'webhook' para producción. */
    mode: (env('TELEGRAM_MODE', 'polling') === 'webhook' ? 'webhook' : 'polling') as
      | 'polling'
      | 'webhook',
    /** Token secreto que Telegram devuelve en X-Telegram-Bot-Api-Secret-Token. */
    webhookSecret: env('TELEGRAM_WEBHOOK_SECRET'),
  },

  whatsapp: {
    accessToken: env('WHATSAPP_ACCESS_TOKEN'),
    phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
    verifyToken: env('WHATSAPP_VERIFY_TOKEN'),
    appSecret: env('WHATSAPP_APP_SECRET'),
    graphVersion: env('WHATSAPP_GRAPH_VERSION', 'v21.0'),
  },

  /** Token simple para proteger el panel y la API de gestión. */
  adminToken: env('ADMIN_TOKEN'),

  /** Si true, el bot no llama a OpenRouter: responde con un mensaje fijo. */
  dryRun: env('DRY_RUN') === '1',
} as const;

export function channelConfigured(channel: 'telegram' | 'whatsapp'): boolean {
  if (channel === 'telegram') return Boolean(config.telegram.botToken);
  return Boolean(config.whatsapp.accessToken && config.whatsapp.phoneNumberId);
}

/** true si el origen puede hablar con la API. */
export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  const clean = origin.replace(/\/$/, '');
  if (config.dashboardOrigins.includes(clean)) return true;
  // Cualquier puerto de localhost, para desarrollo.
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(clean);
}

/** Falla temprano y con un mensaje claro, en vez de a la primera consulta. */
export function assertConfig(): void {
  if (!config.database.url) {
    throw new Error(
      'Falta DATABASE_URL. En Supabase: Project Settings → Database → Connection string → ' +
        'usá la del pooler en modo "Session" (puerto 5432).',
    );
  }
}
