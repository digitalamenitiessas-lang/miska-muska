import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  openStream,
  apiBaseFaltante,
  getToken,
  setToken,
  type ChannelHealth,
  type Conversation,
  type Gasto,
  type LiveEvent,
  type Settings,
} from './api';
import { Pill, Switch, useToast } from './ui';
import { Inbox } from './views/Inbox';
import { Pedidos } from './views/Pedidos';
import { Catalogo } from './views/Catalogo';
import { Cursos } from './views/Cursos';
import { Campanas } from './views/Campanas';
import { Rapidos } from './views/Rapidos';
import { Metricas } from './views/Metricas';
import { Ajustes } from './views/Ajustes';

type View =
  | 'bandeja'
  | 'pedidos'
  | 'catalogo'
  | 'cursos'
  | 'campanas'
  | 'rapidos'
  | 'metricas'
  | 'ajustes';

const NAV: Array<{ id: View; label: string; glyph: string }> = [
  { id: 'bandeja', label: 'Bandeja', glyph: '💬' },
  { id: 'pedidos', label: 'Pedidos', glyph: '🧾' },
  { id: 'catalogo', label: 'Catálogo', glyph: '🍪' },
  { id: 'cursos', label: 'Cursos', glyph: '🎓' },
  { id: 'campanas', label: 'Campañas', glyph: '🎁' },
  { id: 'rapidos', label: 'Rápidos', glyph: '⚡' },
  { id: 'metricas', label: 'Métricas', glyph: '📈' },
  { id: 'ajustes', label: 'Ajustes', glyph: '⚙️' },
];

const TITLES: Record<View, string> = {
  bandeja: 'Bandeja de conversaciones',
  pedidos: 'Pedidos',
  catalogo: 'Catálogo y disponibilidad de hoy',
  cursos: 'Cursos e inscriptos',
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
  const [gasto, setGasto] = useState<Gasto | null>(null);
  const [authError, setAuthError] = useState(false);
  /** Se incrementa con cada evento del servidor: las vistas lo usan para refrescar. */
  const [tick, setTick] = useState(0);
  /*
    Contador aparte, solo para los eventos que tocan pedidos. Antes la vista de
    Pedidos recargaba con CUALQUIER evento, y un turno del bot emite ocho o diez
    (mensaje, conversación, tecleo, pedido, log…): eran ocho GET por turno, varios
    de ellos disparados ANTES de que el pedido existiera.

    Tiene que ser un contador y no "el último evento": React junta varias
    actualizaciones en un solo render, y el bot emite el evento del pedido y un log
    en la línea siguiente. Guardando el último, el del pedido queda tapado por el
    log y la recarga no pasa nunca — justo en el caso que importa.
  */
  const [orderTick, setOrderTick] = useState(0);
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null);
  const toast = useToast();

  const loadShell = useCallback(async () => {
    try {
      const [convs, cfg, gastado] = await Promise.all([
        api.conversations(),
        api.settings(),
        /*
          El gasto no puede tumbar el panel: si esta consulta falla, la barra de
          arriba se queda sin el número y todo lo demás sigue andando.
        */
        api.gasto().catch(() => null),
      ]);
      setConversations(convs);
      setSettings(cfg.settings);
      setChannels(cfg.channels);
      if (gastado) setGasto(gastado);
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
          // (Re)conexión: puede que se hayan cargado pedidos mientras no estábamos.
          setOrderTick((t) => t + 1);
          break;
        case 'order':
          setOrderTick((t) => t + 1);
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

  // Publicado sin saber a qué servidor hablarle: no tiene sentido mostrar la
  // bandeja vacía y que todo falle. Se dice qué falta y cómo arreglarlo.
  if (apiBaseFaltante) return <FaltaApiUrl />;

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
            <div className="card estado-bot">
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
          {gasto ? <Gastometro gasto={gasto} onVerMas={() => setView('metricas')} /> : null}
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
            {view === 'pedidos' ? <Pedidos tick={orderTick} toast={toast.show} /> : null}
            {view === 'catalogo' ? <Catalogo toast={toast.show} /> : null}
            {view === 'cursos' ? <Cursos toast={toast.show} /> : null}
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

/** El panel está publicado pero se construyó sin saber dónde vive el bot. */
/**
 * Lo que va gastando el bot en el modelo, siempre a la vista.
 *
 * Vive en la barra de arriba y no en Métricas porque el número que importa no
 * es el del cierre de mes: es el de hoy, mirado de reojo mientras se trabaja.
 * Enterrado en una pestaña, nadie lo ve hasta que llega la factura.
 *
 * Se muestra el del día, con el del mes al costado en chico. Tocarlo lleva a
 * Métricas, que es donde está el detalle por día y por conversación.
 */
function Gastometro({ gasto, onVerMas }: { gasto: Gasto; onVerMas: () => void }) {
  /*
    Cuatro decimales abajo de un centavo: una conversación cuesta fracciones de
    centavo, y "$0.00" todo el día no dice nada. Arriba de un centavo, dos, que
    es como se lee la plata.
  */
  const plata = (n: number) => (n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

  return (
    <button
      className="gastometro"
      onClick={onVerMas}
      title={`Hoy ${plata(gasto.hoy)} · Este mes ${plata(gasto.mes)} · Histórico ${plata(
        gasto.historico,
      )}\nEn dólares, lo que cobra OpenRouter por el modelo. Tocá para ver el detalle.`}
    >
      <span className="gastometro-label">Modelo hoy</span>
      <span className="gastometro-valor">{plata(gasto.hoy)}</span>
      <span className="gastometro-mes">mes {plata(gasto.mes)}</span>
    </button>
  );
}

function FaltaApiUrl() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 20 }}>
      <div className="card card-pad" style={{ maxWidth: 560 }}>
        <div className="brand-gate">
          <img src="/logo.png" alt="Miska Muska · Pastelería creativa" />
        </div>
        <h2 style={{ fontFamily: 'var(--font-brand)', fontSize: 18, margin: '0 0 10px' }}>
          Falta decirle al panel dónde está el bot
        </h2>
        <p className="small" style={{ marginTop: 0 }}>
          Este panel es solo la interfaz. Los datos los sirve el bot, que corre en otro lado
          (un VPS, Fly.io o Railway). Ahora mismo se construyó sin esa dirección, así que se
          está pidiendo la información a sí mismo.
        </p>

        <ol className="small" style={{ paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Asegurate de que el bot esté corriendo y accesible por HTTPS.</li>
          <li>
            En Vercel: <strong>Settings → Environment Variables</strong> →{' '}
            <code>VITE_API_URL = https://tu-bot.dominio.com</code>
          </li>
          <li>
            <strong>Volvé a desplegar.</strong> Vite incrusta las variables al construir, no las
            lee al ejecutar: si no redesplegás, el cambio no tiene efecto.
          </li>
          <li>
            En el bot: <code>DASHBOARD_ORIGIN</code> tiene que ser el dominio de este panel, o el
            navegador va a bloquear las llamadas por CORS.
          </li>
        </ol>

        <p className="small muted" style={{ marginBottom: 0 }}>
          El paso a paso completo está en <code>docs/DESPLIEGUE.md</code> del repositorio.
        </p>
      </div>
    </div>
  );
}

/** Pantalla mínima cuando el servidor pide ADMIN_TOKEN. */
function TokenGate({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState(getToken());
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 16 }}>
      <form
        className="card card-pad"
        /* Ancho fijo: en un teléfono de 320 px la tarjeta se pasaba de pantalla
           y aparecía scroll horizontal en la primera pantalla del panel. */
        style={{ width: 'min(340px, 100%)' }}
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
