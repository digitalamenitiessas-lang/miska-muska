import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Order, type OrderStatus, type ResumenPedidos } from '../api';
import { ComandaPedido } from './Comanda';
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

export function Pedidos({
  tick,
  onVerChat,
  toast,
}: {
  tick: number;
  /** Abre la charla de este pedido en la bandeja. */
  onVerChat: (conversationId: string) => void;
  toast: (text: string) => void;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<OrderStatus | 'todos'>('todos');
  /*
    El buscador de pedidos. Lo pidieron los chicos del mostrador: con el filtro
    por día ya saben qué hay que tener listo el sábado, pero cuando alguien
    llama preguntando por SU pedido lo que hace falta es encontrarlo por nombre.
  */
  const [busqueda, setBusqueda] = useState('');
  const [loading, setLoading] = useState(true);
  /*
    Pedido abierto en la comanda. Se guarda el id y no el objeto: mientras la
    hoja está abierta puede llegar un cambio por el stream, y con el objeto
    congelado la comanda mostraría el pedido de hace un rato.
  */
  const [comanda, setComanda] = useState<string | null>(null);

  /*
    Número de orden de la carga en curso. Un turno del bot dispara varias cargas
    casi juntas, y sin esto gana la que CONTESTA última, no la que SALIÓ última:
    una respuesta pedida antes de que el pedido existiera puede llegar después y
    devolver la lista al estado anterior, donde se queda hasta el próximo evento.
    Es exactamente la forma en que las tarjetas parecen "no actualizarse".
  */
  const ultimaCarga = useRef(0);

  /*
    QUÉ DÍA SE ESTÁ MIRANDO.

    El local trabaja por fecha de ENTREGA, no por cuándo se cargó el pedido: la
    pregunta real es "qué hay que tener listo el sábado". Un pedido tomado hoy
    para el 13 pertenece al 13.

    Arranca en 'todos', que es lo que se veía hasta ahora. Poner "hoy" por
    defecto sonaba tentador y es justo lo que haría perder de vista la torta del
    sábado que hay que empezar el jueves.
  */
  const [dia, setDia] = useState<{ tipo: 'todos' | 'dia' | 'mes'; fecha: string }>({
    tipo: 'todos',
    fecha: '',
  });

  /** Hoy en Tucumán, no en el reloj de la computadora. Ver la caja del día. */
  const hoyISO = () =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Tucuman' });

  const sumarDias = (iso: string, n: number) => {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString('en-CA');
  };

  /** El rango que se le pide al servidor, con los dos extremos incluidos. */
  const rango = useMemo(() => {
    if (dia.tipo === 'todos' || !dia.fecha) return {};
    if (dia.tipo === 'dia') return { desde: dia.fecha, hasta: dia.fecha };
    const [a, m] = dia.fecha.split('-');
    const ultimo = new Date(Number(a), Number(m), 0).getDate();
    return { desde: `${a}-${m}-01`, hasta: `${a}-${m}-${String(ultimo).padStart(2, '0')}` };
  }, [dia]);

  const [resumen, setResumen] = useState<ResumenPedidos | null>(null);

  const load = useCallback(async () => {
    const mia = ++ultimaCarga.current;
    try {
      const [lista, nums] = await Promise.all([
        api.orders(rango as Record<string, string>),
        api.resumenPedidos(),
      ]);
      if (mia !== ultimaCarga.current) return; // llegó tarde: ya hay una más nueva
      setOrders(lista);
      setResumen(nums);
    } catch (err) {
      if (mia === ultimaCarga.current) toast(`No pude cargar los pedidos: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [toast, rango]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  /*
    Sin tildes y en minúscula de los dos lados: nadie escribe "Nicolás" con
    tilde cuando está apurado, y el pedido está cargado con ella.
  */
  const pelado = (s: string) =>
    s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

  /**
   * Todo lo que se puede escribir para encontrar un pedido: el número, quien lo
   * hizo, el teléfono, qué lleva, a dónde va y para quién.
   *
   * La dedicatoria entra a propósito: más de una vez lo que recuerdan del
   * pedido es el nombre de la persona a la que va dedicado, no el de quien pagó.
   */
  const buscables = (o: Order) =>
    pelado(
      [
        String(o.number),
        o.customerName,
        o.customerPhone ?? '',
        o.address ?? '',
        o.recipientName ?? '',
        o.dedication ?? '',
        o.items.map((i) => i.description).join(' '),
      ].join(' '),
    );

  const visible = useMemo(() => {
    const porEstado = filter === 'todos' ? orders : orders.filter((o) => o.status === filter);
    const q = pelado(busqueda.trim());
    if (!q) return porEstado;
    // Todas las palabras, en cualquier orden: "rossana torta" encuentra igual.
    const partes = q.split(/\s+/);
    return porEstado.filter((o) => {
      const texto = buscables(o);
      return partes.every((p) => texto.includes(p));
    });
  }, [orders, filter, busqueda]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) map.set(o.status, (map.get(o.status) ?? 0) + 1);
    return map;
  }, [orders]);

  const pendingMoney = useMemo(
    () =>
      orders
        // Un entregado con saldo ES plata a cobrar: acá se entrega contra seña y
        // el resto se paga al retirar. Antes se descontaban los entregados y esta
        // tarjeta decía $0 mientras la fila de abajo mostraba "debe $X" en rojo.
        .filter((o) => o.status !== 'cancelado')
        .reduce((sum, o) => sum + Math.max(0, o.total - o.paid), 0),
    [orders],
  );

  /*
    "Falta el comprobante" es plata sin registrar, no un estado. Antes contaba los
    borradores, que es exactamente lo que ya muestra el chip Borrador de abajo, y
    dejaba afuera al pedido que salió de borrador sin que nadie registrara un peso.
  */
  const sinCobrar = useMemo(
    () => orders.filter((o) => o.status !== 'cancelado' && o.total > 0 && o.paid <= 0).length,
    [orders],
  );

  /*
    LA CAJA DEL DÍA: cuánto se cobró HOY.

    Suma por CUÁNDO ENTRÓ LA PLATA, no por cuándo se creó el pedido ni para
    cuándo es. Son tres fechas distintas y solo una arma una caja: una seña que
    se cobra hoy por una torta del sábado es plata de hoy, y un pedido de ayer
    que se termina de pagar hoy también.

    El día se calcula en la hora de Tucumán y no en la de la computadora: el
    panel se abre desde el celular de cualquiera, y una compu con el reloj en
    otro huso partiría la caja a una hora que no es. 'en-CA' da YYYY-MM-DD, que
    es lo que se puede comparar como texto.
  */
  const hoyEnTucuman = () =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Tucuman' });

  const cobradoHoy = useMemo(() => {
    const hoy = hoyEnTucuman();
    const deHoy = orders.filter(
      (o) =>
        o.status !== 'cancelado' &&
        o.paid > 0 &&
        o.paidAt &&
        new Date(o.paidAt).toLocaleDateString('en-CA', {
          timeZone: 'America/Argentina/Tucuman',
        }) === hoy,
    );
    return { monto: deHoy.reduce((s, o) => s + o.paid, 0), cuantos: deHoy.length };
  }, [orders]);

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

  const abierto = orders.find((o) => o.id === comanda) ?? null;

  return (
    <>
      {/*
        Las tarjetas NO salen de la lista de abajo, y esa es la única forma de
        que digan la verdad: la lista se filtra por día, así que mirar el sábado
        haría que "cobrado hoy" contara la plata del sábado. Y además la lista
        trae como mucho 200 filas, con lo cual "por cobrar" se iba a quedar corto
        en cuanto el local acumulara más pedidos que eso.

        Se calculan en el servidor sobre toda la tabla. Mientras no llegan se
        muestran los de la lista, para que no parpadeen en cero.
      */}
      <div className="tiles">
        <Tile
          label="Para hoy"
          value={String(resumen?.paraHoy ?? 0)}
          note={
            (resumen?.masAdelante ?? 0) > 0
              ? `${resumen?.masAdelante} más adelante`
              : 'Sin entregar todavía'
          }
        />
        <Tile
          label="Sin comprobante"
          value={String(resumen?.sinComprobante ?? sinCobrar)}
          note="No se registró ni un peso todavía"
        />
        <Tile
          label="Por cobrar"
          value={money(resumen?.porCobrar ?? pendingMoney)}
          note="Total menos lo cobrado, incluidos los entregados"
        />
        <Tile
          label="Cobrado hoy"
          value={money(resumen?.cobradoHoy ?? cobradoHoy.monto)}
          note={
            (resumen?.cobradosHoy ?? cobradoHoy.cuantos) === 1
              ? '1 pedido cobrado hoy'
              : `${resumen?.cobradosHoy ?? cobradoHoy.cuantos} pedidos cobrados hoy`
          }
        />
        {(resumen?.sinPrecio ?? sinPrecio) > 0 ? (
          <Tile
            label="Sin precio"
            value={String(resumen?.sinPrecio ?? sinPrecio)}
            note="Cargales el total a mano"
          />
        ) : null}
      </div>

      {/*
        POR FECHA DE ENTREGA, no por cuándo se cargó el pedido. La pregunta del
        local es "qué hay que tener listo el sábado", y un pedido tomado hoy para
        el 13 pertenece al 13.
      */}
      <div className="row wrap" style={{ marginBottom: 10, gap: 6, alignItems: 'center' }}>
        {/*
          Buscar apaga el filtro por día, y es a propósito: quien busca a
          "Rossana" la quiere encontrar sea para el día que sea. Si el filtro
          quedara puesto, el buscador parecería no andar justo cuando el pedido
          es de mañana. Los chips de arriba muestran el cambio, así que no se
          oculta nada.
        */}
        <input
          className="buscador-pedidos"
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value);
            if (e.target.value.trim()) setDia({ tipo: 'todos', fecha: '' });
          }}
          placeholder="Buscar por nombre, teléfono, N° o producto"
          aria-label="Buscar un pedido"
        />
        {busqueda ? (
          <button className="chip" onClick={() => setBusqueda('')} title="Borrar la búsqueda">
            ✕ {visible.length} {visible.length === 1 ? 'pedido' : 'pedidos'}
          </button>
        ) : null}
        <span className="small muted">Entrega:</span>
        <button
          className="chip"
          aria-pressed={dia.tipo === 'todos'}
          onClick={() => setDia({ tipo: 'todos', fecha: '' })}
        >
          Todas
        </button>
        <button
          className="chip"
          aria-pressed={dia.tipo === 'dia' && dia.fecha === hoyISO()}
          onClick={() => setDia({ tipo: 'dia', fecha: hoyISO() })}
        >
          Hoy
        </button>
        <button
          className="chip"
          aria-pressed={dia.tipo === 'dia' && dia.fecha === sumarDias(hoyISO(), 1)}
          onClick={() => setDia({ tipo: 'dia', fecha: sumarDias(hoyISO(), 1) })}
        >
          Mañana
        </button>
        <input
          type="date"
          value={dia.fecha}
          onChange={(e) =>
            setDia(e.target.value ? { tipo: 'dia', fecha: e.target.value } : { tipo: 'todos', fecha: '' })
          }
          title="Ver los pedidos de un día puntual"
          style={{ width: 'auto' }}
        />
        <button
          className="chip"
          aria-pressed={dia.tipo === 'mes'}
          disabled={!dia.fecha}
          title={dia.fecha ? 'Ver todo el mes de esa fecha' : 'Elegí una fecha primero'}
          onClick={() => setDia((d) => ({ tipo: 'mes', fecha: d.fecha }))}
        >
          Todo el mes
        </button>
        {dia.tipo !== 'todos' && dia.fecha ? (
          <span className="small muted">
            {dia.tipo === 'mes'
              ? `${orders.length} en el mes`
              : `${orders.length} para el ${dia.fecha.split('-').reverse().slice(0, 2).join('/')}`}
          </span>
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
            {busqueda.trim()
              ? `Ningún pedido coincide con "${busqueda.trim()}". Probá con el apellido, el teléfono o el número de pedido.`
              : 'No hay pedidos con este filtro. Los que tome el bot aparecen acá automáticamente.'}
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
                        <button
                          className="link-numero"
                          title="Ver la comanda: todo lo que sabemos de este pedido"
                          onClick={() => setComanda(o.id)}
                        >
                          <strong>{o.number}</strong>
                        </button>
                        <div className="small muted">{o.createdBy === 'bot' ? '🤖' : '👤'}</div>
                      </td>
                      <td>
                        {/* El nombre lleva al chat; el numero, a la comanda. Uno es la
                            persona y el otro es el pedido. */}
                        {o.conversationId ? (
                          <button
                            className="link-numero"
                            title="Abrir la conversación con esta persona"
                            onClick={() => onVerChat(o.conversationId!)}
                          >
                            {o.customerName}
                          </button>
                        ) : (
                          <div title="Este pedido se cargó sin una conversación asociada">
                            {o.customerName}
                          </div>
                        )}
                        <div className="small muted">
                          {[o.customerPhone, o.customerDni].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </td>
                      <td style={{ maxWidth: 260 }}>
                        <div className="small">
                          {o.items
                            .map((i) =>
                              // La observación es una modificación PEDIDA, no autorizada:
                              // por eso viaja pegada al ítem y no como nota suelta.
                              i.observation
                                ? `${i.quantity}× ${i.description} (${i.observation})`
                                : `${i.quantity}× ${i.description}`,
                            )
                            .join(', ')}
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
                        {o.recipientName ? (
                          <div className="muted">recibe {o.recipientName}</div>
                        ) : null}
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
                          <button
                            className="btn btn-sm btn-ghost"
                            title="Ver la comanda"
                            onClick={() => setComanda(o.id)}
                          >
                            Comanda
                          </button>
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

      {abierto ? (
        <ComandaPedido pedido={abierto} onCerrar={() => setComanda(null)} toast={toast} />
      ) : null}
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
