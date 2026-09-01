/**
 * El cerebro: un turno de conversación vía OpenRouter, con uso de herramientas.
 *
 * OpenRouter habla el dialecto de OpenAI (`/chat/completions`) para todos los
 * modelos que rutea, así que este archivo no depende de ningún SDK: es `fetch`
 * contra un endpoint. Cambiar de `anthropic/claude-sonnet-5` a `openai/gpt-...`
 * o a `google/gemini-...` es cambiar un string en el panel.
 *
 * Decisiones y por qué:
 *
 * - Bucle manual de herramientas. Necesito acumular métricas por turno (tokens,
 *   costo real, latencia) y recolectar los "efectos" de las herramientas
 *   (escaló, creó pedido) para que el pipeline los aplique después.
 *
 * - Los DOS mensajes de sistema van al principio, el estable primero. El estable
 *   (personalidad, forma y reglas, ~4900 tokens) lleva `cache_control` y se lee de caché
 *   en cada turno. El volátil (fecha, disponibilidad de hoy) va inmediatamente
 *   después: cambia siempre, así que invalida lo que venga detrás, pero no lo que
 *   está delante. Podría ganar algo más de caché poniéndolo al final de la
 *   conversación, pero eso depende de cómo cada proveedor traduzca un `system` a
 *   mitad del array, y acá se rutean 367 modelos distintos. La corrección vale
 *   más que ese ahorro marginal.
 *
 * - `reasoning.effort` en vez de apagar el razonamiento. Si un modelo no lo
 *   soporta, OpenRouter lo descarta; y si además lo rechaza, se desactiva solo.
 */

import { config } from '../../config.js';
import { log } from '../events/bus.js';
import { normalizeBubbles } from '../policies/writing.js';
import type { BotSettings, StoredMessage } from '../types/domain.js';
import { buildDailyContext, buildStablePrompt, SPLIT_MARKER, type DailyContextInput } from './persona.js';
import { executeTool, TOOL_DEFINITIONS, type ToolContext } from './tools.js';

const MAX_TOOL_ROUNDS = 6;
const MAX_TOKENS = 2048;
/** Un turno de chat no debería tardar más que esto ni en el peor caso. */
const REQUEST_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Forma de la API (compatible con OpenAI)
// ---------------------------------------------------------------------------

interface TextPart {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | TextPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface Choice {
  finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error' | null;
  native_finish_reason?: string;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: ToolCall[];
    refusal?: string | null;
    reasoning?: string | null;
  };
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

interface Completion {
  id?: string;
  model?: string;
  choices?: Choice[];
  usage?: Usage;
  error?: { message?: string; code?: number | string; metadata?: unknown };
}

// ---------------------------------------------------------------------------

export interface BrainTurn {
  /** Burbujas de texto a enviar, ya separadas. */
  bubbles: string[];
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Costo real en dólares que informa OpenRouter. */
  costUsd: number;
  /** Modelo que efectivamente respondió (OpenRouter puede haber ruteado a otro). */
  model: string | null;
  toolCalls: Array<{ name: string; input: unknown; ok: boolean }>;
  /** Etiqueta para analítica: la última herramienta relevante, o 'chat'. */
  intent: string;
  refused: boolean;
  error?: string;
}

/** Se apaga solo si el modelo elegido rechaza el parámetro `reasoning`. */
let reasoningEnabled = true;

/** Solo los modelos de Anthropic aprovechan `cache_control` explícito. */
function supportsExplicitCaching(model: string): boolean {
  return model.startsWith('anthropic/');
}

/** Convierte el historial guardado en turnos de la API. */
function toApiMessages(history: StoredMessage[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const m of history) {
    if (m.author === 'system' || m.contentKind === 'typing') continue;
    const role = m.direction === 'in' ? 'user' : 'assistant';
    const text = m.text.trim();
    if (!text) continue;
    const prefix = m.direction === 'out' && m.author === 'human' ? '[operador del local] ' : '';
    const last = messages.at(-1);
    if (last?.role === role && typeof last.content === 'string') {
      // Unir turnos consecutivos del mismo rol deja el historial más limpio y
      // ahorra tokens. Algunos proveedores además rechazan roles repetidos.
      last.content = `${last.content}\n${prefix}${text}`;
    } else {
      messages.push({ role, content: `${prefix}${text}` });
    }
  }
  while (messages.length && messages[0].role !== 'user') messages.shift();
  return messages;
}

function splitBubbles(text: string): string[] {
  return text
    .split(SPLIT_MARKER)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3);
}

/** Los modelos a veces devuelven JSON inválido en los argumentos. */
function parseArguments(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw?.trim()) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, unknown> };
    }
    return { ok: false, error: 'Los argumentos no son un objeto JSON.' };
  } catch (err) {
    return { ok: false, error: `Argumentos con JSON inválido: ${(err as Error).message}` };
  }
}

export interface RunTurnInput {
  settings: BotSettings;
  history: StoredMessage[];
  dailyContext: DailyContextInput;
  toolContext: ToolContext;
}

export async function runTurn(input: RunTurnInput): Promise<BrainTurn> {
  const started = Date.now();
  const turn: BrainTurn = {
    bubbles: [],
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    model: null,
    toolCalls: [],
    intent: 'chat',
    refused: false,
  };

  const { settings, history, dailyContext, toolContext } = input;
  const model = settings.model || config.openrouter.model;

  if (config.dryRun || !config.openrouter.apiKey) {
    turn.bubbles = [
      'Estoy en modo prueba (sin OPENROUTER_API_KEY), así que no puedo pensar la respuesta ' +
        'todavía. Configurá la clave y volvé a escribirme 🙌🏼',
    ];
    turn.latencyMs = Date.now() - started;
    turn.intent = 'dry-run';
    return turn;
  }

  const conversation = toApiMessages(history);
  if (!conversation.length) {
    turn.error = 'No hay historial para responder.';
    return turn;
  }

  const stable: TextPart = { type: 'text', text: buildStablePrompt(settings) };
  if (supportsExplicitCaching(model)) stable.cache_control = { type: 'ephemeral' };

  const messages: ChatMessage[] = [
    { role: 'system', content: [stable] },
    { role: 'system', content: buildDailyContext(dailyContext) },
    ...conversation,
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let completion: Completion;
    try {
      completion = await callOpenRouter({ model, messages, settings });
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      log('error', 'Falló la llamada a OpenRouter', message);
      turn.error = message;
      turn.latencyMs = Date.now() - started;
      return turn;
    }

    const usage = completion.usage ?? {};
    turn.inputTokens += usage.prompt_tokens ?? 0;
    turn.outputTokens += usage.completion_tokens ?? 0;
    turn.cacheReadTokens += usage.prompt_tokens_details?.cached_tokens ?? 0;
    turn.costUsd += usage.cost ?? 0;
    turn.model = completion.model ?? model;

    if (completion.error) {
      turn.error = `OpenRouter: ${completion.error.message ?? 'error sin detalle'}`;
      turn.latencyMs = Date.now() - started;
      return turn;
    }

    const choice = completion.choices?.[0];
    if (!choice) {
      turn.error = 'OpenRouter devolvió una respuesta sin opciones.';
      turn.latencyMs = Date.now() - started;
      return turn;
    }

    // Verificar el motivo de corte ANTES de leer el contenido.
    if (choice.finish_reason === 'content_filter' || choice.message.refusal) {
      turn.refused = true;
      turn.error = choice.message.refusal ?? 'El modelo declinó la solicitud.';
      turn.latencyMs = Date.now() - started;
      return turn;
    }
    if (choice.finish_reason === 'error') {
      turn.error = `El proveedor cortó el turno (${choice.native_finish_reason ?? 'error'}).`;
      turn.latencyMs = Date.now() - started;
      return turn;
    }

    const toolCalls = choice.message.tool_calls ?? [];

    if (!toolCalls.length) {
      const text = choice.message.content?.trim() ?? '';
      // Embudo único del texto que escribe el modelo. No se engancha en
      // `egress.deliver()` porque por ahí también pasa lo que tipea una persona
      // del local, y corregirle la escritura a un operador sería un bug.
      const normalized = normalizeBubbles(splitBubbles(text));
      turn.bubbles = normalized.bubbles;
      if (normalized.fixes.length) {
        // Si esto aparece seguido, el prompt no está alcanzando. Es información
        // que hoy no existía en ningún lado.
        log('info', 'La guarda de escritura corrigió el turno', normalized.fixes);
      }
      if (!turn.bubbles.length) {
        turn.error =
          choice.finish_reason === 'length'
            ? 'La respuesta se cortó por límite de tokens.'
            : 'El modelo respondió vacío.';
      }
      turn.latencyMs = Date.now() - started;
      return turn;
    }

    // Hay herramientas: se ejecutan todas y cada resultado vuelve como un
    // mensaje `role: "tool"` con su tool_call_id.
    messages.push({
      role: 'assistant',
      content: choice.message.content ?? null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const parsed = parseArguments(call.function.arguments);
      if (!parsed.ok) {
        turn.toolCalls.push({ name: call.function.name, input: call.function.arguments, ok: false });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: `${parsed.error} Volvé a llamar la herramienta con JSON válido.`,
        });
        continue;
      }
      const result = await executeTool(call.function.name, parsed.value, toolContext);
      turn.toolCalls.push({ name: call.function.name, input: parsed.value, ok: result.ok });
      turn.intent = call.function.name;
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: result.ok ? JSON.stringify(result.data) : `ERROR: ${result.error}`,
      });
    }
  }

  turn.error = `El modelo no cerró la respuesta después de ${MAX_TOOL_ROUNDS} rondas de herramientas.`;
  turn.latencyMs = Date.now() - started;
  return turn;
}

// ---------------------------------------------------------------------------
// Transporte
// ---------------------------------------------------------------------------

async function callOpenRouter(args: {
  model: string;
  messages: ChatMessage[];
  settings: BotSettings;
}): Promise<Completion> {
  const { model, messages, settings } = args;

  const body: Record<string, unknown> = {
    model,
    messages,
    tools: TOOL_DEFINITIONS,
    tool_choice: 'auto',
    max_tokens: MAX_TOKENS,
    // Sin esto, `usage.cost` no viene en la respuesta.
    usage: { include: true },
  };

  // Respaldos: si el principal falla o está saturado, OpenRouter prueba estos en
  // orden dentro de la misma llamada.
  if (config.openrouter.fallbackModels.length) {
    body.models = [model, ...config.openrouter.fallbackModels];
  }

  if (reasoningEnabled && settings.effort && settings.effort !== 'none') {
    body.reasoning = { effort: settings.effort };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${config.openrouter.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.openrouter.apiKey}`,
        'content-type': 'application/json',
        // Atribución del tráfico en los rankings de OpenRouter. Opcional.
        'HTTP-Referer': config.openrouter.appUrl,
        'X-Title': config.openrouter.appTitle,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let json: Completion;
    try {
      json = JSON.parse(text) as Completion;
    } catch {
      throw new Error(`Respuesta no-JSON de OpenRouter (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }

    if (!res.ok) {
      const detail = json.error?.message ?? text.slice(0, 300);
      // Algunos modelos rechazan `reasoning`. Se desactiva y se reintenta una vez.
      if (res.status === 400 && reasoningEnabled && /reasoning|effort/i.test(detail)) {
        reasoningEnabled = false;
        log('warn', `El modelo ${model} no acepta \`reasoning\`; sigo sin él.`, detail);
        clearTimeout(timer);
        return callOpenRouter(args);
      }

      /*
        "Provider returned error" no dice nada, y aparece setenta veces por día.

        Ese texto es de OpenRouter, no del proveedor: lo que de verdad pasó está
        en `error.metadata`, con el nombre del proveedor al que ruteó y su error
        crudo. Sin eso no hay forma de saber si es el largo del prompt, un tipo
        de mensaje puntual o un proveedor que está caído, y se termina
        adivinando.

        Va en una línea aparte y no pegado al mensaje del error porque ese
        mensaje viaja al panel y a la racha de fallos: acá interesa dejar rastro
        para leerlo después, no cambiar lo que ve nadie.
      */
      const meta = json.error?.metadata;
      if (meta) {
        const { provider_name: proveedor, raw } = meta as {
          provider_name?: string;
          raw?: unknown;
        };
        log(
          'error',
          `OpenRouter ${res.status} · modelo ${model} · proveedor ${proveedor ?? '?'} · ` +
            // El tamaño del pedido: si el prompt fuera el problema, se ve acá.
            `${Math.round(JSON.stringify(body).length / 1024)} KB en ${messages.length} mensajes · ` +
            `${typeof raw === 'string' ? raw.slice(0, 400) : JSON.stringify(raw ?? meta).slice(0, 400)}`,
        );
      }

      throw new Error(`OpenRouter HTTP ${res.status}: ${detail}`);
    }

    return json;
  } finally {
    clearTimeout(timer);
  }
}
