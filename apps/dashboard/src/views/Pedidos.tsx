import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Order, type OrderStatus } from '../api';
import {
  DELIVERY_LABEL,
  Empty,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  Pill,
  money,
} from '../ui';

const STATUSES: OrderStatus[] = [
  'borrador', 'confirmado', 'en-preparacion', 'listo', 'entregado', 'cancelado',
];

/** Siguiente estado natural, para el botón de avance rápido. */
const NEXT: Partial<Record<OrderStatus, OrderStatus>> = {
  borrador: 'confirmado',
  confirmado: 'en-preparacion',
  'en-preparacion': 'listo',
  listo: 'entregado',
};

export function Pedidos({ tick, toast }: { tick: number; toast: (text: string) => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<OrderStatus | 'todos'>('todos');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setOrders(await api.orders());
    } catch (err) {
      toast(`No pude cargar los pedidos: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  const visible = useMemo(
    () => (filter === 'todos' ? orders : orders.filter((o) => o.status === filter)),
    [orders, filter],
  );

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) map.set(o.status, (map.get(o.status) ?? 0) + 1);
    return map;
  }, [orders]);

  const pendingMoney = useMemo(
    () =>
      orders
        .filter((o) => o.status !== 'cancelado' && o.status !== 'entregado')
        .reduce((sum, o) => sum + Math.max(0, o.total - o.paid), 0),
    [orders],
  );

  /** Pedidos que quedaron sin precio. El bot ya no los deja pasar, pero los que
      se cargaron antes siguen en cero y hay que corregirlos a mano. */
  const sinPrecio = useMemo(
    () => orders.filter((o) => o.total <= 0 && o.status !== 'cancelado').length,
    [orders],
  );

  const update = async (id: string, patch: Partial<Order>) => {
    try {
      const next = await api.updateOrder(id, patch);
      setOrders((prev) => prev.map((o) => (o.id === next.id ? next : o)));
    } catch (err) {
      toast(`No pude actualizar: ${String(err)}`);
    }
  };

  return (
    <>
      <div className="tiles">
        <Tile label="Pedidos totales" value={String(orders.length)} />
        <Tile
          label="Sin comprobante"
          value={String(counts.get('borrador') ?? 0)}
          note="Borradores: falta la transferencia"
        />
        <Tile label="Por entregar" value={String((counts.get('confirmado') ?? 0) + (counts.get('en-preparacion') ?? 0) + (counts.get('listo') ?? 0))} />
        <Tile label="Por cobrar" value={money(pendingMoney)} note="Total menos lo ya transferido" />
        {sinPrecio > 0 ? (
          <Tile label="Sin precio" value={String(sinPrecio)} note="Cargales el total a mano" />
        ) : null}
      </div>

      <div className="row wrap" style={{ marginBottom: 12 }}>
        <button className="chip" aria-pressed={filter === 'todos'} onClick={() => setFilter('todos')}>
          Todos ({orders.length})
        </button>
        {STATUSES.map((s) => (
          <button key={s} className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>
            {ORDER_STATUS_LABEL[s]} ({counts.get(s) ?? 0})
          </button>
        ))}
      </div>

      <section className="card">
        {loading ? (
          <Empty glyph="⏳">Cargando…</Empty>
        ) : visible.length === 0 ? (
          <Empty glyph="🧾">
            No hay pedidos con este filtro. Los que tome el bot aparecen acá automáticamente.
          </Empty>
        ) : (
          <div className="scroll-x">
            <table className="grid">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Cliente</th>
                  <th>Productos</th>
                  <th>Retiro / entrega</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Pagado</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((o) => {
                  const owes = Math.max(0, o.total - o.paid);
                  const next = NEXT[o.status];
                  return (
                    <tr key={o.id}>
                      <td className="mono">
                        <strong>{o.number}</strong>
                        <div className="small muted">{o.createdBy === 'bot' ? '🤖' : '👤'}</div>
                      </td>
                      <td>
                        <div>{o.customerName}</div>
                        <div className="small muted">
                          {[o.customerPhone, o.customerDni].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </td>
                      <td style={{ maxWidth: 260 }}>
                        <div className="small">
                          {o.items.map((i) => `${i.quantity}× ${i.description}`).join(', ')}
                        </div>
                        {o.notes ? <div className="small muted">📝 {o.notes}</div> : null}
                        {o.dedication ? <div className="small muted">💌 {o.dedication}</div> : null}
                      </td>
                      <td className="small">
                        <div>{DELIVERY_LABEL[o.deliveryMode]}</div>
                        <div className="muted">
                          {[o.deliveryDate, o.deliveryTime].filter(Boolean).join(' · ') || 'sin fecha'}
                        </div>
                        {o.address ? <div className="muted">📍 {o.address}</div> : null}
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        <Importe
                          valor={o.total}
                          onGuardar={(n) => void update(o.id, { total: n })}
                          alerta={o.total <= 0 ? 'falta el precio' : undefined}
                        />
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        <Importe valor={o.paid} onGuardar={(n) => void update(o.id, { paid: n })} />
                        {owes > 0 ? (
                          <div className="small" style={{ color: 'var(--danger)' }}>
                            debe {money(owes)}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <Pill tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Pill>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          {/* Antes esto colgaba de `owes > 0`, así que con el
                              total en cero el botón desaparecía y no quedaba
                              ninguna forma de marcar el pedido como pagado.
                              Ahora está siempre en borrador, y cuando falta el
                              precio se ve deshabilitado y dice por qué. */}
                          {o.status === 'borrador' ? (
                            <button
                              className="btn btn-sm btn-primary"
                              disabled={o.total <= 0}
                              title={
                                o.total <= 0
                                  ? 'Primero cargá el total: marcar pagado $0 no significa nada'
                                  : 'Llegó el comprobante: marca pagado y confirma'
                              }
                              onClick={() => void update(o.id, { paid: o.total, status: 'confirmado' })}
                            >
                              Comprobante ✓
                            </button>
                          ) : null}
                          {next ? (
                            <button
                              className="btn btn-sm"
                              onClick={() => void update(o.id, { status: next })}
                            >
                              → {ORDER_STATUS_LABEL[next]}
                            </button>
                          ) : null}
                          {o.status !== 'cancelado' && o.status !== 'entregado' ? (
                            <button
                              className="btn btn-sm btn-ghost"
                              title="Cancelar el pedido"
                              onClick={() => void update(o.id, { status: 'cancelado' })}
                            >
                              ✕
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * Importe editable dentro de la tabla: se ve como texto y al tocarlo se vuelve
 * campo. Hace falta por dos motivos distintos que antes no tenían salida sin
 * entrar a la base: un pedido a medida que quedó sin precio, y una seña —que en
 * pastelería es la norma, no la excepción— que no es ni cero ni el total.
 */
function Importe({
  valor,
  onGuardar,
  alerta,
}: {
  valor: number;
  onGuardar: (n: number) => void;
  alerta?: string;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(String(valor));

  // Si el valor cambia por el stream —lo tocó otra persona— se refleja acá.
  useEffect(() => {
    setTexto(String(valor));
  }, [valor]);

  const guardar = () => {
    setEditando(false);
    const n = Number(texto);
    if (Number.isFinite(n) && n >= 0 && n !== valor) onGuardar(n);
    else setTexto(String(valor));
  };

  if (!editando) {
    return (
      <button className="importe" onClick={() => setEditando(true)} title="Tocá para corregirlo">
        {money(valor)}
        {alerta ? <span className="importe-alerta">{alerta}</span> : null}
      </button>
    );
  }

  return (
    <input
      type="number"
      min={0}
      step={100}
      autoFocus
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={guardar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          guardar();
        }
        if (e.key === 'Escape') {
          setTexto(String(valor));
          setEditando(false);
        }
      }}
      style={{ width: 104, textAlign: 'right' }}
    />
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
