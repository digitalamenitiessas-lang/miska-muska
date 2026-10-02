/*
  CUÁNTO ESTÁ COBRANDO META POR LOS MENSAJES.

  Esto lee la factura del lado de Meta, que es la que manda. Nosotros contamos
  cada saliente en nuestra base y esa cuenta es más fresca —Meta tarda horas en
  actualizar— pero la que se paga es esta.

  ESTÁ EN PESOS. Meta factura esta cuenta en ARS y la prueba está en la propia
  división: 2.298,47 ÷ 61 = 37,68, que es clavada la tarifa publicada en pesos
  (ARS 37,6798). En dólares esa misma tarifa es USD 0,0260. Importa decirlo
  porque en la misma pantalla del panel conviven este número y el de la IA, que
  es en dólares: dos monedas con el mismo signo pesos.

  ──────────────────────────────────────────────────────────────────────────
  LO QUE REALMENTE SE COBRA, Y LO QUE CREÍMOS QUE SE COBRABA.

  Este módulo nació con un número escrito acá: mil mensajes gratis por mes y
  después se cobra todo. Era falso, y la propia cuenta lo demostró en dos días.

  Lo que Meta devuelve, abierto por tipo de precio:

    1/10    FREE_CUSTOMER_SERVICE   816    $0
            FREE_ENTRY_POINT        348    $0
    2/10    FREE_CUSTOMER_SERVICE   187    $0
            FREE_ENTRY_POINT         90    $0
            REGULAR                  61    $2.298,47   ← 37,68 cada uno

  No hay ningún cupo de mil. Hay tipos de precio: cuando una clienta escribe se
  abre una ventana de 24 h y todo lo que contestemos adentro es gratis, sin
  tope, y la ventana se reinicia con cada mensaje de ella; si llegó por un
  anuncio de clic-a-WhatsApp son 72 h. Lo que cae FUERA de esa ventana se cobra
  a la tarifa publicada, y eso es `REGULAR`. Con el movimiento real de Miska es
  alrededor del 4% de los mensajes.

  LA TARIFA PUBLICADA ENGAÑA SI SE MIRA SOLA. El selector de precios de Meta
  muestra ARS 37,6798 para la categoría Servicio y es cierto, pero se aplica a
  una fracción chica y no a todo lo que sale. Mirar esa tabla sin leer el
  párrafo que tiene encima —el que dice que lo contestado dentro de la ventana
  no se cobra— fue el error que se cometió, y salió caro: un informe entero
  calculado sobre una premisa falsa.

  POR ESO ACÁ NO HAY NINGUNA TARIFA NI NINGÚN TOPE ESCRITO. Se pregunta el
  costo y se informa el costo, abierto por tipo para que se vea de dónde sale.

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

/** Un tipo de precio de Meta, con lo que lleva de este mes. */
export interface TipoDePrecio {
  /** El nombre tal cual lo devuelve Meta: FREE_CUSTOMER_SERVICE, REGULAR, … */
  tipo: string;
  mensajes: number;
  costo: number;
}

export interface CostoDeWhatsapp {
  /** Mensajes que Meta contó como entregados en el mes en curso. */
  mensajes: number;
  /** Lo que lleva cobrado en el mes, EN PESOS. */
  costo: number;
  /** De esos mensajes, los que no costaron nada. */
  sinCargo: number;
  /** El desglose, de mayor a menor. Para saber de dónde sale el cargo. */
  porTipo: TipoDePrecio[];
  /** La moneda con la que factura esta cuenta. Argentina factura en ARS. */
  moneda: string;
  /** El mes que se está contando, como "2026-10". Sin hora: ver `mesDe`. */
  mes: string;
  /** Cuándo se consultó, para que el panel pueda decir qué tan fresco es. */
  consultadoEn: string;
  /**
   * Lo que saldría el mes entero si sigue este ritmo, o `null` si todavía no
   * se puede saber. Ver `proyectarElMes`.
   */
  proyeccion: number | null;
}

const CACHE_MS = 15 * 60 * 1000;
let cache: { en: number; dato: CostoDeWhatsapp } | null = null;

/**
 * Desde qué día del mes se puede proyectar.
 *
 * El 1 de octubre Meta cobró cero y el 2 aparecieron los primeros cargos.
 * Proyectar el día 2 es dividir por dos días de los cuales uno fue cero: da la
 * mitad de lo que corresponde y con cara de dato firme. Con un solo día de
 * cobros no se proyecta un mes.
 */
const DIA_DESDE_EL_QUE_SE_PROYECTA = 3;

/*
  LA PROYECCIÓN ES UNA REGLA DE TRES SOBRE LO QUE META YA COBRÓ.

  Nada más que eso, y es a propósito. La versión anterior deducía una tarifa
  dividiendo el costo por "los mensajes pasados de los mil gratis", porque creía
  que los primeros mil no se cobraban. Esa cuenta inventaba una tarifa de unos
  cuatro pesos y se la aplicaba a TODOS los mensajes del mes: el panel llegó a
  mostrar $87.998 proyectados sobre $1.959 cobrados. Sin escalón, el gasto es
  lineal y proyectarlo es dividir por los días corridos.
*/
export function proyectarElMes(costo: number, ahora: Date): number | null {
  const diasCorridos = ahora.getUTCDate();
  if (costo <= 0 || diasCorridos < DIA_DESDE_EL_QUE_SE_PROYECTA) return null;

  const diasDelMes = new Date(
    Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return (costo / diasCorridos) * diasDelMes;
}

/** El primero del mes en curso, a medianoche UTC, como segundos unix. */
function arranqueDelMes(ahora: Date): number {
  return Math.floor(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1) / 1000);
}

/**
 * El mes que se está contando, como "2026-10".
 *
 * NO va como fecha ISO, y eso arregla un cartel que el 2 de octubre decía
 * "WhatsApp en septiembre". Mandábamos "2026-10-01T00:00:00.000Z" y el panel le
 * pedía el nombre del mes en hora local: la medianoche UTC del 1 de octubre es
 * el 30 de septiembre a las 21 en Argentina, así que salía el mes anterior. Un
 * año y un mes no tienen zona horaria, y mandarlos como instante los rompe.
 */
export function mesDe(ahora: Date): string {
  return `${ahora.getUTCFullYear()}-${String(ahora.getUTCMonth() + 1).padStart(2, '0')}`;
}

interface PuntoDeMeta {
  pricing_type?: string;
  volume?: number;
  cost?: number;
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

  const inicio = arranqueDelMes(ahora);
  const fin = Math.floor(ahora.getTime() / 1000);
  const version = config.whatsapp.graphVersion || 'v21.0';
  /*
    DIARIA Y NO MENSUAL: con granularidad mensual Meta no devuelve nada hasta
    que el mes termina. Probado el 1 de octubre contra la cuenta real: con
    MONTHLY contestó solo el id, con DAILY contestó los mensajes del día. La
    tarjeta habría marcado cero todo el mes.

    Los corchetes y las comillas de `dimensions` van escapados porque viajan
    dentro del query string.
  */
  const campos =
    `pricing_analytics.start(${inicio}).end(${fin})` +
    `.granularity(DAILY).dimensions(%5B%22PRICING_TYPE%22%5D)`;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${accountId}?fields=${campos}`,
      { headers: { authorization: `Bearer ${config.whatsapp.accessToken}` } },
    );
    const json = (await res.json()) as {
      pricing_analytics?: { data?: Array<{ data_points?: PuntoDeMeta[] }> };
      error?: { message?: string };
    };
    if (json.error) {
      log('warn', `No pude leer los cargos de WhatsApp: ${json.error.message ?? '?'}`);
      return null;
    }

    /*
      Vienen los días sueltos y abiertos por tipo de precio: cada día aporta una
      fila por tipo. Se juntan todas, que acá interesa el mes entero.
    */
    const puntos = (json.pricing_analytics?.data ?? []).flatMap((d) => d.data_points ?? []);

    const acumulado = new Map<string, TipoDePrecio>();
    for (const p of puntos) {
      const tipo = p.pricing_type ?? 'SIN_TIPO';
      const t = acumulado.get(tipo) ?? { tipo, mensajes: 0, costo: 0 };
      t.mensajes += p.volume ?? 0;
      t.costo += p.cost ?? 0;
      acumulado.set(tipo, t);
    }
    const porTipo = [...acumulado.values()].sort((a, b) => b.mensajes - a.mensajes);

    const dato: CostoDeWhatsapp = {
      mensajes: porTipo.reduce((t, p) => t + p.mensajes, 0),
      costo: porTipo.reduce((t, p) => t + p.costo, 0),
      /*
        Sin cargo es lo que Meta cobró en cero, no lo que su nombre dice. El
        nombre es de ellos y pueden cambiarlo; la plata no miente.
      */
      sinCargo: porTipo.filter((p) => p.costo === 0).reduce((t, p) => t + p.mensajes, 0),
      porTipo,
      moneda: 'ARS',
      mes: mesDe(ahora),
      consultadoEn: ahora.toISOString(),
      proyeccion: null,
    };
    dato.proyeccion = proyectarElMes(dato.costo, ahora);
    cache = { en: ahora.getTime(), dato };
    return dato;
  } catch (err) {
    log('warn', 'No pude consultar los cargos de WhatsApp', err);
    return null;
  }
}
