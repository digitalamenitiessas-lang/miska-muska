import { useEffect, useState, type ReactNode } from 'react';
import {
  api,
  type Contact,
  type ConversationDetail,
  type CourseSignup,
  type CursoConTurnos,
  type Message,
  type Order,
} from '../api';
import { sinEtiquetaDeAdjunto } from './Inbox';
import {
  CHANNEL_LABEL,
  DELIVERY_LABEL,
  Empty,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  Pill,
  clock,
  money,
} from '../ui';

/**
 * La comanda: todo lo que se sabe de un pedido o de una inscripción, en una sola
 * hoja y en el orden en que lo lee alguien que está por producirlo.
 *
 * Existe porque la tabla de pedidos es un resumen: entra lo que se puede leer de
 * un vistazo y se pierde el resto. Y el resto es justamente lo que el bot fue
 * juntando en la charla —la dedicatoria, quién recibe, la modificación que
 * autorizó una persona, lo que el cliente aclaró de pasada— que no vive en la
 * fila del pedido sino repartido entre el contacto, la consulta y los mensajes.
 *
 * Por eso la comanda pide la conversación entera y la muestra abajo: cuando algo
 * no cierra, la fuente está a la vista y no hay que ir a buscarla a otra pantalla.
 */

/**
 * Una fecha guardada como YYYY-MM-DD, escrita como la diría una persona.
 *
 * Se parte el texto a mano en vez de dárselo a `new Date`: esa cadena se parsea
 * como medianoche UTC, y en Tucumán eso es el día anterior a las nueve de la
 * noche. Una comanda con la fecha corrida un día es peor que una sin fecha.
 */
function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  if (!a || !m || !d) return iso;
  const fecha = new Date(a, m - 1, d);
  return fecha.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  });
}

/** Un dato con su etiqueta. Si no hay dato, la fila no se dibuja. */
function Dato({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="comanda-dato">
      <span className="comanda-label">{label}</span>
      <span className="comanda-valor">{children}</span>
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="comanda-bloque">
      <h4 className="comanda-titulo">{titulo}</h4>
      {children}
    </section>
  );
}

/** El envoltorio: fondo, hoja, encabezado con el botón de imprimir. */
function Hoja({
  titulo,
  subtitulo,
  chips,
  onCerrar,
  children,
}: {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  chips?: ReactNode;
  onCerrar: () => void;
  children: ReactNode;
}) {
  // Escape cierra: es un diálogo, y la mano ya está en el teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCerrar]);

  return (
    <div className="foto-fondo" onClick={onCerrar}>
      <div className="comanda card" onClick={(e) => e.stopPropagation()}>
        <div className="card-pad">
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <div className="grow" style={{ minWidth: 0 }}>
              <h3 className="card-title" style={{ margin: 0 }}>
                {titulo}
              </h3>
              {subtitulo ? <div className="small muted">{subtitulo}</div> : null}
            </div>
            {/* Se imprime la hoja, no la pantalla: el CSS de impresión esconde
                todo lo demás. Sale en blanco y negro y entra en una A4. */}
            <button className="btn btn-sm no-imprimir" onClick={() => window.print()}>
              Imprimir
            </button>
            <button className="btn btn-sm btn-ghost no-imprimir" onClick={onCerrar}>
              Cerrar
            </button>
          </div>

          {chips ? (
            <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
              {chips}
            </div>
          ) : null}

          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * La charla, tal cual pasó. Va colapsada: son doscientos mensajes y la comanda
 * se lee de arriba hacia abajo, pero cuando algo no cierra —una fecha rara, una
 * aclaración que no entró en ningún campo— la fuente tiene que estar a un clic.
 */
function Charla({ mensajes }: { mensajes: Message[] }) {
  const [abierta, setAbierta] = useState(false);
  if (!mensajes.length) return null;

  const utiles = mensajes.filter((m) => m.contentKind !== 'typing');

  return (
    <Bloque titulo={`La charla · ${utiles.length} mensajes`}>
      <button className="btn btn-sm no-imprimir" onClick={() => setAbierta((v) => !v)}>
        {abierta ? 'Ocultar la charla' : 'Ver la charla completa'}
      </button>
      {abierta ? (
        <div className="comanda-charla">
          {/* Las mismas burbujas de la bandeja: es la misma charla, y verla con
              otra cara obligaría a volver a entender qué es cada cosa. */}
          {utiles.map((m) => {
            const sale = m.direction === 'out';
            const adjunto = m.payload as
              | { url?: string; filename?: string; mediaError?: string }
              | null;
            const foto = m.contentKind === 'image' ? adjunto?.url : undefined;
            const texto = adjunto?.url ? sinEtiquetaDeAdjunto(m.text) : m.text;
            return (
              <div
                key={m.id}
                className={`bubble ${sale ? 'bubble-out' : 'bubble-in'}${
                  sale && m.author !== 'bot' ? ` by-${m.author}` : ''
                }`}
              >
                {foto ? <img className="bubble-foto" src={foto} alt={m.text} /> : null}
                {/* Un PDF o un audio no se abren desde una hoja que se imprime:
                    queda el link, y la bandeja los reproduce. El texto del
                    cliente va SIEMPRE: es lo que escribió, no una etiqueta. */}
                {!foto && adjunto?.url ? (
                  <a className="bubble-archivo" href={adjunto.url} target="_blank" rel="noreferrer">
                    📎 {adjunto.filename ?? 'abrir el archivo'}
                  </a>
                ) : null}
                {texto || (adjunto?.url ? '' : `(${m.contentKind})`)}
                <div className="bubble-foot">
                  <span>{clock(m.createdAt)}</span>
                  <span>
                    {!sale
                      ? 'cliente'
                      : m.author === 'human'
                        ? '👤 local'
                        : m.author === 'system'
                          ? '⚙️ sistema'
                          : '🤖 bot'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </Bloque>
  );
}

/** La ficha del contacto: lo que el bot sabe de la persona, no del pedido. */
function Persona({ contacto }: { contacto: Contact | null }) {
  if (!contacto) return null;
  return (
    <>
      <Dato label="Canal">
        {CHANNEL_LABEL[contacto.channel] ?? contacto.channel}
        {contacto.username ? ` · @${contacto.username}` : ''}
        {contacto.isReturning ? ' · ya compró antes' : ' · primera vez'}
      </Dato>
      <Dato label="Se presentó como">{contacto.displayName}</Dato>
      <Dato label="Notas del cliente">{contacto.notes}</Dato>
    </>
  );
}

/**
 * Contexto que no está en el pedido: la consulta de modificación con su respuesta
 * y el motivo por el que la charla quedó marcada. Es lo que explica por qué un
 * ítem tiene una observación rara, así que va arriba de la charla y no adentro.
 */
function Contexto({ detalle }: { detalle: ConversationDetail | null }) {
  if (!detalle) return null;
  const { conversation } = detalle;
  const consulta = conversation.pendingReview;
  if (!consulta && !conversation.attentionReason) return null;

  return (
    <Bloque titulo="Lo que se consultó">
      {consulta ? (
        <>
          <Dato label="Pidió">
            {consulta.pedido} — sobre {consulta.producto}
          </Dato>
          <Dato label="Dijo">{consulta.textoCliente ? `“${consulta.textoCliente}”` : null}</Dato>
          <Dato label="Contestamos">
            {consulta.respuesta ?? (
              <span style={{ color: 'var(--danger)' }}>todavía sin responder</span>
            )}
          </Dato>
        </>
      ) : null}
      <Dato label="Marcada por">{conversation.attentionReason}</Dato>
    </Bloque>
  );
}

// ---------------------------------------------------------------------------

/** La comanda de un pedido. */
export function ComandaPedido({
  pedido,
  onCerrar,
  toast,
}: {
  pedido: Order;
  onCerrar: () => void;
  toast: (text: string) => void;
}) {
  const [detalle, setDetalle] = useState<ConversationDetail | null>(null);
  const [cargando, setCargando] = useState(Boolean(pedido.conversationId));

  useEffect(() => {
    /*
      Un pedido cargado a mano no tiene charla, y eso no es un error: la comanda
      se dibuja igual con lo que hay en el pedido.
    */
    if (!pedido.conversationId) return;
    let vigente = true;
    void (async () => {
      try {
        const d = await api.conversation(pedido.conversationId as string);
        if (vigente) setDetalle(d);
      } catch (err) {
        if (vigente) toast(`No pude traer la charla: ${String(err)}`);
      } finally {
        if (vigente) setCargando(false);
      }
    })();
    return () => {
      vigente = false;
    };
  }, [pedido.conversationId, toast]);

  const saldo = Math.max(0, pedido.total - pedido.paid);
  /*
    Otros pedidos de la misma charla. La fusión parte el pedido a propósito
    cuando cambia la fecha o la modalidad, y sin este aviso el que produce ve
    una comanda y no sabe que hay otra atada al mismo cliente.
  */
  const otros = (detalle?.orders ?? []).filter(
    (o) => o.id !== pedido.id && o.status !== 'cancelado',
  );
  const entrega = [pedido.deliveryDate ? fechaLarga(pedido.deliveryDate) : null, pedido.deliveryTime]
    .filter(Boolean)
    .join(' · ');

  return (
    <Hoja
      titulo={`Pedido ${pedido.number}`}
      subtitulo={`Lo cargó ${pedido.createdBy === 'bot' ? 'el bot' : 'una persona'} el ${new Date(
        pedido.createdAt,
      ).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`}
      chips={
        <>
          <Pill tone={ORDER_STATUS_TONE[pedido.status]}>{ORDER_STATUS_LABEL[pedido.status]}</Pill>
          <Pill tone="grey">{DELIVERY_LABEL[pedido.deliveryMode]}</Pill>
          {entrega ? <Pill tone="lav">{entrega}</Pill> : <Pill tone="danger">sin fecha</Pill>}
          {saldo > 0 ? <Pill tone="danger">debe {money(saldo)}</Pill> : <Pill tone="ok">pago</Pill>}
        </>
      }
      onCerrar={onCerrar}
    >
      <Bloque titulo="Qué se hace">
        <table className="grid comanda-items">
          <tbody>
            {pedido.items.map((i, n) => (
              <tr key={`${i.description}-${n}`}>
                <td className="mono" style={{ width: 44 }}>
                  {i.quantity}×
                </td>
                <td>
                  <div>{i.description}</div>
                  {i.quantity > 1 ? (
                    <div className="small muted">a {money(i.unitPrice)} cada uno</div>
                  ) : null}
                  {/* La observación es la modificación que autorizó una persona:
                      es lo primero que hay que ver antes de producir, no una
                      aclaración al pie. Y va con quién la autorizó: sola dice
                      "sin jamón" y no dice si alguien lo aprobó. */}
                  {i.observation ? (
                    <div className="comanda-observacion">
                      ⚠ {i.observation}
                      {i.authorization ? (
                        <div className="small" style={{ marginTop: 2 }}>
                          Lo autorizó el local: “{i.authorization.respuesta}”
                        </div>
                      ) : (
                        <div className="small muted" style={{ marginTop: 2 }}>
                          Se autorizó en la charla.
                        </div>
                      )}
                    </div>
                  ) : null}
                </td>
                <td className="mono" style={{ textAlign: 'right', width: 110 }}>
                  {money(i.unitPrice * i.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Dato label="Dedicatoria">{pedido.dedication}</Dato>
        <Dato label="Aclaraciones">{pedido.notes}</Dato>
      </Bloque>

      <Bloque titulo="Cuándo y cómo">
        <Dato label="Entrega">{DELIVERY_LABEL[pedido.deliveryMode]}</Dato>
        <Dato label="Fecha">{entrega || 'sin fecha acordada'}</Dato>
        <Dato label="Dirección">{pedido.address}</Dato>
        <Dato label="Recibe">{pedido.recipientName}</Dato>
      </Bloque>

      <Bloque titulo="Quién">
        <Dato label="Cliente">{pedido.customerName}</Dato>
        <Dato label="Teléfono">{pedido.customerPhone}</Dato>
        <Dato label="DNI">{pedido.customerDni}</Dato>
        <Persona contacto={detalle?.contact ?? null} />
      </Bloque>

      <Bloque titulo="Plata">
        <Dato label="Total">{money(pedido.total)}</Dato>
        <Dato label="Transferido">{money(pedido.paid)}</Dato>
        <Dato label="Saldo">
          {saldo > 0 ? <span style={{ color: 'var(--danger)' }}>{money(saldo)}</span> : money(0)}
        </Dato>
      </Bloque>

      <Contexto detalle={detalle} />

      {otros.length ? (
        <p className="small" style={{ marginTop: 12 }}>
          ⚠ Esta charla tiene {otros.length === 1 ? 'otro pedido' : 'otros pedidos'}:{' '}
          {otros.map((o) => o.number).join(', ')}. Fijate si sale junto.
        </p>
      ) : null}

      {cargando ? (
        <p className="small muted">Trayendo la charla…</p>
      ) : detalle ? (
        <Charla mensajes={detalle.messages} />
      ) : pedido.conversationId ? null : (
        <p className="small muted">Este pedido se cargó a mano: no tiene charla.</p>
      )}
    </Hoja>
  );
}

// ---------------------------------------------------------------------------

/** La comanda de una inscripción a un curso. */
export function ComandaInscripcion({
  inscripto,
  curso,
  onCerrar,
  toast,
}: {
  inscripto: CourseSignup;
  curso: CursoConTurnos;
  onCerrar: () => void;
  toast: (text: string) => void;
}) {
  const [detalle, setDetalle] = useState<ConversationDetail | null>(null);
  const [cargando, setCargando] = useState(Boolean(inscripto.conversationId));

  useEffect(() => {
    if (!inscripto.conversationId) return;
    let vigente = true;
    void (async () => {
      try {
        const d = await api.conversation(inscripto.conversationId as string);
        if (vigente) setDetalle(d);
      } catch (err) {
        if (vigente) toast(`No pude traer la charla: ${String(err)}`);
      } finally {
        if (vigente) setCargando(false);
      }
    })();
    return () => {
      vigente = false;
    };
  }, [inscripto.conversationId, toast]);

  const turno = curso.sessions.find((t) => t.id === inscripto.sessionId);
  const saldo = Math.max(0, inscripto.total - inscripto.paid);

  return (
    <Hoja
      titulo={inscripto.fullName}
      subtitulo={`${curso.course.name} · la anotó ${
        inscripto.createdBy === 'bot' ? 'el bot' : 'una persona'
      } el ${new Date(inscripto.createdAt).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })}`}
      chips={
        <>
          <Pill
            tone={
              inscripto.status === 'inscripto'
                ? 'ok'
                : inscripto.status === 'cancelado'
                  ? 'grey'
                  : 'warn'
            }
          >
            {inscripto.status}
          </Pill>
          <Pill tone="lav">{turno?.label ?? 'sin turno'}</Pill>
          {saldo > 0 ? (
            <Pill tone="danger">falta {money(saldo)}</Pill>
          ) : (
            <Pill tone="ok">pagó todo</Pill>
          )}
        </>
      }
      onCerrar={onCerrar}
    >
      <Bloque titulo="El curso">
        <Dato label="Curso">{curso.course.name}</Dato>
        <Dato label="Turno">{turno?.label ?? 'sin turno asignado'}</Dato>
        <Dato label="Dónde">
          {curso.course.modality}
          {curso.course.location ? ` · ${curso.course.location}` : ''}
        </Dato>
        <Dato label="Temática">{curso.course.description}</Dato>
        {turno ? (
          <Dato label="Cupo del turno">
            {turno.taken ?? 0} de {turno.capacity}
          </Dato>
        ) : null}
      </Bloque>

      <Bloque titulo="Quién">
        <Dato label="Nombre y apellido">{inscripto.fullName}</Dato>
        <Dato label="Contacto que dejó">{inscripto.contactInfo}</Dato>
        <Persona contacto={detalle?.contact ?? null} />
        <Dato label="Aclaraciones">{inscripto.notes}</Dato>
      </Bloque>

      <Bloque titulo="Plata">
        <Dato label="Precio">{money(inscripto.total)}</Dato>
        <Dato label="Transferido">{money(inscripto.paid)}</Dato>
        <Dato label="Saldo">
          {saldo > 0 ? <span style={{ color: 'var(--danger)' }}>{money(saldo)}</span> : money(0)}
        </Dato>
        {/* El estado no es una etiqueta suelta: es lo que decide si el lugar está
            reservado. Se dice con todas las letras para que nadie tenga que
            acordarse de la regla. */}
        <Dato label="Lugar">
          {inscripto.status === 'inscripto'
            ? 'reservado, ya le avisamos'
            : inscripto.status === 'cancelado'
              ? 'liberado'
              : 'ocupado, pendiente de que aparezca la transferencia'}
        </Dato>
      </Bloque>

      <Contexto detalle={detalle} />

      {cargando ? (
        <p className="small muted">Trayendo la charla…</p>
      ) : detalle ? (
        <Charla mensajes={detalle.messages} />
      ) : inscripto.conversationId ? null : (
        <p className="small muted">La anotaron a mano: no tiene charla.</p>
      )}
    </Hoja>
  );
}

/** Para cuando no hay nada que mostrar y hace falta decirlo igual. */
export function ComandaVacia({ onCerrar }: { onCerrar: () => void }) {
  return (
    <Hoja titulo="Sin datos" onCerrar={onCerrar}>
      <Empty glyph="🧾">No encontré la información de esta comanda.</Empty>
    </Hoja>
  );
}
