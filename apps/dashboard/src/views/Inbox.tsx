import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type CajonDeRespuestas,
  type Conversation,
  type ConversationDetail,
  type LiveEvent,
  type Contact,
  type Message,
  type Order,
  type Product,
  ultimaActividad,
} from '../api';
import { CHANNEL_LABEL, Empty, ORDER_STATUS_LABEL, ORDER_STATUS_TONE, Pill, clock, money, timeAgo } from '../ui';
import { ComandaPedido } from './Comanda';

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
    El buscador. Lo que se tipea y lo que contestó el servidor, por separado:
    mientras se escribe siguen viéndose los resultados anteriores, que es lo que
    hace que no parpadee la lista en cada tecla.

    La búsqueda va al servidor y no se filtra acá con lo que ya está cargado,
    porque la bandeja trae las últimas cien charlas y la que buscás es
    justamente la que no está a la vista. Y busca también adentro de los
    mensajes: el equipo se acuerda de "la que pidió la Kinder", no del apellido.
  */
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Conversation[] | null>(null);
  const [buscando, setBuscando] = useState(false);
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
  const [detalleCargado, setDetail] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState('');
  /** Lo que el equipo le contesta al bot sobre una modificación pedida. */
  const [respuesta, setRespuesta] = useState('');
  /** Bandera propia, para no deshabilitar también el botón de enviar mensaje. */
  const [enviandoConsulta, setEnviandoConsulta] = useState(false);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const composeRef = useRef<HTMLTextAreaElement | null>(null);
  /** Si quien mira está siguiendo el final de la charla o se fue a leer más arriba. */
  const pegadoAlFinal = useRef(true);
  /*
    El cajón de respuestas. Se pide una sola vez y recién cuando alguien lo
    abre: son los textos del equipo y todas las fotos que hay cargadas, y no
    tiene sentido traerlo en cada chat que se mira sin usarlo.
  */
  const [cajonAbierto, setCajonAbierto] = useState(false);
  const [cajon, setCajon] = useState<CajonDeRespuestas | null>(null);

  /*
    300 ms de espera antes de preguntar. Sin eso, "guadalupe" son nueve
    búsquedas y cada una es un scan de la tabla de mensajes contra un pool de
    cinco conexiones. El `cancelado` es para que una respuesta lenta de hace dos
    teclas no pise a la que corresponde a lo que hay escrito ahora.
  */
  useEffect(() => {
    const texto = busqueda.trim();
    if (texto.length < 2) {
      setResultados(null);
      setBuscando(false);
      return;
    }
    let cancelado = false;
    setBuscando(true);
    const timer = window.setTimeout(() => {
      api
        .conversations({ q: texto, limit: '60' })
        .then((lista) => {
          if (!cancelado) setResultados(lista);
        })
        .catch(() => {
          if (!cancelado) setResultados([]);
        })
        .finally(() => {
          if (!cancelado) setBuscando(false);
        });
    }, 300);
    return () => {
      cancelado = true;
      window.clearTimeout(timer);
    };
  }, [busqueda]);

  const visible = useMemo(() => {
    const list = (resultados ?? conversations).filter((c) => {
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
  }, [conversations, resultados, filter]);

  // Selección inicial: la primera que necesite atención, o la más reciente.
  useEffect(() => {
    if (selected || !visible.length) return;
    setSelected(visible.find((c) => c.needsAttention)?.id ?? visible[0].id);
  }, [visible, selected]);

  /*
    Lo que se muestra es el detalle SI Y SOLO SI es el de la charla elegida.

    La guarda de `loadDetail` evita que una respuesta atrasada pise a la buena,
    pero queda el hueco más común, que no es una carrera: los 400-600 ms entre
    el clic y la respuesta, en los que `detalleCargado` todavía es el de la
    charla anterior. En ese rato la pantalla mostraba la conversación de otra
    persona debajo de la cabecera nueva. Pasa en TODA apertura, no solo cuando
    algo sale mal.

    Derivado y no un estado más: un `setDetail(null)` al cambiar tendría el
    mismo efecto pero se puede olvidar en el próximo camino que cambie la
    selección. Esto no se puede desincronizar.
  */
  const detail = detalleCargado?.conversation.id === selected ? detalleCargado : null;

  /*
    Cuál es la charla elegida AHORA, para la respuesta que está por llegar.

    `loadDetail` no puede leer `selected` del closure —se recrearía en cada
    cambio y volvería a disparar todos los efectos que dependen de ella—, así
    que la respuesta se compara contra este ref.
  */
  const seleccionadaRef = useRef<string | null>(null);
  seleccionadaRef.current = selected;

  const loadDetail = useCallback(
    async (id: string, markRead = false) => {
      try {
        const data = await api.conversation(id);
        /*
          La guarda que evita escribirle a la persona equivocada.

          Entre el clic y la respuesta hay medio segundo de red. Si en ese rato
          se cambió de charla —a mano, o porque llegó un mensaje de otra— la
          respuesta vieja pisaba el detalle y quedaba en pantalla el CUERPO de
          una conversación con la cabecera y el botón de enviar de otra: el
          envío se calcula sobre `selected`, no sobre lo que se está leyendo.

          Es el único problema de esta lista que no se arregla apretando F5,
          porque para cuando te das cuenta el mensaje ya salió.
        */
        if (seleccionadaRef.current !== id) return;
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
    /*
      El borrador tampoco viaja de una charla a otra. Es la misma familia de
      error que la guarda de arriba: media frase escrita para una clienta,
      cargada y lista para enviar en la conversación de otra.
    */
    setDraft('');
    // El cartel de "el bot está escribiendo" es de la charla que dejamos: sin
    // esto quedaba pegado abajo de una conversación donde no pasaba nada.
    setTyping(false);
    // Y volvemos a seguir el final: la charla nueva se abre abajo de todo.
    pegadoAlFinal.current = true;
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

  /*
    Autoscroll al final cuando llegan mensajes, PERO solo si ya estabas abajo.

    Antes bajaba siempre, y además se disparaba con `typing`: cada vez que el
    bot empezaba o dejaba de escribir, a quien estaba leyendo más arriba —
    buscando qué le habían pedido, o releyendo un comprobante— la pantalla se
    le iba al fondo. En una charla tranquila molesta; en una ráfaga es
    imposible leer nada.
  */
  /*
    Se dispara con el ID del último mensaje, NO con cuántos hay.

    El servidor devuelve como mucho 200 (`history(id, 200)`), así que en una
    charla de una clienta de años la cuenta se clava en 200 para siempre: entra
    uno nuevo, sale el más viejo, y `length` no cambia. Con la longitud como
    disparador, el efecto dejaba de correr justo en las conversaciones más
    largas, y el hueco al fondo iba creciendo una burbuja por mensaje sin
    corregirse nunca. El id del último cambia siempre.
  */
  const ultimoMensaje = detail?.messages.at(-1)?.id;
  useEffect(() => {
    const el = bodyRef.current;
    if (el && pegadoAlFinal.current) el.scrollTop = el.scrollHeight;
  }, [ultimoMensaje, selected]);

  /** Se recalcula al scrollear: 120 px de tolerancia para no exigir el fondo exacto. */
  const alScrollear = () => {
    const el = bodyRef.current;
    if (el) pegadoAlFinal.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  /*
    Lo que sale de ESTE panel siempre se muestra.

    "Seguir el final solo si ya estabas abajo" vale para lo que llega de
    afuera. Para lo que manda uno mismo es al revés: el cuadro de escribir está
    siempre a la vista aunque la charla esté scrolleada arriba, así que se
    puede releer un comprobante, bajar el cursor al textarea y mandar sin
    volver a scrollear. Si ahí no bajamos, el borrador se vacía y no aparece
    ninguna burbuja: se lee como que el envío falló, y se manda de nuevo.
  */
  const seguirElFinal = () => {
    pegadoAlFinal.current = true;
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !selected) return;
    setSending(true);
    try {
      await api.sendMessage(selected, text);
      setDraft('');
      seguirElFinal();
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
      seguirElFinal();
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

  useEffect(() => {
    if (!cajonAbierto || cajon) return;
    api
      .cajonDeRespuestas()
      .then(setCajon)
      .catch(() => toast('No pude traer las respuestas rápidas'));
  }, [cajonAbierto, cajon, toast]);

  // Se cierra al cambiar de chat: dejarlo abierto tapa el principio de la charla
  // que se acaba de abrir.
  useEffect(() => setCajonAbierto(false), [selected]);

  /**
   * Un texto del equipo va al cuadro de escribir, NO al cliente.
   *
   * Es la diferencia con los sugeridos de arriba, que envían de una. El local
   * pidió poder editar antes de mandar, y tiene razón: el mismo texto sirve
   * para diez charlas justamente porque cada una le saca o le agrega un
   * renglón.
   */
  const ponerTexto = (texto: string) => {
    setDraft((actual) => (actual.trim() ? `${actual.trimEnd()}\n${texto}` : texto));
    setCajonAbierto(false);
    // En el siguiente frame: el textarea todavía no se re-renderizó con el texto.
    window.setTimeout(() => composeRef.current?.focus(), 0);
  };

  /** Una foto sí sale derecho: no hay nada que editarle. */
  const mandarFoto = async (url: string, label: string) => {
    if (!selected) return;
    setCajonAbierto(false);
    try {
      await api.sendPhoto(selected, url, draft.trim() || undefined);
      setDraft('');
      seguirElFinal();
      await loadDetail(selected);
    } catch (err) {
      toast(`No se pudo mandar ${label}: ${String(err)}`);
    }
  };

  const useSuggestion = async (key: string) => {
    if (!selected) return;
    try {
      await api.sendQuickReply(selected, key);
      seguirElFinal();
      await loadDetail(selected);
      toast('Mensaje rápido enviado');
    } catch (err) {
      toast(`No se pudo enviar: ${String(err)}`);
    }
  };

  return (
    <div className="inbox" data-panel={panelMovil}>
      <div className="inbox-list">
        {/* Buscador y filtros van juntos en una cabecera pegada arriba: si el
            buscador se fuera scrolleando, buscar entre cien charlas obligaría a
            volver al principio de la lista para escribir. */}
        <div className="inbox-cabecera">
        <div className="inbox-buscador">
          <input
            className="grow"
            type="search"
            value={busqueda}
            placeholder="Buscar por nombre, teléfono o algo que se dijo…"
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setBusqueda('');
            }}
          />
          {busqueda ? (
            <button
              className="btn btn-sm btn-ghost"
              aria-label="Limpiar la búsqueda"
              onClick={() => setBusqueda('')}
            >
              ✕
            </button>
          ) : null}
        </div>

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
        </div>

        {resultados ? (
          <div className="small muted" style={{ padding: '8px 12px 2px' }}>
            {buscando
              ? 'Buscando…'
              : `${visible.length} ${visible.length === 1 ? 'charla' : 'charlas'} con "${busqueda.trim()}"`}
          </div>
        ) : null}

        {visible.length === 0 ? (
          <Empty glyph={resultados ? '🔍' : '💬'}>
            {resultados
              ? buscando
                ? 'Buscando…'
                : 'Ninguna charla con eso. Probá con el nombre, el número o una palabra que se haya dicho adentro.'
              : conversations.length === 0
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
                {/* La hora de la ÚLTIMA ACTIVIDAD, no la de la última vez que se
                    tocó la fila: `updatedAt` lo bumpean marcar como leída, tomar
                    la charla y cerrar una consulta, así que decía "hace 1 min"
                    de una charla donde nadie había escrito nada. */}
                <span className="conv-time">{timeAgo(new Date(ultimaActividad(c)).toISOString())}</span>
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
            <Empty glyph={selected ? '⏳' : '🍰'}>
              {selected ? 'Abriendo la charla…' : 'Elegí una conversación de la lista.'}
            </Empty>
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

            <div className="chat-body" ref={bodyRef} onScroll={alScrollear}>
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

              {cajonAbierto ? (
                <Cajon
                  cajon={cajon}
                  onTexto={ponerTexto}
                  onFoto={(url, label) => void mandarFoto(url, label)}
                  onCerrar={() => setCajonAbierto(false)}
                />
              ) : null}

              <div className="compose-row">
                <button
                  className="btn btn-ghost btn-cajon"
                  aria-pressed={cajonAbierto}
                  title="Textos y fotos guardadas"
                  onClick={() => setCajonAbierto((v) => !v)}
                >
                  ⚡
                </button>
                <textarea
                  ref={composeRef}
                  className="grow"
                  placeholder={
                    detail.conversation.mode === 'human'
                      ? 'Escribí como Miska Muska…'
                      : 'Escribí — el bot sigue respondiendo; si querés seguir vos, tomá la conversación'
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

/**
 * El cajón de respuestas: lo que una persona puede mandar con un clic cuando
 * toma la charla.
 *
 * Dos cosas y no una, porque el equipo contesta con las dos: textos pulidos por
 * años de atención, y fotos. El texto va al cuadro de escribir para poder
 * editarlo; la foto sale derecho, que no hay nada que editarle.
 *
 * El buscador mira también adentro del texto y no solo el título: nadie se
 * acuerda de que el mensaje se llama "uber", se acuerda de que en algún lado
 * dice "ponele PIN al viaje".
 */
function Cajon({
  cajon,
  onTexto,
  onFoto,
  onCerrar,
}: {
  cajon: CajonDeRespuestas | null;
  onTexto: (texto: string) => void;
  onFoto: (url: string, label: string) => void;
  onCerrar: () => void;
}) {
  const [solapa, setSolapa] = useState<'textos' | 'fotos'>('textos');
  const [filtro, setFiltro] = useState('');
  const buscar = filtro.trim().toLowerCase();

  const textos = (cajon?.textos ?? []).filter(
    (t) =>
      !buscar ||
      t.label.toLowerCase().includes(buscar) ||
      t.key.toLowerCase().includes(buscar) ||
      t.preview.toLowerCase().includes(buscar),
  );
  const fotos = (cajon?.fotos ?? []).filter(
    (f) =>
      !buscar || f.label.toLowerCase().includes(buscar) || f.grupo.toLowerCase().includes(buscar),
  );

  return (
    <div className="cajon">
      <div className="cajon-barra">
        <button
          className="chip"
          aria-pressed={solapa === 'textos'}
          onClick={() => setSolapa('textos')}
        >
          Textos
        </button>
        <button
          className="chip"
          aria-pressed={solapa === 'fotos'}
          onClick={() => setSolapa('fotos')}
        >
          Fotos
        </button>
        <input
          className="grow"
          autoFocus
          value={filtro}
          placeholder="Buscar…"
          onChange={(e) => setFiltro(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCerrar();
          }}
        />
        <button className="btn btn-sm btn-ghost" onClick={onCerrar} aria-label="Cerrar">
          ✕
        </button>
      </div>

      {!cajon ? (
        <div className="small muted cajon-vacio">Trayendo las respuestas…</div>
      ) : solapa === 'textos' ? (
        textos.length ? (
          <div className="cajon-lista">
            {textos.map((t) => (
              <button key={t.key} className="cajon-texto" onClick={() => onTexto(t.preview)}>
                <strong>{t.label}</strong>
                <span className="small muted">{t.preview}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="small muted cajon-vacio">
            Ningún texto con eso. Los mensajes se cargan y se editan en Rápidos.
          </div>
        )
      ) : fotos.length ? (
        <div className="cajon-fotos">
          {fotos.map((f) => (
            <button
              key={f.id}
              className="cajon-foto"
              title={`${f.label} — se manda al toque`}
              onClick={() => onFoto(f.url, f.label)}
            >
              <img src={f.url} alt={f.label} loading="lazy" decoding="async" />
              <span className="small">{f.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="small muted cajon-vacio">
          Ninguna foto con eso. Las fotos salen del Catálogo, de los Cursos y de la carta.
        </div>
      )}
    </div>
  );
}

/** Los tipos de mensaje que traen un archivo colgado. */
const TRAE_ARCHIVO = ['image', 'document', 'audio'];

/**
 * Lo que el mensaje trae colgado, si es que trae algo.
 *
 * Son TRES estados y no dos, que es la diferencia entre servir y estorbar:
 *
 *  - con `url`, el archivo, que es lo normal;
 *  - con `mediaError`, el aviso de que no se pudo bajar. El servidor lo escribe
 *    siempre que la descarga se cae, así que este cartel aparece solo cuando de
 *    verdad no va a llegar nada;
 *  - sin ninguna de las dos y recién llegado, "bajando". Se limita al primer
 *    minuto: pasado eso, un mensaje sin archivo y sin motivo es uno viejo, de
 *    antes de que esto existiera, y decirle "bajando" sería mentira.
 */
function Adjunto({ message }: { message: Message }) {
  const kind = message.contentKind;

  /*
    Una ubicación compartida. No es un archivo: WhatsApp manda coordenadas, y
    hasta acá el panel las mostraba como "[ubicación -26.83,-65.20]", que para
    quien tiene que llevar un pedido no dice absolutamente nada.

    El link no se abre solo ni se pide ningún mapa desde el panel: es un enlace
    que el operador aprieta si lo necesita. La dirección de una clienta no sale
    de acá hasta que alguien decide abrirla.
  */
  if (kind === 'location') {
    const p = message.payload as
      | { latitude?: number; longitude?: number; name?: string; address?: string }
      | null;
    if (typeof p?.latitude !== 'number' || typeof p?.longitude !== 'number') return null;
    const coords = `${p.latitude},${p.longitude}`;
    return (
      <a
        className="bubble-archivo"
        href={`https://www.google.com/maps?q=${coords}`}
        target="_blank"
        rel="noreferrer"
        title="Abrir la ubicación en el mapa"
      >
        📍 {p.name || p.address || 'Ubicación compartida'}
        <span className="small muted"> · {coords}</span>
      </a>
    );
  }

  if (!TRAE_ARCHIVO.includes(kind)) return null;

  const payload = message.payload as
    | { url?: string; filename?: string; voice?: boolean; mediaError?: string }
    | null;
  const url = payload?.url;
  const glifo = kind === 'image' ? '📷' : kind === 'audio' ? '🎤' : '📎';

  if (!url) {
    const reciente = Date.now() - new Date(message.createdAt).getTime() < 60_000;
    if (payload?.mediaError || !reciente) {
      return (
        <div className="bubble-sin-archivo" title={payload?.mediaError}>
          ⚠ {glifo} no pudimos guardar el archivo — miralo en el celular
        </div>
      );
    }
    return (
      <div className="small muted" style={{ marginBottom: 4 }}>
        {glifo} bajando el archivo…
      </div>
    );
  }

  if (kind === 'image') {
    // El link abre la foto entera: un CBU no se lee en una miniatura de 260 px.
    return (
      <a href={url} target="_blank" rel="noreferrer" title="Abrir la foto en grande">
        {/*
          `lazy`: cada foto sale de la base por una de las cinco conexiones que
          comparte con el bot. Sin esto, abrir una charla con seis comprobantes
          disparaba las seis descargas de golpe, en paralelo con las consultas
          del propio detalle, y se trababa todo —la bandeja y el bot que estaba
          contestándole a otra persona— hasta que terminaban de bajar.
        */}
        <img
          className={`bubble-foto${message.direction === 'in' ? ' bubble-foto-entera' : ''}`}
          src={url}
          alt={message.text}
          loading="lazy"
          decoding="async"
        />
      </a>
    );
  }

  if (kind === 'audio') {
    // Controles nativos: el operador necesita escucharlo, no una forma de onda.
    return <audio className="bubble-audio" src={url} controls preload="none" />;
  }

  return (
    <a className="bubble-archivo" href={url} target="_blank" rel="noreferrer">
      📎 {payload?.filename ?? 'abrir el archivo'}
    </a>
  );
}

/**
 * Quita el "[imagen]" / "[archivo]" del texto, que es una etiqueta que puso el
 * servidor y no algo que haya escrito el cliente.
 *
 * Solo se aplica cuando el archivo se ve. Si no se pudo bajar, el texto queda
 * entero: el nombre del PDF puede ser lo único que le quede al operador.
 */
export const sinEtiquetaDeAdjunto = (text: string) =>
  text.replace(/^\[(imagen|archivo[^\]]*|audio|mensaje de voz|ubicación[^\]]*)\]\s*/i, '');

function Bubble({ message }: { message: Message }) {
  const out = message.direction === 'out';
  const authorClass = out ? ` by-${message.author}` : '';
  /*
    Se calcula acá y no se deduce del componente: `<Adjunto/>` es un elemento
    JSX y siempre es truthy, aunque el componente devuelva null. Con esa forma,
    el ternario del texto tomaba SIEMPRE la primera rama y le recortaba la
    etiqueta a todos los mensajes.
  */
  const payload = message.payload as { url?: string; latitude?: number } | null;
  const archivoALaVista =
    (TRAE_ARCHIVO.includes(message.contentKind) && Boolean(payload?.url)) ||
    (message.contentKind === 'location' && typeof payload?.latitude === 'number');

  return (
    <div className={`bubble ${out ? 'bubble-out' : 'bubble-in'}${authorClass}`}>
      <Adjunto message={message} />
      {archivoALaVista ? sinEtiquetaDeAdjunto(message.text) : message.text}
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
  /* La comanda del pedido que se está mirando, abierta desde la ficha. */
  const [comanda, setComanda] = useState<string | null>(null);
  /* El formulario de cargar un pedido a mano, cuando la venta la cerro una persona. */
  const [cargando, setCargando] = useState(false);
  const [notes, setNotes] = useState(contact?.notes ?? '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setNotes(contact?.notes ?? '');
    setDirty(false);
  }, [contact?.id, contact?.notes]);

  const abierto = orders.find((o) => o.id === comanda) ?? null;

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
              <button
                className="btn btn-sm btn-ghost"
                style={{ marginTop: 6 }}
                title="Ver la comanda: todo lo que sabemos de este pedido"
                onClick={() => setComanda(o.id)}
              >
                Comanda
              </button>
            </div>
          ))
        )}

        {/*
          La salida para las ventas que cierra una persona. La mitad de los
          pedidos que se perdían son estos: el bot escala o el equipo escribe en
          el chat, y desde ahí el bot ya no puede cargar nada — pero el panel
          tampoco podía, así que la venta no tenía forma de entrar.
        */}
        <button
          className="btn btn-sm btn-primary"
          style={{ marginTop: 4 }}
          onClick={() => setCargando(true)}
        >
          + Cargar pedido a mano
        </button>
      </div>

      {cargando ? (
        <CargarPedido
          conversation={conversation}
          contact={contact}
          yaHay={orders}
          onCerrar={() => setCargando(false)}
          onCargado={() => {
            setCargando(false);
            onSaved();
            toast('Pedido cargado');
          }}
          toast={toast}
        />
      ) : null}

      {abierto ? (
        <ComandaPedido pedido={abierto} onCerrar={() => setComanda(null)} toast={toast} />
      ) : null}
    </>
  );
}

/** Una línea del pedido que se está cargando a mano. */
interface LineaNueva {
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
}

/**
 * Cargar un pedido a mano desde la charla.
 *
 * Deliberadamente NO valida como `crear_pedido`. Esa validación es todo-o-nada
 * y está pensada para frenar al bot, que puede inventar; acá del otro lado hay
 * una persona que tiene la conversación a la vista y sabe lo que vendió. Si le
 * pidiéramos la hora de retiro para algo que se entregó hace diez minutos, no
 * lo cargaría nadie y volveríamos al problema.
 *
 * Lo único que se exige es un nombre y una línea con precio: sin eso no es un
 * pedido, es una nota.
 */
function CargarPedido({
  conversation,
  contact,
  yaHay,
  onCerrar,
  onCargado,
  toast,
}: {
  conversation: Conversation;
  contact: Contact | null;
  yaHay: Order[];
  onCerrar: () => void;
  onCargado: () => void;
  toast: (text: string) => void;
}) {
  const [nombre, setNombre] = useState(contact?.fullName || contact?.displayName || '');
  const [telefono, setTelefono] = useState(contact?.phone ?? '');
  const [lineas, setLineas] = useState<LineaNueva[]>([
    { productId: null, description: '', quantity: 1, unitPrice: 0 },
  ]);
  const [modo, setModo] = useState<Order['deliveryMode']>('retira-local');
  const [dia, setDia] = useState(new Date().toISOString().slice(0, 10));
  const [hora, setHora] = useState('');
  const [direccion, setDireccion] = useState('');
  const [notas, setNotas] = useState('');
  const [cobrado, setCobrado] = useState(true);
  const [productos, setProductos] = useState<Product[]>([]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api
      .products()
      .then(setProductos)
      .catch(() => undefined);
  }, []);

  const total = lineas.reduce((suma, l) => suma + l.quantity * l.unitPrice, 0);
  const listo = nombre.trim().length >= 3 && total > 0;

  const cambiar = (i: number, patch: Partial<LineaNueva>) =>
    setLineas((prev) => prev.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  /** Elegir del catálogo llena descripción y precio; después se pueden editar. */
  const elegirProducto = (i: number, id: string) => {
    const p = productos.find((x) => x.id === id);
    if (!p) {
      cambiar(i, { productId: null });
      return;
    }
    cambiar(i, { productId: p.id, description: p.name, unitPrice: p.price });
  };

  const guardar = async () => {
    if (!listo || guardando) return;
    setGuardando(true);
    try {
      await api.crearPedido({
        conversationId: conversation.id,
        contactId: conversation.contactId,
        customerName: nombre.trim(),
        customerPhone: telefono.trim() || null,
        items: lineas
          .filter((l) => l.description.trim() && l.unitPrice > 0)
          .map((l) => ({ ...l, description: l.description.trim() })),
        total,
        paid: cobrado ? total : 0,
        // Cobrado = confirmado. Es lo que significa en el mostrador: la plata
        // está y el pedido va a producción.
        status: cobrado ? 'confirmado' : 'borrador',
        deliveryMode: modo,
        deliveryDate: dia || null,
        deliveryTime: hora.trim() || null,
        address: modo === 'cadete-miska' ? direccion.trim() || null : null,
        notes: notas.trim() || null,
      });
      onCargado();
    } catch (err) {
      toast(`No pude cargar el pedido: ${String(err)}`);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="foto-fondo" onClick={onCerrar}>
      <div className="pedido-dialogo card card-pad" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3 className="grow" style={{ margin: 0 }}>
            Cargar pedido a mano
          </h3>
          <button className="btn btn-sm btn-ghost" onClick={onCerrar}>
            ✕
          </button>
        </div>

        {/* El aviso que evita el duplicado: la venta puede haberla cargado el
            bot y estar acá arriba sin que nadie la haya mirado. */}
        {yaHay.length ? (
          <div className="aviso-duplicado small">
            ⚠ Esta charla ya tiene {yaHay.length === 1 ? 'un pedido' : `${yaHay.length} pedidos`}:{' '}
            {yaHay.map((o) => `#${o.number} (${money(o.total)})`).join(', ')}. Fijate que no sea
            el mismo antes de cargar otro.
          </div>
        ) : null}

        <div className="grid-2" style={{ gap: 10, marginTop: 10 }}>
          <label className="label">
            Nombre y apellido
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </label>
          <label className="label">
            Teléfono
            <input value={telefono} onChange={(e) => setTelefono(e.target.value)} />
          </label>
        </div>

        <h4 style={{ margin: '14px 0 6px' }}>Qué lleva</h4>
        {lineas.map((l, i) => (
          <div key={i} className="linea-pedido">
            <select
              value={l.productId ?? ''}
              onChange={(e) => elegirProducto(i, e.target.value)}
              title="Elegí del catálogo, o dejá 'otro' y escribilo a mano"
            >
              <option value="">otro…</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ${p.price.toLocaleString('es-AR')}
                </option>
              ))}
            </select>
            <input
              className="grow"
              placeholder="Qué es"
              value={l.description}
              onChange={(e) => cambiar(i, { description: e.target.value, productId: null })}
            />
            <input
              type="number"
              min={1}
              title="Cantidad"
              value={l.quantity}
              onChange={(e) => cambiar(i, { quantity: Math.max(1, Number(e.target.value)) })}
              style={{ width: 62 }}
            />
            <input
              type="number"
              min={0}
              title="Precio por unidad"
              value={l.unitPrice || ''}
              placeholder="$"
              onChange={(e) => cambiar(i, { unitPrice: Math.max(0, Number(e.target.value)) })}
              style={{ width: 96 }}
            />
            {lineas.length > 1 ? (
              <button
                className="btn btn-sm btn-ghost"
                aria-label="Sacar esta línea"
                onClick={() => setLineas((prev) => prev.filter((_, n) => n !== i))}
              >
                ✕
              </button>
            ) : null}
          </div>
        ))}
        <button
          className="btn btn-sm btn-ghost"
          onClick={() =>
            setLineas((prev) => [
              ...prev,
              { productId: null, description: '', quantity: 1, unitPrice: 0 },
            ])
          }
        >
          + otra cosa
        </button>

        <div className="row" style={{ marginTop: 12, gap: 10 }}>
          <strong className="grow">Total: {money(total)}</strong>
          <label className="row small" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={cobrado}
              onChange={(e) => setCobrado(e.target.checked)}
            />
            ya está pago
          </label>
        </div>

        <div className="grid-2" style={{ gap: 10, marginTop: 12 }}>
          <label className="label">
            Cómo lo recibe
            <select value={modo} onChange={(e) => setModo(e.target.value as Order['deliveryMode'])}>
              <option value="retira-local">Retira en el local</option>
              <option value="uber-cliente">Lo retira un Uber o cadete suyo</option>
              <option value="cadete-miska">Se lo llevamos nosotros</option>
            </select>
          </label>
          <div className="row" style={{ gap: 8 }}>
            <label className="label grow">
              Día
              <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
            </label>
            <label className="label" style={{ width: 96 }}>
              Hora
              <input
                placeholder="19:30"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
              />
            </label>
          </div>
        </div>

        {modo === 'cadete-miska' ? (
          <label className="label" style={{ marginTop: 10 }}>
            Dirección con alguna referencia
            <input value={direccion} onChange={(e) => setDireccion(e.target.value)} />
          </label>
        ) : null}

        <label className="label" style={{ marginTop: 10 }}>
          Notas para cocina
          <textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
        </label>

        <div className="row" style={{ marginTop: 14 }}>
          <span className="small muted grow">
            Queda cargado como hecho por una persona, así que el bot no lo toca.
          </span>
          <button className="btn btn-ghost" onClick={onCerrar}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={!listo || guardando} onClick={() => void guardar()}>
            {guardando ? 'Cargando…' : 'Cargar pedido'}
          </button>
        </div>
      </div>
    </div>
  );
}
