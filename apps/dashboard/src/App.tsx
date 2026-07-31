import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  openStream,
  getToken,
  setToken,
  type ChannelHealth,
  type Conversation,
  type LiveEvent,
  type Settings,
} from './api';
import { Pill, Switch, useToast } from './ui';
import { Inbox } from './views/Inbox';
import { Pedidos } from './views/Pedidos';
import { Catalogo } from './views/Catalogo';
import { Campanas } from './views/Campanas';
import { Rapidos } from './views/Rapidos';
import { Metricas } from './views/Metricas';
import { Ajustes } from './views/Ajustes';

type View = 'bandeja' | 'pedidos' | 'catalogo' | 'campanas' | 'rapidos' | 'metricas' | 'ajustes';

const NAV: Array<{ id: View; label: string; glyph: string }> = [
  { id: 'bandeja', label: 'Bandeja', glyph: '💬' },
  { id: 'pedidos', label: 'Pedidos', glyph: '🧾' },
  { id: 'catalogo', label: 'Catálogo', glyph: '🍪' },
  { id: 'campanas', label: 'Campañas', glyph: '🎁' },
  { id: 'rapidos', label: 'Rápidos', glyph: '⚡' },
  { id: 'metricas', label: 'Métricas', glyph: '📈' },
  { id: 'ajustes', label: 'Ajustes', glyph: '⚙️' },
];

const TITLES: Record<View, string> = {
  bandeja: 'Bandeja de conversaciones',
  pedidos: 'Pedidos',
  catalogo: 'Catálogo y disponibilidad de hoy',
  campanas: 'Campañas de fechas especiales',
  rapidos: 'Mensajes rápidos',
  metricas: 'Métricas',
  ajustes: 'Ajustes del bot',
};

export default function App() {
  const [view, setView] = useState<View>('bandeja');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [channels, setChannels] = useState<ChannelHealth[]>([]);
  const [connected, setConnected] = useState(false);
  const [authError, setAuthError] = useState(false);
  /** Se incrementa con cada evento del servidor: las vistas lo usan para refrescar. */
  const [tick, setTick] = useState(0);
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null);
  const toast = useToast();

  const loadShell = useCallback(async () => {
    try {
      const [convs, cfg] = await Promise.all([api.conversations(), api.settings()]);
      setConversations(convs);
      setSettings(cfg.settings);
      setChannels(cfg.channels);
      setAuthError(false);
    } catch (err) {
      if (String(err).includes('401')) setAuthError(true);
      else toast.show(`No pude cargar: ${String(err)}`);
    }
    // `toast.show` viene de un useCallback sin dependencias: es estable entre
    // renders, así que no hace falta listarlo acá.
  }, []);

  useEffect(() => {
    void loadShell();
  }, [loadShell]);

  // --- eventos en vivo ----------------------------------------------------
  const convRef = useRef<Conversation[]>([]);
  convRef.current = conversations;

  useEffect(() => {
    if (authError) return;
    const close = openStream((event) => {
      setLastEvent(event);
      switch (event.type) {
        case 'hello':
          setConnected(true);
          break;
        case 'conversation': {
          const incoming = event.conversation;
          const existing = convRef.current.find((c) => c.id === incoming.id);
          const merged: Conversation = { ...incoming, contact: existing?.contact };
          const rest = convRef.current.filter((c) => c.id !== incoming.id);
          setConversations([merged, ...rest]);
          // Un contacto nuevo llega sin ficha: se pide la lista completa una vez.
          if (!existing) void loadShell();
          break;
        }
        case 'channel-status':
          setChannels((prev) =>
            prev.map((c) =>
              c.channel === event.channel ? { ...c, ok: event.ok, detail: event.detail } : c,
            ),
          );
          break;
        default:
          break;
      }
      setTick((t) => t + 1);
    });
    return close;
  }, [authError, loadShell]);

  const attention = useMemo(
    () => conversations.filter((c) => c.needsAttention).length,
    [conversations],
  );
  const unread = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.unreadCount > 0 ? 1 : 0), 0),
    [conversations],
  );

  const toggleBot = async (next: boolean) => {
    if (!settings) return;
    setSettings({ ...settings, botEnabled: next });
    try {
      const saved = await api.saveSettings({ botEnabled: next });
      setSettings(saved);
      toast.show(next ? 'Bot encendido' : 'Bot apagado: nadie responde automáticamente');
    } catch (err) {
      setSettings(settings);
      toast.show(`No pude guardar: ${String(err)}`);
    }
  };

  if (authError) return <TokenGate onSaved={() => void loadShell()} />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="Miska Muska · Pastelería creativa" />
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              className="nav-item"
              aria-current={view === item.id}
              onClick={() => setView(item.id)}
            >
              <span className="glyph">{item.glyph}</span>
              <span>{item.label}</span>
              {item.id === 'bandeja' && unread > 0 ? (
                <span className="nav-badge">{unread}</span>
              ) : null}
              {item.id === 'bandeja' && attention > 0 && unread === 0 ? (
                <span className="nav-badge">!</span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          {settings ? (
            <div className="card card-pad" style={{ padding: '11px 12px' }}>
              <Switch
                checked={settings.botEnabled}
                onChange={(next) => void toggleBot(next)}
                label={settings.botEnabled ? 'Bot respondiendo' : 'Bot apagado'}
              />
            </div>
          ) : null}

          <div className="col small" style={{ gap: 5, padding: '0 4px' }}>
            {channels.map((c) => (
              <div key={c.channel} className="row" style={{ gap: 6 }}>
                <i
                  className={`dot ${!c.configured ? 'dot-off' : c.ok ? 'dot-ok' : 'dot-bad'}`}
                  title={c.detail ?? ''}
                />
                <span className="muted truncate" title={c.detail ?? ''}>
                  {c.channel}
                </span>
              </div>
            ))}
            <div className="row" style={{ gap: 6 }}>
              <i className={`dot ${connected ? 'dot-ok' : 'dot-off'}`} />
              <span className="muted">{connected ? 'en vivo' : 'sin stream'}</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{TITLES[view]}</h1>
          <span className="spacer" />
          {attention > 0 ? (
            <Pill tone="danger">{attention} necesita atención</Pill>
          ) : (
            <Pill tone="ok">todo al día</Pill>
          )}
          {settings && !settings.botEnabled ? <Pill tone="warn">bot apagado</Pill> : null}
        </header>

        {view === 'bandeja' ? (
          <Inbox
            conversations={conversations}
            lastEvent={lastEvent}
            tick={tick}
            onConversationsChanged={loadShell}
            toast={toast.show}
          />
        ) : (
          <div className="content">
            {view === 'pedidos' ? <Pedidos tick={tick} toast={toast.show} /> : null}
            {view === 'catalogo' ? <Catalogo toast={toast.show} /> : null}
            {view === 'campanas' ? <Campanas toast={toast.show} /> : null}
            {view === 'rapidos' ? <Rapidos toast={toast.show} /> : null}
            {view === 'metricas' ? <Metricas tick={tick} /> : null}
            {view === 'ajustes' ? (
              <Ajustes
                settings={settings}
                channels={channels}
                onSaved={(next) => {
                  setSettings(next);
                  toast.show('Ajustes guardados');
                }}
                toast={toast.show}
              />
            ) : null}
          </div>
        )}
      </main>

      {toast.node}
    </div>
  );
}

/** Pantalla mínima cuando el servidor pide ADMIN_TOKEN. */
function TokenGate({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState(getToken());
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
      <form
        className="card card-pad"
        style={{ width: 340 }}
        onSubmit={(e) => {
          e.preventDefault();
          setToken(value.trim());
          onSaved();
        }}
      >
        <div className="brand-gate">
          <img src="/logo.png" alt="Miska Muska · Pastelería creativa" />
        </div>
        <label className="label" htmlFor="token">
          Token del panel
        </label>
        <input
          id="token"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="ADMIN_TOKEN del .env"
          autoFocus
        />
        <button className="btn btn-primary" style={{ marginTop: 12, width: '100%' }} type="submit">
          Entrar
        </button>
      </form>
    </div>
  );
}
