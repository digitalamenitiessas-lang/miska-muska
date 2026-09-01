/**
 * Orquestación: entrada → procesamiento → salida.
 *
 * Dos detalles que cambian mucho la sensación de la conversación:
 *
 *  - DEBOUNCE. La gente escribe "hola" / "queria consultar" / "por una torta" en
 *    tres mensajes seguidos. Responder cada uno es la marca registrada de un
 *    bot. Se espera una ventana corta y se contesta a todo junto.
 *
 *  - MUTEX por conversación. Sin esto, dos mensajes casi simultáneos disparan
 *    dos turnos de modelo en paralelo que se pisan y duplican respuestas.
 *
 * Los dos viven en memoria, y por eso el bot corre en UNA sola instancia. Si
 * alguna vez hay que escalar, el mutex pasa a `pg_advisory_lock` y el debounce a
 * una tabla con `run_after`.
 *
 * `core/` no importa nada de `channels/`: el adapter llega por inyección.
 */

import type { ChannelAdapter } from '../types/channel.js';
import type { Repositories } from '../store/repositories.js';
import { bus, log } from '../events/bus.js';
import { config } from '../../config.js';
import type { Conversation, ConversationMode, StoredMessage } from '../types/domain.js';
import type {
  ChannelId,
  InboundContent,
  InboundMessage,
  OutboundContent,
} from '../types/message.js';
import { isOutsideBusinessHours } from '../policies/rules.js';
import { localToday } from '../store/db.js';
import { agotadosConPrecio, preciosQueNoCoinciden } from '../policies/precios.js';
import { prometeEnvioGratis, TEXTO_ENVIO_SE_COBRA } from '../policies/envios.js';
import { renderQuickReply } from '../agent/persona.js';
import { runTurn } from '../agent/brain.js';
import type { ToolContext } from '../agent/tools.js';
import { ingest } from './ingress.js';
import { route } from './router.js';
import { deliver, typingDelay } from './egress.js';

export type AdapterResolver = (channel: ChannelId) => ChannelAdapter | undefined;

/** Ventana de espera para juntar mensajes seguidos del mismo cliente. */
const DEBOUNCE_MS = 1500;

/*
  Adjuntos entrantes que se bajan y se guardan.

  Están los tres que el local necesita mirar: la foto del comprobante, el PDF de
  una transferencia, y el audio de quien prefiere hablar antes que escribir. NO
  están el video ni el sticker, y es a propósito: el sticker no aporta nada y un
  video de 8 MB por mensaje llena la base rápido, que en esta instalación es un
  Postgres chico y compartido. El día que haga falta, se agregan acá.
*/
type AdjuntoGuardable = Extract<InboundContent, { kind: 'image' | 'document' | 'audio' }>;

const seGuarda = (c: InboundContent): c is AdjuntoGuardable =>
  c.kind === 'image' || c.kind === 'document' || c.kind === 'audio';

/*
  Techo por archivo. WhatsApp acepta documentos de hasta 100 MB: sin tope, uno
  solo entra a memoria y después a una columna de Postgres. Ocho megas cubren
  cualquier comprobante y cualquier audio largo.
*/
const MAX_ADJUNTO_BYTES = 8 * 1024 * 1024;

/*
  Techo diario por charla. Un comprobante pesa menos de un mega, así que veinte
  son un día muy cargado de una clienta muy indecisa. Pasado eso, el que manda ya
  no está mandando comprobantes.
*/
const MAX_ADJUNTOS_POR_CHARLA_DIA = 20 * 1024 * 1024;

/*
  Descargas simultáneas. Cada una tiene el archivo entero en memoria mientras
  dura, así que el peor caso de RAM es este número por el tope de arriba.
*/
const MAX_DESCARGAS_A_LA_VEZ = 3;

/*
  Tipos que se guardan tal cual. Cualquier otra cosa queda como binario a secas.

  El tipo lo declara quien manda el mensaje, no nosotros, y estos archivos se
  sirven desde nuestro dominio. Sin esta lista, alguien puede mandar un archivo
  diciendo que es `text/html` o `image/svg+xml` —un SVG puede traer script— y
  quedarse con una página ejecutable alojada en el dominio del bot. Guardarlo como
  binario lo vuelve inofensivo: el navegador lo baja en vez de abrirlo.
*/
const TIPOS_CONOCIDOS = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'application/pdf',
  'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/wav', 'audio/webm',
]);

/** El tipo declarado, si lo conocemos; si no, binario a secas. */
const tipoSeguro = (declarado: string | undefined): string => {
  const limpio = (declarado ?? '').split(';')[0].trim().toLowerCase();
  return TIPOS_CONOCIDOS.has(limpio) ? limpio : 'application/octet-stream';
};

interface SendOptions {
  author: 'bot' | 'human' | 'system';
  intent?: string;
  handler?: string;
  quickReplyKey?: string;
  metrics?: Parameters<typeof deliver>[0]['metrics'];
  humanize?: boolean;
}

export class Pipeline {
  #repos: Repositories;
  #resolve: AdapterResolver;
  #pending = new Map<string, NodeJS.Timeout>();
  #running = new Set<string>();
  #errorStreak = new Map<string, number>();
  /*
    Último mensaje entrante que un turno ya LEYÓ y contestó, por conversación.
    No necesita limpieza: una entrada vieja solo puede volver a coincidir con el
    mismo id de mensaje, y ese id no vuelve a llegar nunca. Crece como
    #errorStreak y por la misma razón: el bot corre en una sola instancia. Cuando
    haya que escalar, esto se muda a una columna junto con el mutex.
  */
  #answered = new Map<string, string>();
  /*
    Conversaciones que tienen que correr un turno aunque el último entrante ya
    esté contestado: el equipo respondió una consulta y el bot le debe esa
    respuesta al cliente. Es un permiso y no un borrado de la marca porque el
    turno que estaba en vuelo la reescribe al terminar, y ahí el permiso se
    perdía sin que nadie se enterara.
  */
  #forzar = new Set<string>();
  /*
    Cuándo el operador devolvió cada charla al bot. Vive en memoria por la misma
    razón que #answered y #errorStreak: el bot corre en una sola instancia. Se
    compara contra el arranque del turno, para que un turno que ya estaba en
    vuelo no le pise la decisión al operador.
  */
  #devueltaAlBot = new Map<string, number>();
  /** Descargas de adjuntos en vuelo. Ver MAX_DESCARGAS_A_LA_VEZ. */
  #bajando = 0;

  constructor(repos: Repositories, resolveAdapter: AdapterResolver) {
    this.#repos = repos;
    this.#resolve = resolveAdapter;
  }

  /** Punto de entrada único desde cualquier canal. */
  async handleInbound(inbound: InboundMessage): Promise<void> {
    const result = await ingest(this.#repos, inbound);
    if (!result) return;

    const { conversation, stored } = result;

    /*
      Sin await: la descarga no tiene que demorar ni la respuesta del bot ni el
      200 que el canal está esperando.
    */
    void this.#guardarAdjunto(conversation, stored);
    void this.#avisarSiEsComprobante(conversation, stored);
    // `payload` viene de una columna jsonb: ya es un objeto, no hay que parsearlo.
    const content = (stored.payload ?? { kind: 'text', text: '' }) as InboundContent;
    const decision = await route({ repos: this.#repos, conversation, content });

    if (decision.kind === 'ignore') {
      log('info', `Sin respuesta automática (${conversation.id}): ${decision.reason}`);
      return;
    }

    const adapter = this.#resolve(conversation.channel);
    if (adapter?.markRead && inbound.channelMessageId) {
      adapter
        .markRead(inbound.channelMessageId, {
          channel: conversation.channel,
          externalId: conversation.externalId,
        })
        .catch(() => undefined);
    }

    if (decision.kind === 'quick-reply') {
      const [settings, products] = await Promise.all([
        this.#repos.settings.read(),
        this.#repos.products.list(),
      ]);
      const text = renderQuickReply(decision.quickReply.body, settings, products);
      await this.#repos.quickReplies.countUse(decision.quickReply.key);
      /*
        Este entrante ya quedó contestado. No se cancela el timer pendiente: si
        llega un mensaje NUEVO, ese turno tiene que correr igual.
      */
      this.#answered.set(conversation.id, stored.id);
      await this.#send(conversation.id, [{ kind: 'text', text }], {
        author: 'bot',
        intent: 'mensaje_rapido',
        handler: 'quick-reply',
        quickReplyKey: decision.quickReply.key,
      });
      return;
    }

    this.#scheduleAgentTurn(conversation.id);
  }

  /**
   * Marca la charla cuando entra una foto y hay algo esperando que se pague.
   *
   * El bot no ve la imagen y no puede decir si eso es de verdad un comprobante
   * ni si el monto está bien: eso lo mira una persona y lo confirma con el
   * botón del panel. Pero hasta acá el aviso no existía: la foto entraba, el
   * bot contestaba "lo estamos chequeando", y la conversación quedaba igual que
   * cualquier otra. Si nadie la abría, el pedido se quedaba en borrador y la
   * plata sin registrar — o peor, salía sin que nadie hubiera mirado nada.
   *
   * No toca el modo: el bot sigue atendiendo. Lo único que hace es prender la
   * marca de atención, que es lo que ordena la bandeja.
   */
  async #avisarSiEsComprobante(
    conversation: Conversation,
    stored: StoredMessage,
  ): Promise<void> {
    const contenido = stored.payload as InboundContent | null;
    // Un audio no es un comprobante, y un sticker menos.
    if (!contenido || (contenido.kind !== 'image' && contenido.kind !== 'document')) return;

    try {
      /*
        Solo se avisa si hay algo esperando plata. Una foto suelta —la torta que
        vio en Instagram, la referencia de un color— no tiene por qué interrumpir
        a nadie, y avisar por todas es la forma de que dejen de mirar los avisos.
      */
      const [pedidos, inscripciones] = await Promise.all([
        this.#repos.orders.list({ conversationId: conversation.id, limit: 5 }),
        this.#repos.courses.pendientesDePagoEn(conversation.id),
      ]);

      const pedidoSinCobrar = pedidos.find(
        (p) => p.status !== 'cancelado' && p.total > 0 && p.paid < p.total,
      );
      const inscripcion = inscripciones[0];

      /*
        El tercer caso, y es el que faltaba: llegó una foto, se había pasado el
        alias, y NO hay ningún pedido ni inscripción a la que colgarla.

        Era el agujero exacto: el aviso estaba apagado justo en las charlas
        rotas. Si la venta la cerró una persona en el chat, o si el bot dijo
        "anotado" sin llamar a la herramienta, no hay fila esperando plata — y
        entonces el comprobante entraba en silencio y la venta no aparecía en
        ningún lado. Se descubrieron a mano, revisando: en diez días había diez
        ventas cobradas y varias ya entregadas sin registrar.

        Por qué el alias y no un precio: se midió contra las diez ventas reales
        y las seis fotos que no eran comprobantes. El alias acertó las nueve que
        podía acertar y no se encendió ni una vez de más. El precio también
        acertaba nueve, pero se prendía con dos fotos que no eran comprobantes
        —el bot pasa listas de precios todo el tiempo—, y un aviso que se
        enciende de gusto es un aviso que dejan de mirar.

        La que no alcanza a agarrar es la venta que se tomó fuera de esta
        charla: si el alias nunca se dijo acá, no hay señal. Para esa está el
        botón de cargar el pedido a mano.
      */
      let ventaSinFila = false;
      if (!pedidoSinCobrar && !inscripcion) {
        ventaSinFila = await this.#pasamosElAlias(conversation.id, stored.id);
        if (!ventaSinFila) return;
      }

      const motivo = pedidoSinCobrar
        ? `[comprobante] Mandó una foto y el pedido ${pedidoSinCobrar.number} está sin cobrar ` +
          `(${pedidoSinCobrar.paid} de ${pedidoSinCobrar.total}). Miralo y confirmá el pago.`
        : inscripcion
          ? `[comprobante] Mandó una foto y la inscripción de ${inscripcion.fullName} está ` +
            'pendiente de pago. Miralo y confirmá la inscripción.'
          : '[comprobante] Mandó una foto después de que le pasamos el alias, y esta charla NO ' +
            'tiene ningún pedido cargado. Revisala: si la venta se cerró, cargala con el botón ' +
            'de la ficha, que si no queda cobrada y sin registrar en ningún lado.';

      await this.#repos.conversations.setAttention(conversation.id, true, motivo);
      const refrescada = await this.#repos.conversations.get(conversation.id);
      if (refrescada) bus.emit({ type: 'conversation', conversation: refrescada });
      log('info', `Comprobante a la vista (${conversation.id}): ${motivo}`);
    } catch (err) {
      // Que falle el aviso no puede tumbar el mensaje, que ya está guardado.
      log('error', `No pude marcar el comprobante de ${conversation.id}`, err);
    }
  }

  /**
   * ¿Le pasamos el alias a esta persona antes de que mandara esto?
   *
   * Es la señal de "acá se estaba por cobrar". Mira los salientes, sean del bot
   * o de una persona del local —las ventas que cierra el equipo a mano son
   * justamente la mitad de los casos que se perdían—, y solo los anteriores al
   * mensaje que llegó, para que el propio "gracias, lo chequeamos" no cuente.
   *
   * Los dos alias, el de pedidos y el de cursos. Con un piso de cuatro letras
   * para no buscar una cadena tan corta que aparezca sola en cualquier texto.
   *
   * Treinta mensajes de memoria, y no es una corazonada: se midió contra las
   * dieciséis charlas reales. Con 20 se pierden dos ventas; con 30 se pierde
   * una sola, y estirarlo a 40, 60 o 100 no recupera ninguna más. Es la rodilla
   * de la curva. La que no se agarra con ninguna ventana es la venta que se
   * tomó fuera de esta charla —ahí el alias no se dijo nunca acá—, y para esa
   * está el botón de cargar el pedido a mano.
   */
  async #pasamosElAlias(conversationId: string, hastaMensajeId: string): Promise<boolean> {
    const settings = await this.#repos.settings.read();
    const alias = [settings.transferAlias, settings.transferAliasCursos]
      .map((a) => a?.trim().toLowerCase())
      .filter((a): a is string => Boolean(a) && a!.length >= 4);
    if (!alias.length) return false;

    const previos = await this.#repos.messages.history(conversationId, 30);
    const corte = previos.findIndex((m) => m.id === hastaMensajeId);
    const anteriores = corte >= 0 ? previos.slice(0, corte) : previos;

    return anteriores.some(
      (m) => m.direction === 'out' && alias.some((a) => m.text.toLowerCase().includes(a)),
    );
  }

  /**
   * Baja el adjunto de un mensaje entrante y lo deja guardado con dirección propia.
   *
   * Va SUELTO, después de guardar el mensaje, y no adentro del ingreso. El motivo
   * es lo que se ve: el mensaje aparece en la bandeja al instante y la foto se
   * suma un segundo después. Metido en el ingreso, cada comprobante le sumaba la
   * descarga entera al tiempo que tarda el bot en contestar.
   *
   * Que el panel se entere sale gratis: ya recarga la charla con cada evento de
   * mensaje, así que volver a emitir el mismo mensaje corregido alcanza para que
   * la imagen aparezca sola, sin tocar nada del lado del navegador.
   */
  async #guardarAdjunto(conversation: Conversation, stored: StoredMessage): Promise<void> {
    const contenido = stored.payload as InboundContent | null;
    if (!contenido || !seGuarda(contenido) || !contenido.mediaId) return;
    // Ya lo bajamos antes: un reintento de webhook no vuelve a pagar la descarga.
    if (contenido.url) return;

    /*
      Todo lo que sigue termina, sí o sí, dejando escrito cómo terminó: con la
      dirección del archivo o con el motivo por el que no está. Que quede sin
      ninguna de las dos cosas es peor que cualquiera de las dos, porque la
      burbuja dice "bajando el archivo…" y no lo desdice nunca: un comprobante
      que se perdió se ve igual que uno que está por aparecer, y el operador
      espera algo que no va a llegar.
    */
    const fracaso = async (motivo: string, err?: unknown) => {
      log('error', `Adjunto no guardado (${conversation.id}): ${motivo}`, err);
      const marcado = await this.#repos.messages
        .setPayload(stored.id, { ...contenido, mediaError: motivo })
        .catch(() => null);
      if (marcado) {
        bus.emit({ type: 'message', conversationId: conversation.id, message: marcado });
      }
    };

    const adapter = this.#resolve(conversation.channel);
    if (!adapter?.downloadMedia) {
      return fracaso(`el canal ${conversation.channel} no sabe bajar adjuntos`);
    }

    /*
      Sin PUBLIC_URL la dirección quedaría relativa, y esto lo abre el navegador
      del panel, que está en otro dominio. Mejor no guardar nada que guardar un
      link roto.
    */
    const base = config.publicUrl.replace(/\/$/, '');
    if (!base) return fracaso('falta PUBLIC_URL en el servidor');

    /*
      Techo diario por charla. El tope por archivo limita el tamaño de cada uno,
      no cuántos: sin esto, cualquiera que tenga el número del local puede mandar
      archivos hasta llenar la base. Un comprobante honesto pesa menos de un mega,
      así que el techo solo lo toca quien está haciendo otra cosa.
    */
    const yaGuardado = await this.#repos.media.bytesRecientesDe(conversation.id).catch(() => 0);
    if (yaGuardado >= MAX_ADJUNTOS_POR_CHARLA_DIA) {
      return fracaso('esta charla ya mandó demasiados archivos hoy');
    }

    /*
      Y un techo de descargas simultáneas. Cada una tiene el archivo entero en
      memoria: sin esto, veinte mensajes con foto a la vez son veinte buffers.
    */
    if (this.#bajando >= MAX_DESCARGAS_A_LA_VEZ) {
      return fracaso('había demasiadas descargas juntas');
    }
    this.#bajando += 1;

    try {
      /*
        Un intento más si el primero se cae.

        No es prolijidad: la dirección del archivo en WhatsApp dura cinco minutos
        y la de Telegram una hora, así que no hay una segunda oportunidad más
        tarde. Un tropiezo de red de un segundo pierde el comprobante para
        siempre, y el cliente ya lo mandó y no lo va a volver a mandar.

        Dos intentos y basta: si el archivo es demasiado grande o el canal dice
        que no existe, insistir no lo va a arreglar y solo demora el aviso.
      */
      let archivo;
      try {
        archivo = await adapter.downloadMedia(contenido.mediaId, MAX_ADJUNTO_BYTES);
      } catch (primerIntento) {
        log('warn', `Reintentando la descarga del adjunto (${conversation.id})`, primerIntento);
        await new Promise((listo) => setTimeout(listo, 3000));
        archivo = await adapter.downloadMedia(contenido.mediaId, MAX_ADJUNTO_BYTES);
      }

      if (archivo.data.length > MAX_ADJUNTO_BYTES) {
        // El canal no declaró el tamaño y resultó ser más grande de lo que entra.
        throw new Error(`pesa ${archivo.data.length} bytes y el tope es ${MAX_ADJUNTO_BYTES}`);
      }

      const { id } = await this.#repos.media.insert({
        mimeType: tipoSeguro(contenido.mimeType ?? archivo.mimeType),
        filename:
          ('filename' in contenido ? contenido.filename : undefined) ?? archivo.filename ?? null,
        bytes: archivo.data,
        origin: 'cliente',
        conversationId: conversation.id,
      });

      const corregido = await this.#repos.messages.setPayload(stored.id, {
        ...contenido,
        url: `${base}/media/${id}`,
      });
      if (corregido) {
        bus.emit({ type: 'message', conversationId: conversation.id, message: corregido });
      }
      log('info', `Adjunto guardado (${contenido.kind}, ${archivo.data.length} bytes)`);
    } catch (err) {
      /*
        Que no se pueda bajar el archivo no puede tumbar la conversación: el
        mensaje ya está guardado y el bot ya va a contestar igual.
      */
      await fracaso('no se pudo bajar del canal', err);
    } finally {
      this.#bajando -= 1;
    }
  }

  /**
   * Borra los adjuntos de clientes que ya vencieron.
   *
   * Se llama al arrancar y una vez por día. Vive acá y no en un cron del sistema
   * porque el bot ya es el único proceso que toca esta base, y un archivo de más
   * en Postgres es el problema que primero se nota cuando la base es chica.
   */
  async purgarAdjuntosViejos(): Promise<void> {
    try {
      const borrados = await this.#repos.media.purgarAdjuntosViejos(config.mediaRetencionDias);
      const peso = await this.#repos.media.pesoTotal();
      log(
        'info',
        `Adjuntos vencidos borrados: ${borrados}. Quedan ${peso.archivos} archivos, ` +
          `${(peso.bytes / 1024 / 1024).toFixed(1)} MB.`,
      );
    } catch (err) {
      log('error', 'No pude purgar los adjuntos vencidos', err);
    }
  }

  /** Coalesce: si llega otro mensaje, se reinicia el reloj. */
  #scheduleAgentTurn(conversationId: string): void {
    const existing = this.#pending.get(conversationId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.#pending.delete(conversationId);
      void this.#runAgentTurn(conversationId);
    }, DEBOUNCE_MS);
    this.#pending.set(conversationId, timer);
  }

  async #runAgentTurn(conversationId: string): Promise<void> {
    if (this.#running.has(conversationId)) {
      // Ya hay un turno en vuelo: se reprograma para después.
      this.#scheduleAgentTurn(conversationId);
      return;
    }
    this.#running.add(conversationId);
    try {
      await this.#agentTurn(conversationId);
    } catch (err) {
      log('error', `Turno del agente falló (${conversationId})`, err);
    } finally {
      this.#running.delete(conversationId);
    }
  }

  async #agentTurn(conversationId: string): Promise<void> {
    const arrancoEn = Date.now();
    const repos = this.#repos;
    const conversation = await repos.conversations.get(conversationId);
    if (!conversation) return;
    // El estado puede haber cambiado mientras esperábamos el debounce.
    if (conversation.mode !== 'bot') return;

    const contact = await repos.contacts.get(conversation.contactId);
    if (!contact) return;

    const [settings, history, products, quickReplies, activeCampaigns, openOrders, courses] =
      await Promise.all([
        repos.settings.read(),
        repos.messages.history(conversationId, 40),
        repos.products.list(),
        repos.quickReplies.list(),
        repos.campaigns.listActive(),
        repos.orders.list({ conversationId, limit: 5 }),
        repos.courses.list({ onlyActive: true }),
      ]);

    /*
      Un turno existe para contestar algo nuevo. El reloj del debounce se rearma
      cada vez que el mutex está tomado, así que es normal que dispare un turno
      cuyo último entrante ya contestó el turno anterior: ese mensaje llegó en la
      ventana entre que el timer disparó y que este SELECT corrió, o sea que el
      turno de antes también lo leyó. Correrlo igual es la forma más común de
      mandar dos respuestas casi idénticas, y de cargar dos veces el mismo pedido.

      Se compara contra el historial que este turno LEYÓ, no contra lo que había
      cuando disparó el timer: es lo único que distingue "ya contestado" de
      "todavía sin contestar".
    */
    /*
      `resumeAfterReview` es la única puerta al turno que no pasa por `route()`,
      así que el interruptor general del panel se chequea también acá. Sin esto,
      apagar el bot desde Ajustes no impedía que contestara una consulta resuelta.
    */
    if (!settings.botEnabled) return;

    const forzado = this.#forzar.delete(conversationId);
    const ultimoEntrante = [...history]
      .reverse()
      .find((m) => m.direction === 'in' && m.contentKind !== 'typing');
    if (!ultimoEntrante) return;
    if (!forzado && this.#answered.get(conversationId) === ultimoEntrante.id) {
      log('info', `Turno omitido (${conversationId}): nada nuevo que contestar.`);
      return;
    }
    const campaigns = await Promise.all(
      activeCampaigns.map(async (campaign) => ({
        campaign,
        skus: await repos.campaigns.skus(campaign.id),
      })),
    );

    const toolContext: ToolContext = { repos, conversation, contact, settings, effects: {} };

    const turn = await runTurn({
      settings,
      history,
      toolContext,
      dailyContext: {
        settings,
        products,
        campaigns,
        quickReplies,
        contact,
        outsideHours: isOutsideBusinessHours(settings),
        openOrders,
        pendingReview: conversation.pendingReview,
        courses,
      },
    });

    // --- efectos de las herramientas ----------------------------------------
    /*
      Van ANTES del manejo de errores a propósito: si el modelo escaló y después se
      quedó sin burbujas, la escalada tiene que valer igual. Hasta acá el `return`
      del bloque de errores la descartaba en silencio, y con una consulta de
      modificación eso es peor: el bot seguía habilitado y en el turno siguiente
      cerraba el pedido.
    */
    const { escalate } = toolContext.effects;
    if (escalate) {
      // Avisar: SIEMPRE. Que el equipo ya sepa no es motivo para dejar la alerta
      // vieja, porque el resumen nuevo trae mejor información.
      await repos.conversations.setAttention(
        conversationId,
        true,
        `[${escalate.reason}] ${escalate.summary}`,
      );

      /*
        Tomar la charla: solo si el asunto es nuevo. Escalar hacía las dos cosas
        siempre, y de ahí salía el "la devuelvo al bot y queda en humano igual":
        el equipo devolvía la charla a propósito y el bot se la volvía a llevar
        por un asunto del que ya estaba avisado.

        Se relee la conversación porque entre el chequeo de modo del arranque y
        este punto pueden pasar minutos —hasta seis rondas de herramientas— y en
        el medio alguien pudo silenciarla o devolverla. Releer no alcanza para lo
        segundo: una charla devuelta DURANTE el turno se lee igual que una que
        estuvo en 'bot' todo el tiempo, y para eso está la marca.
      */
      const actual = await repos.conversations.get(conversationId);
      const devueltaDuranteElTurno = (this.#devueltaAlBot.get(conversationId) ?? 0) > arrancoEn;
      if (escalate.soloAvisar || devueltaDuranteElTurno || actual?.mode === 'muted') {
        log(
          'info',
          `Escalada repetida (${conversationId}): alerta refrescada, la charla se queda como está.`,
        );
      } else {
        await repos.conversations.setMode(conversationId, 'human');
      }
      const refreshed = await repos.conversations.get(conversationId);
      if (refreshed) bus.emit({ type: 'conversation', conversation: refreshed });
    }

    // --- manejo de errores del modelo ---------------------------------------
    if (turn.error || !turn.bubbles.length) {
      const streak = (this.#errorStreak.get(conversationId) ?? 0) + 1;
      this.#errorStreak.set(conversationId, streak);
      log('warn', `Turno sin respuesta (${conversationId}), racha ${streak}`, turn.error);

      /*
        Si escaló y el turno igual se cayó, el cliente no puede quedarse en
        silencio: la conversación ya quedó en 'human', así que el bot no vuelve a
        intentar nunca. Se avisa sin esperar la racha, y no se toca la alerta: el
        motivo de la escalada vale más que "el bot falló N veces".
      */
      if (escalate) {
        /*
          La charla ya quedó en 'human': esta racha pertenece a una sesión del bot
          que terminó. Si no se borra, el primer tropiezo después de que el equipo
          conteste la consulta re-escala con el motivo equivocado y la respuesta
          que el cliente estaba esperando no sale nunca.
        */
        this.#errorStreak.delete(conversationId);
        await this.#send(
          conversationId,
          [
            {
              kind: 'text',
              text: 'Dame un minutito que lo confirmo, ya te escribe alguien del local 🙏🏻',
            },
          ],
          { author: 'system', intent: 'error', handler: 'escalate' },
        );
        return;
      }

      if (streak >= settings.escalateAfterErrors) {
        this.#errorStreak.delete(conversationId);
        await repos.conversations.setMode(conversationId, 'human');
        await repos.conversations.setAttention(
          conversationId,
          true,
          turn.refused
            ? `El modelo declinó responder: ${turn.error}`
            : `El bot falló ${streak} veces seguidas: ${turn.error ?? 'sin respuesta'}`,
        );
        const refreshed = await repos.conversations.get(conversationId);
        if (refreshed) bus.emit({ type: 'conversation', conversation: refreshed });
        await this.#send(
          conversationId,
          [
            {
              kind: 'text',
              text: 'Dame un minutito que te contesto bien, ya te escribe alguien del local 🙏🏻',
            },
          ],
          { author: 'system', intent: 'error', handler: 'escalate' },
        );
      }
      return;
    }
    this.#errorStreak.delete(conversationId);
    /*
      Se marca acá y no antes de llamar al modelo. Un turno que falló no contestó
      nada, y el disparo pendiente del debounce es la única segunda oportunidad que
      tiene el cliente: marcarlo por adelantado se la saca. Lo que estamos cerrando
      es la duplicación del turno anterior que SÍ contestó.
      Antes del #send y no después: si el envío se corta a mitad, reintentar manda
      de nuevo las burbujas que ya salieron.
    */
    this.#answered.set(conversationId, ultimoEntrante.id);

    const contents: OutboundContent[] = turn.bubbles.map((text) => ({ kind: 'text', text }));

    /*
      LA DIRECCIÓN NO SALE ANTES DE LA PLATA.

      Con un pedido que retira un Uber del cliente y sin un peso cobrado, dar la
      dirección es perder el pedido: el cliente manda el Uber, el chofer llega, y
      el local le entrega a cambio de nada. Pasó en la primera tarde de uso real.

      La regla está escrita en el prompt, y el prompt igual la salteó: el modelo
      escribió la dirección a mano, sin usar el mensaje rápido. Por eso además de
      la prosa hay esta guarda, que no depende de que el modelo se acuerde.

      Reemplaza la burbuja entera y no solo la dirección: recortar la dirección
      de una frase deja un castellano roto ("nuestra dirección es y ahí lo
      retira"). La burbuja que iba a dar la dirección se cambia por la que
      corresponde a esta altura de la conversación, que es pedir la plata.
    */
    const abiertos = await repos.orders.list({ conversationId, limit: 5 });
    const sinCobrar = abiertos.find(
      (o) =>
        o.status !== 'cancelado' &&
        o.total > 0 &&
        o.paid <= 0 &&
        (o.deliveryMode === 'uber-cliente' || o.deliveryMode === 'retira-local'),
    );
    if (sinCobrar && settings.address.trim()) {
      const direccion = settings.address.trim().toLowerCase();
      // La calle sola alcanza para detectarla: el modelo escribe la dirección
      // completa o los primeros términos, no la ciudad suelta.
      const calle = direccion.split(',')[0].trim();
      for (const contenido of contents) {
        if (contenido.kind !== 'text') continue;
        if (!contenido.text.toLowerCase().includes(calle)) continue;
        log(
          'warn',
          `Guarda: el bot iba a dar la dirección con el pedido ${sinCobrar.number} sin cobrar.`,
        );
        contenido.text =
          `Te paso el alias y apenas me mandes el comprobante te doy la dirección, así ya ` +
          `pedís el Uber 🫶🏻\n${settings.transferAlias} (${settings.transferHolder})`;
      }
    }

    /*
      EL ENVÍO NUNCA ES GRATIS.

      Una clienta preguntó "el cadete lo tengo que pagar yo?" y el bot le
      contestó "no, no hay un cobro aparte por el envío". Nadie le dijo eso
      nunca: el envío siempre se cobra, y cuánto sale depende de la zona, que es
      un dato que el bot no tiene.

      Ya estaba prohibido en el prompt, con todas las letras, y el modelo lo dijo
      igual. Es exactamente lo que pasó con la dirección antes de cobrar, así que
      la respuesta es la misma: además de la prosa, una guarda.

      Y escala. Esto no se arregla cambiando la burbuja y siguiendo: alguien ya
      leyó un precio que no era, o está por leerlo, y hay que decirle el costo de
      verdad. Eso lo sabe una persona.
    */
    /*
      Dos banderas y no una, porque son dos cosas distintas: `alertaDeGuarda`
      marca la charla en la bandeja, y `guardaEscalo` además se la saca al bot.
      Mezclarlas hacía que un aviso —"mirá este envío"— le arrancara la charla al
      bot en el medio de una venta que venía bien.
    */
    let alertaDeGuarda = false;
    let guardaEscalo = false;
    for (const contenido of contents) {
      if (contenido.kind !== 'text') continue;
      if (!prometeEnvioGratis(contenido.text)) continue;
      log('warn', `Guarda: el bot iba a decir que el envío no se cobra (${conversationId}).`);
      contenido.text = TEXTO_ENVIO_SE_COBRA;
      guardaEscalo = true;
      alertaDeGuarda = true;
    }

    /*
      UN ENVÍO NUESTRO PARA HOY LO MIRA UNA PERSONA. Siempre.

      No es una guarda sobre lo que el bot dice, sino sobre lo que compromete: un
      cadete para hoy depende de que haya cadete libre, de la zona y del
      recorrido que ya tiene armado, y de esas tres cosas el bot no sabe
      ninguna. Que el pedido quede cargado está bien; que nadie del local se
      entere hasta que la clienta reclama, no.

      Solo avisa, no cambia el modo: el bot sigue atendiendo normalmente. Lo que
      cambia es que la charla aparece marcada en la bandeja el mismo minuto en
      que se comprometió el envío, y no una hora después.
    */
    const cargado = toolContext.effects.createdOrder;
    if (cargado?.deliveryMode === 'cadete-miska' && cargado.deliveryDate === localToday()) {
      await repos.conversations.setAttention(
        conversationId,
        true,
        `[envio_hoy] El bot tomó el pedido ${cargado.number} con nuestro cadete para HOY` +
          `${cargado.deliveryTime ? ` (${cargado.deliveryTime})` : ''}. Confirmá que se puede y ` +
          'decile la franja y el costo del envío.',
      );
      const marcado = await repos.conversations.get(conversationId);
      if (marcado) bus.emit({ type: 'conversation', conversation: marcado });
      log('info', `Envío propio para hoy en el pedido ${cargado.number}: avisado al local.`);
      alertaDeGuarda = true;
    }

    /*
      La escalada de la guarda va acá y no arriba con la del modelo: `escalate`
      sale del resultado de las herramientas y ya se procesó. Que la charla pase
      a una persona es parte del arreglo, no un extra — el cliente va a
      preguntar cuánto sale el envío, y ese número no lo tenemos.
    */
    if (guardaEscalo) {
      await repos.conversations.setAttention(
        conversationId,
        true,
        '[envio_gratis] El bot estaba por decir que el envío no se cobra. Pasale vos el costo, ' +
          'que depende de la zona.',
      );
      await repos.conversations.setMode(conversationId, 'human');
      const marcada = await repos.conversations.get(conversationId);
      if (marcada) bus.emit({ type: 'conversation', conversation: marcada });
    }

    /*
      El termómetro de precios. SOLO ANOTA, no toca el mensaje: ver el porqué en
      core/policies/precios.ts. Si esto queda callado unas semanas, la guarda que
      reescribe no hace falta; si se enciende, se escribe con casos reales.
    */
    for (const contenido of contents) {
      if (contenido.kind !== 'text') continue;
      for (const mal of preciosQueNoCoinciden(contenido.text, products)) {
        log(
          'warn',
          `PRECIO QUE NO COINCIDE (${conversationId}): dijo ${mal.dijo} de ${mal.producto}, ` +
            `el catálogo dice ${mal.catalogo}.`,
        );
      }
      const agotados = agotadosConPrecio(contenido.text, products);
      if (agotados.length) {
        log(
          'warn',
          `OFRECIÓ ALGO APAGADO (${conversationId}): ${agotados.join(', ')}.`,
        );
      }
    }

    /*
      Las fotos van después del texto, no antes: primero se explica y después se
      muestra, que es como manda una foto una persona. El degradado por canal se
      ocupa del resto — si algún día hay un canal sin imágenes, ahí se convierte
      en texto con el link, y acá no cambia nada.
    */
    for (const photo of toolContext.effects.photos ?? []) {
      contents.push({ kind: 'image', url: photo.url, caption: photo.caption });
    }

    /*
      El cliente ya escuchó la respuesta del equipo: recién ahora la consulta deja
      de ser contexto. Se limpia acá y no al contestarla en el panel, porque entre
      las dos cosas el turno puede fallar, y una consulta resuelta que no se borra
      hace que el modelo la anuncie de nuevo en cada turno de las próximas 48 h.

      Se relee en vez de mirar la foto del arranque, por dos cosas distintas: si
      en ESTE turno se abrió una consulta nueva, borrar por la foto la haría
      desaparecer y el equipo nunca se enteraría de que hay alguien esperando. Y
      si el turno escaló, la alerta no se toca: apagarla acá dejaba la charla en
      humano sin consulta y sin motivo, o sea el reporte del dueño exactamente,
      sin nada en pantalla que lo explicara.
    */
    const alCerrar = await repos.conversations.get(conversationId);
    if (alCerrar?.pendingReview?.resueltoEn) {
      await repos.conversations.clearReview(conversationId);
      // La guarda cuenta igual que una escalada del modelo: si no, la alerta que
      // acaba de prender se apagaría dos líneas después.
      if (!escalate && !alertaDeGuarda) {
        await repos.conversations.setAttention(conversationId, false, null);
      }
      const limpia = await repos.conversations.get(conversationId);
      if (limpia) bus.emit({ type: 'conversation', conversation: limpia });
    }

    await this.#send(conversationId, contents, {
      author: 'bot',
      intent: turn.intent,
      handler: escalate || guardaEscalo ? 'escalate' : 'agent',
      quickReplyKey: toolContext.effects.quickReplyUsed,
      metrics: {
        latencyMs: turn.latencyMs,
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        cacheReadTokens: turn.cacheReadTokens,
        costUsd: turn.costUsd,
        model: turn.model,
      },
    });
  }

  /** Envío usado por el pipeline y por el panel (mensajes del operador). */
  async #send(
    conversationId: string,
    contents: OutboundContent[],
    opts: SendOptions,
  ): Promise<void> {
    const conversation = await this.#repos.conversations.get(conversationId);
    if (!conversation) return;
    const adapter = this.#resolve(conversation.channel);
    if (!adapter) {
      log('error', `No hay adapter activo para ${conversation.channel}; no envío nada.`);
      return;
    }
    await deliver({
      repos: this.#repos,
      adapter,
      conversation,
      settings: await this.#repos.settings.read(),
      contents,
      author: opts.author,
      intent: opts.intent,
      handler: opts.handler,
      quickReplyKey: opts.quickReplyKey,
      metrics: opts.metrics,
      humanize: opts.humanize,
    });
  }

  /**
   * El operador movió el modo desde el panel.
   *
   * La racha de errores pertenece a una sesión del bot que ya terminó: si no se
   * borra, el primer tropiezo después de la devolución manda la charla a humano
   * con un motivo viejo y ajeno.
   */
  marcarCambioDeModo(conversationId: string, mode: ConversationMode): void {
    this.#errorStreak.delete(conversationId);
    if (mode === 'bot') this.#devueltaAlBot.set(conversationId, Date.now());
  }

  /**
   * El equipo contestó una consulta de modificación: el bot retoma la charla.
   *
   * Hace falta un empujón explícito porque el cliente ya escribió y quedó
   * esperando: sin esto, la respuesta del local queda guardada y el bot no dice
   * nada hasta que la persona vuelva a escribir, que es justo la sensación de
   * "me dejaron colgado" que hay que evitar. Se borra la marca de agua porque el
   * último entrante ya fue contestado ("lo estoy consultando") y sin eso el turno
   * se saltearía solo.
   */
  async resumeAfterReview(conversationId: string): Promise<void> {
    this.#forzar.add(conversationId);
    this.#scheduleAgentTurn(conversationId);
  }

  /**
   * Contestó una persona, así que el turno que el debounce dejó pendiente no
   * tiene que volver a hablar sobre el mismo mensaje del cliente.
   *
   * Contrapartida asumida: después de un mensaje del operador el bot se queda
   * callado sobre ese entrante hasta que el cliente escriba de nuevo. Es lo que
   * corresponde: cuando habla una persona, manda la persona.
   */
  async #marcarContestadoPorPersona(conversationId: string): Promise<void> {
    const previos = await this.#repos.messages.history(conversationId, 10);
    const ultimo = [...previos].reverse().find((m) => m.direction === 'in');
    if (ultimo) this.#answered.set(conversationId, ultimo.id);
  }

  /** API pública para que un operador escriba desde el panel. */
  async sendAsOperator(conversationId: string, text: string): Promise<void> {
    /*
      Si había una consulta de modificación abierta, este mensaje LA CONTESTA.

      El equipo contesta escribiéndole al cliente, no apretando el botón del
      panel: es lo natural, y es lo que hicieron. Sin esto la consulta quedaba
      abierta para siempre y el bot seguía diciendo "todavía la estoy
      consultando" mientras el historial mostraba a una persona diciendo que sí.
      El cliente insistía, el bot se disculpaba y volvía a decir lo mismo.
    */
    const conversacion = await this.#repos.conversations.get(conversationId);
    if (conversacion?.pendingReview && !conversacion.pendingReview.resueltoEn) {
      await this.#repos.conversations.answerReview(conversationId, text, true);
      await this.#repos.conversations.setAttention(conversationId, false, null);
      const refrescada = await this.#repos.conversations.get(conversationId);
      if (refrescada) bus.emit({ type: 'conversation', conversation: refrescada });
      log('info', `Consulta cerrada por un mensaje del operador (${conversationId})`);
    }

    await this.#marcarContestadoPorPersona(conversationId);
    await this.#send(conversationId, [{ kind: 'text', text }], {
      author: 'human',
      handler: 'operator',
      humanize: false,
    });
  }

  /**
   * API pública para que un operador mande una foto desde el panel.
   *
   * Existe porque la mitad de las respuestas del local son una imagen: la
   * carta, el flyer del curso, la foto de la mini torta. Hasta acá el operador
   * que tomaba la charla solo podía escribir, así que abría WhatsApp en el
   * celular para mandar una foto y a partir de ahí la conversación quedaba
   * partida en dos lugares.
   *
   * Solo HTTPS, por lo mismo que el `mandar_foto` del bot: Meta descarga la
   * imagen desde afuera y con cualquier otra cosa falla sin decir nada.
   */
  async sendPhotoAsOperator(
    conversationId: string,
    url: string,
    caption?: string,
  ): Promise<boolean> {
    if (!/^https:\/\/\S+$/i.test(url)) return false;
    await this.#marcarContestadoPorPersona(conversationId);
    await this.#send(conversationId, [{ kind: 'image', url, caption: caption?.trim() || undefined }], {
      author: 'human',
      handler: 'operator',
      humanize: false,
    });
    return true;
  }

  /** API pública para reenviar un mensaje rápido desde el panel. */
  async sendQuickReply(conversationId: string, key: string): Promise<boolean> {
    const qr = await this.#repos.quickReplies.get(key);
    if (!qr) return false;
    await this.#marcarContestadoPorPersona(conversationId);
    const [settings, products] = await Promise.all([
      this.#repos.settings.read(),
      this.#repos.products.list(),
    ]);
    const text = renderQuickReply(qr.body, settings, products);
    await this.#repos.quickReplies.countUse(key);
    await this.#send(conversationId, [{ kind: 'text', text }], {
      author: 'human',
      intent: 'mensaje_rapido',
      handler: 'operator',
      quickReplyKey: key,
      humanize: false,
    });
    return true;
  }

  /** Expuesto para pruebas del retardo de tipeo. */
  static typingDelay = typingDelay;
}
