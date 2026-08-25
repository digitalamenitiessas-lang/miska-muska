import { useEffect, useState } from 'react';
import { api, type ChannelHealth, type ChannelId, type Settings } from '../api';
import { CHANNEL_LABEL, Empty, Pill, Switch } from '../ui';

/**
 * Slugs de OpenRouter. Se puede escribir cualquier otro a mano: la lista completa
 * está en openrouter.ai/models. Los precios son por millón de tokens
 * (entrada/salida) al momento de escribir esto.
 */
const MODELS = [
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5 — $2/$10 · recomendado' },
  { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5 — $5/$25 · el más capaz' },
  { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5 — $1/$5 · rápido' },
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite — $0.10/$0.40 · el más barato' },
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B — $0.04/$0.17 · abierto' },
  { id: 'deepseek/deepseek-v3.2', label: 'DeepSeek v3.2 — $0.27/$0.40' },
];

const EFFORTS = [
  { id: 'none', label: 'sin razonamiento — lo más rápido y barato' },
  { id: 'minimal', label: 'mínimo' },
  { id: 'low', label: 'bajo — respuestas rápidas y baratas' },
  { id: 'medium', label: 'medio — recomendado para atención' },
  { id: 'high', label: 'alto — piensa más, cuesta más' },
  { id: 'xhigh', label: 'muy alto' },
  { id: 'max', label: 'máximo' },
];

export function Ajustes({
  settings,
  channels,
  onSaved,
  toast,
}: {
  settings: Settings | null;
  channels: ChannelHealth[];
  onSaved: (next: Settings) => void;
  toast: (text: string) => void;
}) {
  const [draft, setDraft] = useState<Settings | null>(settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(settings), [settings]);

  if (!draft) return <Empty glyph="⚙️">Cargando ajustes…</Empty>;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft({ ...draft, [key]: value });

  const toggleChannel = (channel: ChannelId, on: boolean) => {
    const next = on
      ? [...new Set([...draft.activeChannels, channel])]
      : draft.activeChannels.filter((c) => c !== channel);
    set('activeChannels', next);
  };

  const save = async () => {
    setSaving(true);
    try {
      onSaved(await api.saveSettings(draft));
    } catch (err) {
      toast(`No pude guardar: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <div className="col" style={{ gap: 16, maxWidth: 940 }}>
      <section className="card">
        <div className="card-pad">
          <h3 className="card-title">Canales</h3>
          <p className="small muted" style={{ marginTop: -6 }}>
            Un canal responde solo si tiene credenciales en el <code>.env</code> <em>y</em> está
            activado acá. Así se puede tener WhatsApp conectado pero todavía apagado.
          </p>
          {channels.map((channel) => (
            <div
              key={channel.channel}
              className="row wrap"
              style={{ gap: 10, padding: '9px 0', borderTop: '1px solid var(--line)' }}
            >
              <i className={`dot ${!channel.configured ? 'dot-off' : channel.ok ? 'dot-ok' : 'dot-bad'}`} />
              <strong style={{ minWidth: 92 }}>{CHANNEL_LABEL[channel.channel]}</strong>
              <Pill tone={channel.configured ? (channel.ok ? 'ok' : 'danger') : 'grey'}>
                {channel.configured ? (channel.ok ? 'conectado' : 'con error') : 'sin credenciales'}
              </Pill>
              <span className="small muted grow truncate">{channel.detail ?? ''}</span>
              <Switch
                checked={draft.activeChannels.includes(channel.channel)}
                disabled={!channel.configured}
                onChange={(on) => toggleChannel(channel.channel, on)}
                label="el bot atiende acá"
              />
            </div>
          ))}
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-pad">
            <h3 className="card-title">Modelo (OpenRouter)</h3>
            <label className="label">Modelo</label>
            <select
              value={MODELS.some((m) => m.id === draft.model) ? draft.model : '__custom'}
              onChange={(e) => {
                if (e.target.value !== '__custom') set('model', e.target.value);
              }}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
              <option value="__custom">otro (escribilo abajo)</option>
            </select>
            <input
              type="text"
              style={{ marginTop: 6 }}
              value={draft.model}
              placeholder="anthropic/claude-sonnet-5"
              onChange={(e) => set('model', e.target.value.trim())}
            />
            <p className="small muted" style={{ margin: '3px 0 0' }}>
              Cualquier slug de <code>openrouter.ai/models</code> que soporte herramientas. El bot
              guarda el costo real de cada turno, así que podés comparar modelos en Métricas.
            </p>

            <label className="label" style={{ marginTop: 10 }}>Esfuerzo de razonamiento</label>
            <select value={draft.effort} onChange={(e) => set('effort', e.target.value)}>
              {EFFORTS.map((e) => (
                <option key={e.id} value={e.id}>{e.label}</option>
              ))}
            </select>
            <p className="small muted" style={{ margin: '3px 0 0' }}>
              Si el modelo elegido no soporta razonamiento, OpenRouter descarta el parámetro.
            </p>

            <label className="label" style={{ marginTop: 10 }}>
              Escalar a una persona después de N errores seguidos
            </label>
            <input
              type="number"
              min={1}
              max={5}
              value={draft.escalateAfterErrors}
              onChange={(e) => set('escalateAfterErrors', Number(e.target.value))}
            />
          </div>
        </section>

        <section className="card">
          <div className="card-pad">
            <h3 className="card-title">Cómo escribe</h3>
            <label className="label">Se presenta como</label>
            <input
              type="text"
              value={draft.agentName}
              onChange={(e) => set('agentName', e.target.value)}
            />

            <label className="label" style={{ marginTop: 10 }}>
              Velocidad de tipeo simulada ({draft.typingMsPerChar} ms por carácter)
            </label>
            <input
              type="range"
              min={0}
              max={60}
              value={draft.typingMsPerChar}
              onChange={(e) => set('typingMsPerChar', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <p className="small muted" style={{ margin: '2px 0 0' }}>
              El bot espera antes de mandar cada mensaje, como si lo estuviera escribiendo. En 0
              responde al instante y se nota que es un bot.
            </p>

            <label className="label" style={{ marginTop: 10 }}>
              Espera máxima ({(draft.maxTypingMs / 1000).toFixed(1)} s)
            </label>
            <input
              type="range"
              min={500}
              max={8000}
              step={100}
              value={draft.maxTypingMs}
              onChange={(e) => set('maxTypingMs', Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-pad">
          <h3 className="card-title">Datos que el bot cita textualmente</h3>
          <p className="small muted" style={{ marginTop: -6 }}>
            Si algo de acá cambia, el bot lo dice bien en el próximo mensaje. No hay que tocar código.
          </p>
          <div className="grid-2" style={{ gap: 12 }}>
            <Field label="Dirección del local" value={draft.address} onChange={(v) => set('address', v)} />
            <Field label="Alias de transferencia" value={draft.transferAlias} onChange={(v) => set('transferAlias', v)} />
            <Field label="Titular / Mercado Pago" value={draft.transferHolder} onChange={(v) => set('transferHolder', v)} />
            <Field label="Tienda online" value={draft.webUrl} onChange={(v) => set('webUrl', v)} />
            <Field label="Página de cursos" value={draft.coursesUrl} onChange={(v) => set('coursesUrl', v)} />
            <Field label="Categoría desayunos" value={draft.breakfastsUrl} onChange={(v) => set('breakfastsUrl', v)} />
          </div>
          <label className="label" style={{ marginTop: 12 }}>
            Horario, tal cual lo cuenta el bot
          </label>
          <textarea
            rows={3}
            value={draft.scheduleText}
            onChange={(e) => set('scheduleText', e.target.value)}
            style={{ width: '100%' }}
          />
          <p className="small muted">
            Va en el prompt tal como lo escribas. Es texto libre porque el horario real no entra en
            dos números: es partido, cambia los domingos, y en el medio está el carrito.
          </p>
          {/* `wrap`: la aclaración de al lado es larga y en pantalla angosta
              empujaba la fila fuera de la tarjeta en vez de bajar de línea. */}
          <div className="row wrap" style={{ gap: 12, marginTop: 12 }}>
            <div>
              <label className="label">Abre</label>
              <input
                type="number"
                min={0}
                max={23}
                value={draft.openHour}
                onChange={(e) => set('openHour', Number(e.target.value))}
                style={{ width: 90 }}
              />
            </div>
            <div>
              <label className="label">Cierra</label>
              <input
                type="number"
                min={0}
                max={23}
                value={draft.closeHour}
                onChange={(e) => set('closeHour', Number(e.target.value))}
                style={{ width: 90 }}
              />
            </div>
            <span className="small muted" style={{ alignSelf: 'flex-end' }}>
              Fuera de horario el bot sigue atendiendo pero no promete entregas inmediatas.
            </span>
          </div>
        </div>
      </section>

      <div className="row" style={{ position: 'sticky', bottom: 0, padding: '10px 0' }}>
        <span className="grow" />
        {dirty ? <span className="small muted">Hay cambios sin guardar</span> : null}
        <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
