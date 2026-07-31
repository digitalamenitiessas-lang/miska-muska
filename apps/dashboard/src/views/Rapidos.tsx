import { useCallback, useEffect, useState } from 'react';
import { api, type QuickReply } from '../api';
import { Empty, Pill, Switch } from '../ui';

const PLACEHOLDERS = [
  ['{{agente}}', 'nombre con el que se presenta el bot'],
  ['{{direccion}}', 'dirección del local'],
  ['{{alias}}', 'alias para transferencias'],
  ['{{titular}}', 'titular de Mercado Pago'],
  ['{{linkWeb}}', 'tienda online'],
  ['{{linkCursos}}', 'página de cursos'],
  ['{{linkDesayunos}}', 'categoría desayunos'],
  ['{{cookiesHoy}}', 'lista de cookies disponibles hoy, con precio'],
  ['{{miniTortasHoy}}', 'lista de mini tortas disponibles hoy'],
  ['{{precioMiniTorta}}', 'precio actual de la mini torta'],
];

/**
 * Los mensajes rápidos son los textos que el equipo ya tenía pulidos en
 * WhatsApp. El bot los usa como base (herramienta `mensaje_rapido`) en vez de
 * redactar de cero, así los datos duros nunca se inventan.
 */
export function Rapidos({ toast }: { toast: (text: string) => void }) {
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<QuickReply | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.quickReplies());
    } catch (err) {
      toast(`No pude cargar: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (item: QuickReply) => {
    try {
      await api.saveQuickReply(item);
      await load();
      setEditing(null);
      toast('Mensaje guardado');
    } catch (err) {
      toast(`No pude guardar: ${String(err)}`);
    }
  };

  const remove = async (key: string) => {
    try {
      await api.deleteQuickReply(key);
      await load();
      toast('Mensaje borrado');
    } catch (err) {
      toast(`No pude borrar: ${String(err)}`);
    }
  };

  if (loading) return <Empty glyph="⏳">Cargando…</Empty>;

  return (
    <>
      <div className="row wrap" style={{ marginBottom: 14, gap: 10 }}>
        <span className="small muted grow">
          El bot los trae con la herramienta <code>mensaje_rapido</code> y puede sumar una línea
          empática arriba, pero no cambia los datos duros. Con <strong>auto</strong> encendido, un
          mensaje corto que matchee se responde sin pasar por el modelo.
        </span>
        <button
          className="btn btn-primary"
          onClick={() =>
            setEditing({ key: '', label: '', body: '', triggers: [], autoSend: false, usageCount: 0 })
          }
        >
          + Nuevo
        </button>
      </div>

      <div className="grid-2">
        {items.map((item) => (
          <section className="card" key={item.key}>
            <header className="row wrap" style={{ padding: '13px 15px 4px', gap: 8 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: 14.5 }}>{item.label}</h3>
                <code className="small muted">{item.key}</code>
              </div>
              <Pill tone={item.usageCount > 0 ? 'mint' : 'grey'}>{item.usageCount} usos</Pill>
              <Switch
                checked={item.autoSend}
                onChange={(next) => void save({ ...item, autoSend: next })}
                label="auto"
              />
            </header>
            <div className="card-pad" style={{ paddingTop: 6 }}>
              <pre
                className="small"
                style={{
                  whiteSpace: 'pre-wrap',
                  background: 'var(--cream)',
                  padding: '9px 11px',
                  borderRadius: 9,
                  margin: 0,
                  fontFamily: 'var(--font-body)',
                  maxHeight: 170,
                  overflow: 'auto',
                }}
              >
                {item.preview ?? item.body}
              </pre>
              <div className="row wrap" style={{ marginTop: 9, gap: 5 }}>
                {item.triggers.map((t) => (
                  <span key={t} className="pill pill-lav">{t}</span>
                ))}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn btn-sm" onClick={() => setEditing(item)}>Editar</button>
                <span className="grow" />
                <button className="btn btn-sm btn-ghost" onClick={() => void remove(item.key)}>
                  Borrar
                </button>
              </div>
            </div>
          </section>
        ))}
      </div>

      {editing ? (
        <Editor
          item={editing}
          isNew={!items.some((i) => i.key === editing.key)}
          onCancel={() => setEditing(null)}
          onSave={(next) => void save(next)}
        />
      ) : null}
    </>
  );
}

function Editor({
  item,
  isNew,
  onCancel,
  onSave,
}: {
  item: QuickReply;
  isNew: boolean;
  onCancel: () => void;
  onSave: (next: QuickReply) => void;
}) {
  const [draft, setDraft] = useState(item);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(63, 63, 63, 0.35)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        zIndex: 40,
      }}
      onClick={onCancel}
    >
      <div
        className="card card-pad"
        style={{ width: 'min(680px, 100%)', maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="card-title">{isNew ? 'Nuevo mensaje rápido' : `Editar ${draft.key}`}</h3>

        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <div className="grow">
            <label className="label">Clave (la usa el bot)</label>
            <input
              type="text"
              value={draft.key}
              disabled={!isNew}
              placeholder="ej. no-envio-tortas"
              onChange={(e) => setDraft({ ...draft, key: e.target.value.trim() })}
            />
          </div>
          <div className="grow">
            <label className="label">Nombre visible</label>
            <input
              type="text"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <label className="label">Texto</label>
          <textarea
            rows={9}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
        </div>

        <div style={{ marginTop: 10 }}>
          <label className="label">Disparadores (separados por coma)</label>
          <input
            type="text"
            value={draft.triggers.join(', ')}
            placeholder="uber, cadete, mando un uber"
            onChange={(e) =>
              setDraft({
                ...draft,
                triggers: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
              })
            }
          />
        </div>

        <div style={{ marginTop: 10 }}>
          <Switch
            checked={draft.autoSend}
            onChange={(next) => setDraft({ ...draft, autoSend: next })}
            label="Responder automáticamente sin pasar por el modelo (solo mensajes cortos)"
          />
        </div>

        <details style={{ marginTop: 12 }}>
          <summary className="small muted" style={{ cursor: 'pointer' }}>
            Variables disponibles
          </summary>
          <div className="col small" style={{ gap: 3, marginTop: 7 }}>
            {PLACEHOLDERS.map(([token, desc]) => (
              <div key={token} className="row" style={{ gap: 8 }}>
                <code style={{ minWidth: 168 }}>{token}</code>
                <span className="muted">{desc}</span>
              </div>
            ))}
          </div>
        </details>

        <div className="row" style={{ marginTop: 16 }}>
          <span className="grow" />
          <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
          <button
            className="btn btn-primary"
            disabled={!draft.key || !draft.body}
            onClick={() => onSave(draft)}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
