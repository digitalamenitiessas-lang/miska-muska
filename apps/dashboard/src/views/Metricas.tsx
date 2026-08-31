import { useCallback, useEffect, useState } from 'react';
import { api, type Metrics } from '../api';
import { Empty } from '../ui';

/**
 * Paleta de los gráficos.
 *
 * Los pasteles de la marca (#a8d5d3 menta, #e6a4ad rosa) son colores de FONDO:
 * como marcas de datos fallan el piso de croma, el contraste contra el papel y
 * —lo más grave— la separación bajo daltonismo (teal vs rosa da ΔE 6.1 en
 * deuteranopia: dos barras indistinguibles).
 *
 * Estos dos son pasos profundos de las mismas familias de la carta (el teal de
 * la menta y la lavanda de "mini tortas"), y pasan las seis validaciones:
 *   banda de luminosidad ✓ · piso de croma ✓ · CVD ΔE 17.0 deuteranopia /
 *   14.3 tritanopia ✓ · piso de visión normal ΔE 25.3 ✓ · contraste ≥ 3:1 ✓
 * El pastel sigue usándose para superficies y pills, donde sí corresponde.
 */
const SERIES = {
  inbound: { color: '#009e94', label: 'Recibidos' },
  outbound: { color: '#8257d6', label: 'Enviados' },
} as const;

/** Un solo tono para magnitud: en un ranking el color no codifica identidad. */
const MAGNITUDE = '#009e94';

const INK = { primary: '#3f3f3f', secondary: '#8b8b8b', grid: '#efe4e6' };

/**
 * Cada cuánto se refresca sola la pantalla de métricas.
 *
 * Antes se refrescaba con el contador general de eventos del panel, o sea con
 * CUALQUIER cosa que pasara: un mensaje, el "escribiendo…" prendiéndose y
 * apagándose, cada línea de log del servidor. Un turno del bot son una docena
 * de eventos, y cada uno pedía /api/metrics entero — que por dentro recorre la
 * tabla de mensajes cinco veces sin filtro de fecha.
 *
 * Con una sola pestaña de Métricas abierta en la compu del mostrador, eso eran
 * cientos de consultas por minuto contra las cinco conexiones que comparte con
 * el bot que está contestando. Y para nada: nadie necesita que un gráfico de
 * catorce días se redibuje diez veces por segundo.
 */
const REFRESCO_MS = 30_000;

export function Metricas() {
  const [data, setData] = useState<Metrics | null>(null);
  const [days, setDays] = useState(14);
  const [showTable, setShowTable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.metrics(days));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [days]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESCO_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  if (error) return <Empty glyph="📈">No pude cargar las métricas: {error}</Empty>;
  if (!data) return <Empty glyph="⏳">Cargando métricas…</Empty>;

  const { summary, daily, intents, quickReplies } = data;
  const tokens = daily.reduce((sum, d) => sum + d.inputTokens + d.outputTokens, 0);
  const periodCost = daily.reduce((sum, d) => sum + d.costUsd, 0);
  const botShare =
    summary.conversations > 0
      ? Math.round(((summary.conversations - summary.humanMode) / summary.conversations) * 100)
      : 0;

  return (
    <>
      <div className="tiles">
        <Tile label="Conversaciones" value={String(summary.conversations)} />
        <Tile
          label="Resueltas por el bot"
          value={`${botShare}%`}
          note={`${summary.humanMode} pasaron a una persona`}
        />
        <Tile label="Mensajes recibidos" value={String(summary.inbound)} />
        <Tile label="Mensajes enviados" value={String(summary.outbound)} />
        <Tile
          label="Pedidos"
          value={String(summary.orders)}
          note={`${summary.draftOrders} sin comprobante`}
        />
        <Tile
          label="Demora media"
          value={summary.avgLatencyMs ? `${(summary.avgLatencyMs / 1000).toFixed(1)} s` : '—'}
          note="Lo que tarda el modelo en pensar"
        />
        <Tile
          label="Gasto del período"
          value={usd(periodCost)}
          note={`${tokens.toLocaleString('es-AR')} tokens · ${usd(summary.costUsd)} histórico`}
        />
        <Tile
          label="Costo por conversación"
          value={summary.conversations > 0 ? usd(summary.costUsd / summary.conversations) : '—'}
          note="Promedio histórico"
        />
        <Tile
          label="Errores de envío"
          value={String(summary.errors)}
          note={summary.errors > 0 ? 'Revisá la bandeja' : 'Sin problemas'}
        />
      </div>

      <div className="row wrap" style={{ marginBottom: 12, gap: 8 }}>
        {[7, 14, 30].map((d) => (
          <button key={d} className="chip" aria-pressed={days === d} onClick={() => setDays(d)}>
            {d} días
          </button>
        ))}
        <span className="grow" />
        <button className="chip" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Ver gráfico' : 'Ver tabla'}
        </button>
      </div>

      <section className="card" style={{ marginBottom: 14 }}>
        <div className="card-pad">
          <h3 className="card-title">Mensajes por día</h3>
          {daily.length === 0 ? (
            <Empty glyph="📭">Todavía no hay actividad para graficar.</Empty>
          ) : showTable ? (
            <DailyTable daily={daily} />
          ) : (
            <GroupedBars daily={daily} />
          )}
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-pad">
            <h3 className="card-title">Qué le preguntan al bot</h3>
            {intents.length === 0 ? (
              <p className="small muted">Sin datos todavía.</p>
            ) : (
              <RankedBars
                rows={intents.map((i) => ({ label: prettyIntent(i.intent), value: i.count }))}
              />
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-pad">
            <h3 className="card-title">Mensajes rápidos más usados</h3>
            {quickReplies.filter((q) => q.usageCount > 0).length === 0 ? (
              <p className="small muted">
                Ninguno se usó todavía. Aparecen acá cuando el bot o el equipo los envían.
              </p>
            ) : (
              <RankedBars
                rows={quickReplies
                  .filter((q) => q.usageCount > 0)
                  .slice(0, 8)
                  .map((q) => ({ label: q.label, value: q.usageCount }))}
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {note ? <div className="tile-note">{note}</div> : null}
    </div>
  );
}

/** Barras verticales agrupadas. Un solo eje: las dos series son mensajes. */
function GroupedBars({ daily }: { daily: Metrics['daily'] }) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  const W = 760;
  const H = 250;
  const PAD = { top: 16, right: 12, bottom: 30, left: 38 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const max = Math.max(1, ...daily.flatMap((d) => [d.inbound, d.outbound]));
  const ticks = niceTicks(max, 4);
  const scaleMax = ticks[ticks.length - 1];

  const groupW = plotW / daily.length;
  // 2px de superficie entre barras vecinas, como pide la especificación de marcas.
  const GAP = 2;
  const barW = Math.max(4, Math.min(18, (groupW - GAP) / 2 - 3));

  const y = (value: number) => PAD.top + plotH - (value / scaleMax) * plotH;

  return (
    <div style={{ position: 'relative' }}>
      {/* Leyenda: con dos series la identidad nunca queda solo en el color. */}
      <div className="row" style={{ gap: 14, marginBottom: 6 }}>
        {Object.values(SERIES).map((s) => (
          <span key={s.label} className="row small" style={{ gap: 6 }}>
            <i
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: s.color,
                display: 'inline-block',
              }}
            />
            <span style={{ color: INK.primary }}>{s.label}</span>
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
        role="img"
        aria-label={
          daily.length === 1
            ? 'Mensajes recibidos y enviados hoy'
            : `Mensajes recibidos y enviados por día, últimos ${daily.length} días`
        }
      >
        {/* Grilla recesiva */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke={INK.grid}
              strokeWidth={1}
            />
            <text x={PAD.left - 7} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={INK.secondary}>
              {t}
            </text>
          </g>
        ))}

        {daily.map((d, index) => {
          const cx = PAD.left + groupW * index + groupW / 2;
          const bars = [
            { key: 'inbound' as const, value: d.inbound, x: cx - barW - GAP / 2 },
            { key: 'outbound' as const, value: d.outbound, x: cx + GAP / 2 },
          ];
          // Con muchos días se etiqueta cada dos, para que no se pisen.
          const showLabel = daily.length <= 10 || index % 2 === 0;
          return (
            <g key={d.day}>
              {bars.map((bar) => (
                <path
                  key={bar.key}
                  d={barPath(bar.x, y(bar.value), barW, PAD.top + plotH - y(bar.value), 4)}
                  fill={SERIES[bar.key].color}
                  onMouseEnter={() =>
                    setHover({
                      x: bar.x + barW / 2,
                      y: y(bar.value),
                      text: `${formatDay(d.day)} · ${SERIES[bar.key].label}: ${bar.value}`,
                    })
                  }
                  onMouseLeave={() => setHover(null)}
                />
              ))}
              {showLabel ? (
                <text
                  x={cx}
                  y={H - PAD.bottom + 15}
                  textAnchor="middle"
                  fontSize={10}
                  fill={INK.secondary}
                >
                  {formatDay(d.day)}
                </text>
              ) : null}
            </g>
          );
        })}

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke={INK.grid}
          strokeWidth={1.5}
        />
      </svg>

      {hover ? (
        <div
          style={{
            position: 'absolute',
            left: `${(hover.x / W) * 100}%`,
            top: `${(hover.y / H) * 100}%`,
            transform: 'translate(-50%, -130%)',
            background: INK.primary,
            color: '#fff',
            fontSize: 11.5,
            padding: '4px 9px',
            borderRadius: 7,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {hover.text}
        </div>
      ) : null}
    </div>
  );
}

/** Ranking horizontal. Una sola serie: sin leyenda, con valor al final de cada barra. */
function RankedBars({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="col" style={{ gap: 8 }}>
      {rows.map((row) => (
        <div key={row.label}>
          <div className="row small" style={{ gap: 8, marginBottom: 3 }}>
            <span className="grow truncate" style={{ color: INK.primary }}>{row.label}</span>
            <span className="mono" style={{ color: INK.secondary }}>{row.value}</span>
          </div>
          <div style={{ height: 8, background: INK.grid, borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                width: `${(row.value / max) * 100}%`,
                height: '100%',
                background: MAGNITUDE,
                borderRadius: 4,
                minWidth: 3,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Vista de tabla: la alternativa accesible al gráfico, siempre disponible. */
function DailyTable({ daily }: { daily: Metrics['daily'] }) {
  return (
    <div className="scroll-x">
      <table className="grid">
        <thead>
          <tr>
            <th>Día</th>
            <th style={{ textAlign: 'right' }}>Recibidos</th>
            <th style={{ textAlign: 'right' }}>Enviados</th>
            <th style={{ textAlign: 'right' }}>Conversaciones</th>
            <th style={{ textAlign: 'right' }}>A humano</th>
            <th style={{ textAlign: 'right' }}>Pedidos</th>
            <th style={{ textAlign: 'right' }}>Tokens</th>
            <th style={{ textAlign: 'right' }}>Costo</th>
          </tr>
        </thead>
        <tbody>
          {daily.map((d) => (
            <tr key={d.day}>
              <td>{formatDay(d.day)}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{d.inbound}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{d.outbound}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{d.conversations}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{d.handoffs}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{d.orders}</td>
              <td className="mono" style={{ textAlign: 'right' }}>
                {(d.inputTokens + d.outputTokens).toLocaleString('es-AR')}
              </td>
              <td className="mono" style={{ textAlign: 'right' }}>{usd(d.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ helpers

/** Barra con las esquinas de la punta redondeadas y la base cuadrada. */
function barPath(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0.5) return `M${x},${y}h${w}v0.5h${-w}Z`;
  const radius = Math.min(r, w / 2, h);
  return [
    `M${x},${y + h}`,
    `L${x},${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `L${x + w - radius},${y}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `L${x + w},${y + h}`,
    'Z',
  ].join(' ');
}

function niceTicks(max: number, count: number): number[] {
  const rawStep = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep) || 0);
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 0.999; value += step) ticks.push(Math.round(value));
  return ticks;
}

/**
 * Los turnos cuestan fracciones de centavo, así que un `$0.00` no dice nada:
 * se muestran cuatro decimales cuando el número es chico.
 */
function usd(value: number): string {
  if (!value) return '$0';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

function formatDay(day: string): string {
  const [, month, date] = day.split('-');
  return `${date}/${month}`;
}

function prettyIntent(intent: string): string {
  const map: Record<string, string> = {
    chat: 'Charla general',
    buscar_catalogo: 'Precios y productos',
    disponibilidad_hoy: 'Qué hay hoy',
    mensaje_rapido: 'Consulta típica',
    crear_pedido: 'Tomó un pedido',
    consultar_pedido: 'Estado de un pedido',
    registrar_nota_cliente: 'Guardó contexto',
    escalar_a_humano: 'Pasó a una persona',
    error: 'Error del bot',
    'dry-run': 'Modo prueba',
  };
  return map[intent] ?? intent;
}
