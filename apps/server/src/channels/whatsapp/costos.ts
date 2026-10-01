/*
  CUÁNTO ESTÁ COBRANDO META POR LOS MENSAJES.

  Desde el 1 de octubre de 2026 Meta cobra por mensaje de servicio —lo que sale
  de nuestro lado dentro de la ventana de 24 h que abre el cliente—, con mil
  gratis por número y por mes. Hasta ese día era gratis.

  Esto lee la factura del lado de Meta, que es la que manda. Nosotros contamos
  cada saliente en nuestra base y esa cuenta es más fresca —Meta tarda horas en
  actualizar— pero la que se paga es esta. El primer día que lo comparamos
  dieron exactamente igual: 26 y 26.

  POR QUÉ NO HAY QUE CONFIGURAR NADA: el id de la cuenta llega en cada webhook y
  el pipeline lo guarda la primera vez que lo ve. El token del servidor tiene
  permiso para gestionar mensajes pero NO para enumerar cuentas, así que por API
  no hay forma de averiguarlo solo —probado, /me/businesses contesta "Missing
  Permission"—.

  EL CACHÉ es de quince minutos y no es tacañería: el panel pide esto en cada
  recarga de Métricas, los datos de Meta se mueven por hora, y la cuota de la
  Graph API se comparte con el envío de mensajes. Quedarse sin cuota por un
  gráfico sería dejar al local sin WhatsApp.
*/
import { config } from '../../config.js';
import { log } from '../../core/events/bus.js';

export interface CostoDeWhatsapp {
  /** Mensajes que Meta contó como entregados en el mes en curso. */
  mensajes: number;
  /** Lo que lleva cobrado en el mes, en la moneda de la cuenta. */
  costo: number;
  /** La moneda con la que factura esta cuenta. Argentina factura en ARS. */
  moneda: string;
  /** Desde cuándo cuenta, en ISO. Siempre el primero del mes. */
  desde: string;
  /** Cuándo se consultó, para que el panel pueda decir qué tan fresco es. */
  consultadoEn: string;
  /**
   * Lo que saldría el mes entero si sigue este ritmo, o `null` si todavía no
   * se puede saber. Ver `proyectarElMes`.
   */
  proyeccion: number | null;
}

/** Lo que Meta regala por número y por mes antes de empezar a cobrar. */
export const MENSAJES_GRATIS_POR_MES = 1000;

const CACHE_MS = 15 * 60 * 1000;
let cache: { en: number; dato: CostoDeWhatsapp } | null = null;

/*
  LA PROYECCIÓN SALE DE LA TARIFA QUE META NOS COBRA A NOSOTROS.

  No hay ninguna tarifa escrita en el código, y es a propósito: Meta la revisa
  hasta cuatro veces al año y un número puesto a mano acá envejece sin que
  nadie se entere. En vez de eso se deduce dividiendo lo que ya cobró por los
  mensajes que efectivamente cobró —los que pasaron de los mil gratis—, así
  que es la tarifa real aplicada a esta cuenta y no la de la lista pública.

  Devuelve null mientras no haya cobrado nada: sin un peso cobrado no hay de
  dónde deducir, y preferimos no mostrar nada antes que inventar un número.
  Eso pasa los primeros días de cada mes, hasta que se agotan los mil gratis.
*/
export function proyectarElMes(mensajes: number, costo: number, ahora: Date): number | null {
  const cobrados = mensajes - MENSAJES_GRATIS_POR_MES;
  if (costo <= 0 || cobrados <= 0) return null;

  const tarifa = costo / cobrados;
  const diasDelMes = new Date(
    Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 0),
  ).getUTCDate();
  /*
    El día en curso cuenta entero aunque esté por la mitad. Si contara solo la
    parte transcurrida, a las nueve de la mañana el ritmo se vería inflado por
    tres y la proyección saldría disparada.
  */
  const diasCorridos = ahora.getUTCDate();
  const mensajesDelMes = (mensajes / diasCorridos) * diasDelMes;
  return Math.max(0, mensajesDelMes - MENSAJES_GRATIS_POR_MES) * tarifa;
}

/** El primero del mes en curso, a medianoche, como segundos unix. */
function arranqueDelMes(ahora: Date): { inicio: number; iso: string } {
  const d = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1));
  return { inicio: Math.floor(d.getTime() / 1000), iso: d.toISOString() };
}

/**
 * Lo que Meta lleva cobrado este mes, o `null` si no se puede saber.
 *
 * Devuelve `null` —y no lanza— cuando falta el id de la cuenta, falta el token,
 * o la Graph API contesta cualquier cosa. El panel tiene que poder dibujar sus
 * métricas aunque Meta esté caída: esto es un dato de más, no uno del que
 * dependa nada.
 */
export async function costoDeWhatsapp(
  accountId: string,
  ahora: Date,
): Promise<CostoDeWhatsapp | null> {
  if (!accountId || !config.whatsapp.accessToken) return null;

  if (cache && ahora.getTime() - cache.en < CACHE_MS) return cache.dato;

  const { inicio, iso } = arranqueDelMes(ahora);
  const fin = Math.floor(ahora.getTime() / 1000);
  const version = config.whatsapp.graphVersion || 'v21.0';
  const campos =
    `pricing_analytics.start(${inicio}).end(${fin}).granularity(MONTHLY)`;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${accountId}?fields=${campos}`,
      { headers: { authorization: `Bearer ${config.whatsapp.accessToken}` } },
    );
    const json = (await res.json()) as {
      pricing_analytics?: { data?: Array<{ data_points?: Array<{ volume?: number; cost?: number }> }> };
      error?: { message?: string };
    };
    if (json.error) {
      log('warn', `No pude leer los cargos de WhatsApp: ${json.error.message ?? '?'}`);
      return null;
    }

    /*
      Meta devuelve los puntos agrupados, y con granularidad mensual suele venir
      uno solo. Se suman igual: si alguna vez parte el mes en dos, la cuenta
      sigue dando bien.
    */
    const puntos = (json.pricing_analytics?.data ?? []).flatMap((d) => d.data_points ?? []);
    const dato: CostoDeWhatsapp = {
      mensajes: puntos.reduce((t, p) => t + (p.volume ?? 0), 0),
      costo: puntos.reduce((t, p) => t + (p.cost ?? 0), 0),
      moneda: 'ARS',
      desde: iso,
      consultadoEn: ahora.toISOString(),
      proyeccion: null,
    };
    dato.proyeccion = proyectarElMes(dato.mensajes, dato.costo, ahora);
    cache = { en: ahora.getTime(), dato };
    return dato;
  } catch (err) {
    log('warn', 'No pude consultar los cargos de WhatsApp', err);
    return null;
  }
}
