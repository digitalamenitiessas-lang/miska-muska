import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type Conversation,
  type ConversationDetail,
  type LiveEvent,
  type Message,
} from '../api';
import { CHANNEL_LABEL, Empty, ORDER_STATUS_LABEL, ORDER_STATUS_TONE, Pill, clock, money, timeAgo } from '../ui';

type Filter = 'todas' | 'sin-leer' | 'consultas' | 'atencion' | 'bot' | 'humano';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'todas', label: 'Todas' },
  { id: 'sin-leer', label: 'Sin leer' },
  { id: 'consultas', label: 'Consultas' },
  { id: 'atencion', label: 'Atención' },
  { id: 'bot', label: 'Bot' },
  { id: 'humano', label: 'Humano' },
];

export function Inbox({
  conversations,
  lastEvent,
  tick,
  onConversationsChanged,
  toast,
}: {
  conversations: Conversation[];
  lastEvent: LiveEvent | null;
  tick: number;
  onConversationsChanged: () => void;
  toast: (text: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('todas');
  const [selected, setSelected] = useState<string | null>(null);
  /*
    Qué panel se ve cuando la pantalla da para uno solo (≤860 px). En escritorio
    los tres conviven y el CSS ignora este valor.

    Arranca en 'lista' a propósito: más abajo hay un efecto que preselecciona una
    conversación para que el escritorio no abra en blanco, y sin este estado el
    celular saltaría directo a un chat que nadie eligió.
  */
  const [panelMovil, setPanelMovil] = useState<'lista' | 'chat'>('lista');
  /** La ficha del cliente, que de 1180 px para abajo es un panel deslizante. */
  const [fichaAbierta, setFichaAbierta] = useState(false);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState('');
  /** Lo que el equipo le contesta al bot sobre una modificación pedida. */
  const [respuesta, setRespuesta] = useState('');
  /** Bandera propia, para no deshabilitar también el botón de enviar mensaje. */
  const [enviandoConsulta, setEnviandoConsulta] = useState(false);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(() => {
    const list = conversations.filter((c) => {
      switch (filter) {
        case 'sin-leer':
          return c.unreadCount > 0;
        case 'consultas':
          return Boolean(c.pendingReview && !c.pendingReview.resueltoEn);
        case 'atencion':
          return c.needsAttention;
        case 'bot':
          return c.mode === 'bot';
        case 'humano':
          return c.mode === 'human';
        default:
          return true;
      }
    });
    return list;
  }, [conversations, filter]);

  // Selección inicial: la primera que necesite atención, o la más reciente.
  useEffect(() => {
    if (selected || !visible.length) return;
    setSelected(visible.find((c) => c.needsAttention)?.id ?? visible[0].id);
  }, [visible, selected]);

  const loadDetail = useCallback(
    async (id: string, markRead = false) => {
      try {
        const data = await api.conversation(id);
        setDetail(data);
        if (markRead && data.conversation.unreadCount > 0) {
          await api.markRead(id);
        }
      } catch (err) {
        toast(`No pude abrir la conversación: ${String(err)}`);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (selected) void loadDetail(selected, true);
  }, [selected, loadDetail]);

  /** Abrir una conversación: en pantalla angosta además cambia de panel. */
  const abrir = (id: string) => {
    setSelected(id);
    setPanelMovil('chat');
  };

  // La ficha se cierra al cambiar de conversación: si no, queda abierta
  // mostrando todavía los datos del cliente anterior mientras carga el nuevo.
  useEffect(() => {
    setFichaAbierta(false);
    // Si no, la respuesta escrita para una consulta aparece cargada en la siguiente.
    setRespuesta('');
  }, [selected]);

  useEffect(() => {
    if (!fichaAbierta) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFichaAbierta(false);
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [fichaAbierta]);

  // Refresco puntual: solo si el evento es de la conversación abierta.
  useEffect(() => {
    if (!selected || !lastEvent) return;
    if (lastEvent.type === 'message' && lastEvent.conversationId === selected) {
      void loadDetail(selected, true);
    }
    if (lastEvent.type === 'typing' && lastEvent.conversationId === selected) {
      setTyping(lastEvent.on);
    }
    if (lastEvent.type === 'order' && lastEvent.order.conversationId === selected) {
      void loadDetail(selected);
    }
    // La consulta de modificación se abre y se cierra por este evento: sin esto la
    // franja quedaba en pantalla después de contestarla, hasta cambiar de chat.
    if (lastEvent.type === 'conversation' && lastEvent.conversation.id === selected) {
      void loadDetail(selected);
    }
    // `tick` fuerza la reevaluación aunque el objeto del evento sea idéntico.
  }, [tick, lastEvent, selected, loadDetail]);

  // Autoscroll al final cuando llegan mensajes.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [detail?.messages.length, typing]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !selected) return;
    setSending(true);
    try {
      await api.sendMessage(selected, text);
      setDraft('');
      await loadDetail(selected);
    } catch (err) {
      toast(`No se pudo enviar: ${String(err)}`);
    } finally {
      setSending(false);
    }
  };

  const responderConsulta = async () => {
    if (!selected || !respuesta.trim() || enviandoConsulta) return;
    setEnviandoConsulta(true);
    try {
      // `request` lanza con cualquier respuesta que no sea 2xx, incluido el 409 de
      // "otro la contestó primero": sin este catch el panel muestra un error crudo.
      await api.answerReview(selected, respuesta.trim());
      setRespuesta('');
      await loadDetail(selected);
      onConversationsChanged();
      toast('El bot ya puede seguir con el pedido');
    } catch (err) {
      toast(`No pude guardar la respuesta: ${String(err)}`);
    } finally {
      setEnviandoConsulta(false);
    }
  };

  const descartarConsulta = async () => {
    if (!selected) return;
    try {
      await api.clearReview(selected);
      await loadDetail(selected);
      onConversationsChanged();
      toast('Consulta descartada');
    } catch (err) {
      toast(`No pude descartarla: ${String(err)}`);
    }
  };

  const setMode = async (mode: 'bot' | 'human' | 'muted') => {
    if (!selected) return;
    try {
      await api.setMode(selected, mode);
      await loadDetail(selected);
      onConversationsChanged();
      toast(
        mode === 'human'
          ? 'Tomaste la conversación: el bot no responde acá'
          : mode === 'bot'
            ? 'Devuelta al bot'
            : 'Conversación silenciada',
      );
    } catch (err) {
      toast(`No pude cambiar el modo: ${String(err)}`);
    }
  };

  const useSuggestion = async (key: string) => {
    if (!selected) return;
    try {
      await api.sendQuickReply(selected, key);
      await loadDetail(selected);
      toast('Mensaje rápido enviado');
    } catch (err) {
      toast(`No se pudo enviar: ${String(err)}`);
    }
  };

  return (
    <div className="inbox" data-panel={panelMovil}>
      <div className="inbox-list">
        <div className="inbox-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className="chip"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <Empty glyph="💬">
            {conversations.length === 0
              ? 'Todavía no llegó ningún mensaje. Escribile al bot desde Telegram para probar.'
              : 'No hay conversaciones con este filtro.'}
          </Empty>
        ) : (
          visible.map((c) => (
            <button
              key={c.id}
              className="conv"
              aria-selected={selected === c.id}
              onClick={() => abrir(c.id)}
            >
              <div className="conv-top">
                <span className="conv-name">
                  {c.contact?.fullName || c.contact?.displayName || c.externalId}
                </span>
                <span className="conv-time">{timeAgo(c.updatedAt)}</span>
              </div>
              <div className="conv-preview">{c.lastMessagePreview ?? '—'}</div>
              <div className="conv-meta">
                <Pill tone={c.channel === 'whatsapp' ? 'ok' : 'lav'}>
                  {CHANNEL_LABEL[c.channel] ?? c.channel}
                </Pill>
                {c.mode === 'human' ? <Pill tone="rose">humano</Pill> : null}
                {c.mode === 'muted' ? <Pill tone="grey">silenciada</Pill> : null}
                {c.needsAttention ? <Pill tone="danger">atención</Pill> : null}
                {c.pendingReview && !c.pendingReview.resueltoEn ? (
                  <Pill tone="warn">consulta</Pill>
                ) : null}
                {c.unreadCount > 0 ? <Pill tone="warn">{c.unreadCount}</Pill> : null}
              </div>
            </button>
          ))
        )}
      </div>

      <div className="chat">
        {!detail ? (
          <>
            {/* Sin esta cabecera, entrar al chat antes de que cargue el detalle
                dejaba el celular sin ninguna forma de volver a la lista. */}
            <div className="chat-head chat-head-vacia">
              <button className="btn btn-sm btn-volver" onClick={() => setPanelMovil('lista')}>
                ← Volver
              </button>
            </div>
            <Empty glyph="🍰">Elegí una conversación de la lista.</Empty>
          </>
        ) : (
          <>
            <div className="chat-head">
              <button
                className="btn btn-sm btn-volver"
                onClick={() => setPanelMovil('lista')}
                aria-label="Volver a la lista de conversaciones"
              >
                ←
              </button>

              {/* Sin `style` en línea: la clase `.grow` ya trae min-width 0, y
                  un estilo en línea le gana a la hoja, así que impedía que la
                  media query le pusiera un mínimo en pantalla angosta. */}
              <div className="grow">
                <div className="row" style={{ gap: 7 }}>
                  <strong className="truncate">
                    {detail.contact?.fullName || detail.contact?.displayName || detail.conversation.externalId}
                  </strong>
                  <Pill tone={detail.conversation.channel === 'whatsapp' ? 'ok' : 'lav'}>
                    {CHANNEL_LABEL[detail.conversation.channel]}
                  </Pill>
                  {detail.contact?.isReturning ? <Pill tone="mint">cliente de años</Pill> : null}
                </div>
                {detail.conversation.needsAttention && detail.conversation.attentionReason ? (
                  <div className="small" style={{ color: 'var(--danger)', marginTop: 3 }}>
                    ⚠ {detail.conversation.attentionReason}
                  </div>
                ) : null}
              </div>

              {detail.conversation.mode === 'human' ? (
                <button className="btn btn-sm btn-primary" onClick={() => void setMode('bot')}>
                  Devolver al bot
                </button>
              ) : (
                <button className="btn btn-sm btn-rose" onClick={() => void setMode('human')}>
                  Tomar yo
                </button>
              )}
              <button
                className="btn btn-sm btn-ghost"
                title="El bot deja de responder y no se avisa"
                onClick={() => void setMode(detail.conversation.mode === 'muted' ? 'bot' : 'muted')}
              >
                {detail.conversation.mode === 'muted' ? '🔔' : '🔕'}
              </button>
              <button
                className="btn btn-sm btn-ficha"
                onClick={() => setFichaAbierta(true)}
                aria-expanded={fichaAbierta}
              >
                Ficha
              </button>
            </div>

            {/* Consulta de modificación sin contestar: lo único que el equipo
                tiene que decidir para que el bot pueda seguir. Va como franja
                propia y no dentro de .chat-head, que es un flex row y se rompe
                en pantalla angosta. */}
            {detail.conversation.pendingReview && !detail.conversation.pendingReview.resueltoEn ? (
              <div className="review-box">
                <div className="small">
                  <strong>
                    Consulta sin responder ({timeAgo(detail.conversation.pendingReview.abiertoEn)}):
                  </strong>{' '}
                  {detail.conversation.pendingReview.pedido} (
                  {detail.conversation.pendingReview.producto})
                  {detail.conversation.pendingReview.textoCliente
                    ? ` — "${detail.conversation.pendingReview.textoCliente}"`
                    : null}
                </div>
                <div className="review-acciones">
                  <button className="chip" onClick={() => setRespuesta('Sí, se puede.')}>
                    Se puede
                  </button>
                  <button
                    className="chip"
                    onClick={() =>
                      setRespuesta('No se puede, en estas fechas se produce todo en serie.')
                    }
                  >
                    No se puede
                  </button>
                  <input
                    className="grow"
                    value={respuesta}
                    onChange={(e) => setRespuesta(e.target.value)}
                    placeholder="Qué le contesta el bot, con tus palabras"
                  />
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={enviandoConsulta || !respuesta.trim()}
                    onClick={() => void responderConsulta()}
                  >
                    Enviar al bot
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    title="La consulta ya no aplica y la charla queda en tus manos"
                    onClick={() => void descartarConsulta()}
                  >
                    Descartar y sigo yo
                  </button>
                </div>
              </div>
            ) : null}

            <div className="chat-body" ref={bodyRef}>
              {detail.messages.map((m) => (
                <Bubble key={m.id} message={m} />
              ))}
              {typing ? <div className="typing">el bot está escribiendo…</div> : null}
            </div>

            <div className="chat-compose">
              {detail.suggestions.length ? (
                <div className="suggestions">
                  <span className="small muted" style={{ alignSelf: 'center' }}>
                    Sugeridos:
                  </span>
                  {detail.suggestions.map((s) => (
                    <button
                      key={s.key}
                      className="chip"
                      title={s.preview ?? s.body}
                      onClick={() => void useSuggestion(s.key)}
                    >
                      ⚡ {s.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="compose-row">
                <textarea
                  className="grow"
                  placeholder={
                    detail.conversation.mode === 'human'
                      ? 'Escribí como Miska Muska…'
                      : 'Escribí — al enviar, la conversación pasa a modo humano si querés seguir vos'
                  }
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <button
                  className="btn btn-primary"
                  disabled={sending || !draft.trim()}
                  onClick={() => void send()}
                >
                  {sending ? '…' : 'Enviar'}
                </button>
              </div>
              <div className="small muted" style={{ marginTop: 5 }}>
                Enter envía · Shift+Enter salta de línea
              </div>
            </div>
          </>
        )}
      </div>

      {fichaAbierta ? (
        <button
          className="rail-fondo"
          aria-label="Cerrar la ficha del cliente"
          onClick={() => setFichaAbierta(false)}
        />
      ) : null}

      <aside className="rail" data-abierta={fichaAbierta}>
        <button className="btn btn-sm rail-cierre" onClick={() => setFichaAbierta(false)}>
          Cerrar ✕
        </button>
        {detail ? <Rail detail={detail} onSaved={() => void loadDetail(detail.conversation.id)} toast={toast} /> : null}
      </aside>
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  const out = message.direction === 'out';
  const authorClass = out ? ` by-${message.author}` : '';
  /*
    Si el mensaje es una imagen, se muestra la imagen. Con solo el texto el
    operador leía "[imagen]" y no tenía forma de saber cuál mandó el bot.
  */
  const foto =
    message.contentKind === 'image'
      ? (message.payload as { url?: string } | null)?.url
      : undefined;

  return (
    <div className={`bubble ${out ? 'bubble-out' : 'bubble-in'}${authorClass}`}>
      {foto ? <img className="bubble-foto" src={foto} alt={message.text} /> : null}
      {foto ? message.text.replace(/^[imagen]s*/, '') : message.text}
      <div className="bubble-foot">
        <span>{clock(message.createdAt)}</span>
        {out ? (
          <span>
            {message.author === 'bot' ? '🤖 bot' : message.author === 'human' ? '👤 local' : '⚙️ sistema'}
          </span>
        ) : null}
        {message.intent && message.intent !== 'chat' ? <span>· {message.intent}</span> : null}
        {message.latencyMs ? <span>· {(message.latencyMs / 1000).toFixed(1)}s</span> : null}
        {message.inputTokens ? (
          <span
            title={
              `entrada ${message.inputTokens} · caché ${message.cacheReadTokens ?? 0} · ` +
              `salida ${message.outputTokens ?? 0}` +
              (message.model ? `\nmodelo: ${message.model}` : '')
            }
          >
            · {message.inputTokens + (message.outputTokens ?? 0)} tk
          </span>
        ) : null}
        {message.costUsd ? (
          <span title={message.model ?? undefined}>
            · ${message.costUsd < 0.01 ? message.costUsd.toFixed(4) : message.costUsd.toFixed(2)}
          </span>
        ) : null}
        {message.error ? <span className="bubble-error">· ⚠ {message.error}</span> : null}
      </div>
    </div>
  );
}

function Rail({
  detail,
  onSaved,
  toast,
}: {
  detail: ConversationDetail;
  onSaved: () => void;
  toast: (text: string) => void;
}) {
  const { contact, orders, conversation } = detail;
  const [notes, setNotes] = useState(contact?.notes ?? '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setNotes(contact?.notes ?? '');
    setDirty(false);
  }, [contact?.id, contact?.notes]);

  const save = async () => {
    if (!contact) return;
    try {
      await api.updateContact(contact.id, { notes });
      setDirty(false);
      onSaved();
      toast('Notas guardadas');
    } catch (err) {
      toast(`No pude guardar: ${String(err)}`);
    }
  };

  return (
    <>
      <div className="rail-block">
        <h4>Ficha del cliente</h4>
        <div className="kv"><span>Nombre</span><span>{contact?.fullName || contact?.displayName || '—'}</span></div>
        <div className="kv"><span>Teléfono</span><span>{contact?.phone ?? '—'}</span></div>
        <div className="kv"><span>DNI</span><span>{contact?.dni ?? '—'}</span></div>
        <div className="kv"><span>Canal</span><span>{CHANNEL_LABEL[conversation.channel]}</span></div>
        <div className="kv"><span>Primer contacto</span><span>{contact ? new Date(contact.firstSeenAt).toLocaleDateString('es-AR') : '—'}</span></div>
        {contact ? (
          <label className="switch" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={contact.isReturning}
              onChange={async (e) => {
                await api.updateContact(contact.id, { isReturning: e.target.checked });
                onSaved();
              }}
            />
            <span className="small">Cliente histórico (habilita excepciones)</span>
          </label>
        ) : null}
      </div>

      <div className="rail-block">
        <h4>Notas del CRM</h4>
        <textarea
          rows={5}
          value={notes}
          placeholder="Para quién es, la ocasión, preferencias…"
          onChange={(e) => {
            setNotes(e.target.value);
            setDirty(true);
          }}
        />
        {dirty ? (
          <button className="btn btn-sm btn-primary" style={{ marginTop: 6 }} onClick={() => void save()}>
            Guardar
          </button>
        ) : null}
      </div>

      <div className="rail-block">
        <h4>Pedidos de esta charla</h4>
        {orders.length === 0 ? (
          <p className="small muted">Todavía ninguno.</p>
        ) : (
          orders.map((o) => (
            <div key={o.id} className="card card-pad" style={{ marginBottom: 8, padding: '10px 12px' }}>
              <div className="row" style={{ gap: 6 }}>
                <strong className="small">#{o.number}</strong>
                <Pill tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Pill>
                <span className="grow" />
                <span className="small mono">{money(o.total)}</span>
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {o.items.map((i) => `${i.quantity}× ${i.description}`).join(', ')}
              </div>
              {o.deliveryDate ? (
                <div className="small muted">
                  {o.deliveryDate} {o.deliveryTime ?? ''}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </>
  );
}
