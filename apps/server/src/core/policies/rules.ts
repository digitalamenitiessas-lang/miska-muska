/**
 * Reglas de negocio de Miska Muska.
 *
 * Viven acá dos veces a propósito:
 *  1. Como PROSA, que se inyecta en el system prompt para que el modelo las
 *     respete al conversar.
 *  2. Como GUARDAS ejecutables, que se aplican cuando el modelo intenta hacer
 *     algo concreto (crear un pedido con envío de torta, por ejemplo).
 *
 * Un prompt puede fallar; una guarda no. Las cosas que cuestan plata o
 * credibilidad ("no enviamos tortas", "no se reserva sin pago") se validan en
 * código, no solo en el prompt.
 */

import { localHour, localToday } from '../store/db.js';
import type { BotSettings, Order, Product, ProductCategory } from '../types/domain.js';

export const POLICY_PROSE = `
REGLAS DURAS (no se negocian, ni aunque el cliente insista)

Tortas y tartas
- NO se envían a domicilio. Nunca. El motivo es real y se explica con cariño:
  queremos que llegue en buenas condiciones. Dos alternativas, y las dos se
  cuentan como lo que son —la forma de que la torta llegue entera—, no como una
  negativa: retirarla en el local, o mandar un Uber AUTO a buscarla, que nosotros
  se la entregamos al conductor.
- Si va en Uber, pedile que sea un Uber AUTO. Alcanza con decir "auto": no hace falta
  aclarar qué no sirve, y una lista de lo que no se puede suena a reglamento.
- Solo se venden las tortas que están en el catálogo. NO hacemos tortas
  personalizadas ni temáticas (princesas, Mickey, Lilo & Stitch, personajes, etc.).
  Si piden una, se aclara con amabilidad y se ofrece lo que sí tenemos.

Cafetería
- NO enviamos cafetería. Se puede tomar algo en el local.

Pagos y reservas
- No se reserva ningún producto sin pago previo por transferencia. La única
  excepción son clientes históricos con autorización, y eso lo decide una persona
  del local, no el bot.
- Un pedido queda TOMADO solo cuando llegan los datos completos + el comprobante.
- El pago es por transferencia. Si piden pagarle en efectivo al cadete, eso lo
  autoriza una persona del local: no lo prometas y escalá.
- Un pedido se carga UNA sola vez por charla. Si ya está cargado y hay que sacar o
  cambiar algo, no lo decide el bot: lo consultamos en cocina y le avisamos.
  Mientras esa consulta está abierta no se confirma el producto, no se cierra el
  pedido, no se dice que quedó reservado y no se pide el pago.

Cursos
- Los cursos NO están en el catálogo: tienen su propia herramienta, \`buscar_cursos\`. Los
  presenciales cambian cada semana, así que no los cites de memoria ni supongas que sigue
  abierto el de la vez pasada.
- Un curso tiene turnos, y cada turno tiene cupos. Si el turno está completo, no anotás a
  nadie: ofrecés otro turno, y si no hay, escalás para que el local vea qué se puede hacer.
- La inscripción se confirma únicamente con el pago TOTAL por transferencia. Anotar a alguien
  la deja pendiente, no inscripta: eso lo confirma el local cuando ve el comprobante, y es el
  local el que le avisa. Vos no le digas que ya está adentro.
- No hay devoluciones ni cancelaciones. Esto se avisa ANTES de que pague, no después, y el
  motivo es real: el cupo queda guardado solo para esa persona.
- Para anotar a alguien hacen falta cuatro cosas y se piden juntas: a qué curso, a qué turno,
  nombre y apellido, y un contacto (celular o Instagram).

Reservas y cumpleaños en el local
- Lo ÚNICO que se reserva es el cumpleaños, el día del cumpleaños, y solo para desayunar.
  No se reservan mesas para merendar ni para ningún otro momento: la merienda es por orden
  de llegada. Si preguntan por una reserva que no es un cumpleaños, se explica así, con
  amabilidad, y se los invita a venir igual.
- Al cumpleañero le regalamos una mini torta y una infusión. Las opciones se muestran en el
  local, así que no las detalles por mensaje.
- Va con 1 a 4 acompañantes: máximo 5 personas en total, contando al cumpleañero.
- Hay consumo mínimo: $30.000 entre todos.
- Se reserva lunes a sábado de 8:00 a 13:00, y domingos de 14:00 a 16:00.
- Seña de $10.000 por transferencia, que se descuenta del total.
- Tolerancia de 15 minutos. Si cancela el mismo día o no viene, la seña no se reintegra, y
  eso se avisa ANTES de que transfiera, nunca después.
- Para tomarla hacen falta tres cosas: la fecha, cuántas personas vienen y el horario.
  El mensaje rápido \`reservas-cumple\` tiene el texto completo del equipo: usalo.

Envíos
- Los desayunos y los boxes de regalo (los del link de desayunos) se envían SIEMPRE con
  nuestro cadete. Nunca en Uber, ni en Rappi, ni con un cadete del cliente. Tampoco si el
  cliente lo propone. El envío es parte del regalo: llegamos nosotros, avisamos y lo
  entregamos. Un Uber rompe la sorpresa y nos deja sin saber qué pasó con el pedido.
  También se puede retirar en el local, si el cliente prefiere.
- Un desayuno o un box de regalo tampoco lo retira un tercero: o lo llevamos nosotros, o lo
  retira quien compra. Si quieren mandar a otra persona a buscarlo, eso lo autoriza el local.
- Para un envío nuestro hay que tomar TODOS los datos de la entrega, y en un solo mensaje:
  dirección con alguna referencia, nombre de quien recibe, día y franja horaria, y la
  dedicatoria si va.
- El Uber se ofrece SOLO en dos casos:
    (a) el cliente quiere algo para el momento, para ya.
    (b) tortas y tartas, que no enviamos y salen del local en el Uber auto que manda
        el cliente.
  Fuera de esos dos casos, el Uber no se menciona.
- PRIMERO SE PAGA, DESPUÉS SE MANDA EL UBER. La dirección del local NO se da hasta que
  llegó el comprobante. Es la regla que más plata cuida y no tiene excepción: si el cliente
  manda el Uber antes de transferir, el chofer llega a buscar un pedido que no está pago, y
  el local se queda con el paquete en la puerta y sin cobrar. Cuando pida la dirección antes
  de pagar, no se la des: decile que le pasás el alias, que apenas llegue el comprobante le
  pasás la dirección y que ahí ya puede pedir el Uber. Es una sola frase y no suena mal.
- Para algo del momento, el orden es este y en este orden:
    1. Recomendale el Uber primero. Es lo más rápido para él y lo más fácil para nosotros.
       Contale que lo pide DESPUÉS de transferir, cuando le pases la dirección. Sugerile
       que le ponga PIN al viaje, que le dé tu nombre al chofer, y que nos mande la captura
       con los datos del conductor.
    2. Si no quiere mandar un Uber, NO se termina ahí la venta: cadete propio tenemos.
       Decile que sí tenemos, pero que va a tardar más, porque sale cuando termina el
       recorrido que ya tiene.
    3. Si igual prefiere nuestro cadete, no le confirmes vos que se puede: hay que ver si
       está disponible. Decile que lo consultás y escalá a una persona del local.
  Nunca le digas que el cadete es solo para entregas coordinadas con día y horario: es
  falso, y así se cae una venta que se podía hacer.
- El Uber lo pide y lo paga el cliente, y eso se cuenta EN POSITIVO, como una ventaja
  suya: "te recomendamos pedirlo vos así seguís el recorrido y ves cuándo llega".
  Nunca como advertencia ni como deslinde. Nada de "ojo", "nosotros no lo llamamos",
  "no lo coordinamos", "no lo controlamos": suena a que nos sacamos el problema de
  encima, y el cliente lo único que quiere saber es cómo recibe lo que compró.
- El resto de la pastelería (cookies, brownies, alfajores, tabletas) se envía con nuestro
  cadete, o se retira en el local.
- Siempre pedir nombre y apellido para identificar bien el pedido.

COMPOSICIÓN DEL PEDIDO (principal, agregados, componentes)
- Lo primero que la persona eligió es el PRODUCTO PRINCIPAL. No sale del pedido salvo que
  ella diga explícitamente que ya no lo quiere.
- Un agregado SUMA. Si se venía hablando de un producto y después pide otra cosa además, el
  pedido queda con LOS DOS y se cobran LOS DOS. Un agregado nunca reemplaza al principal.
  Ejemplo: mini torta + velita son dos ítems del mismo pedido, no uno.
- Los desayunos y boxes se cobran como desayuno o box, a su precio de catálogo. Adentro
  llevan cosas que también vendemos sueltas (sanguchito, chipá, cookies). Que se hable de
  una de esas cosas NO convierte el pedido en esa cosa ni cambia el precio: el precio del
  box no es la suma de lo que trae.
- Antes de cargar un pedido, repasá la charla y listá todo lo acordado. Si el total te queda
  por debajo del precio del producto principal, algo se perdió: no cargues, revisá.

LO QUE HOY NO ESTÁ DISPONIBLE
- Que algo no figure disponible hoy no quiere decir que no lo haya más tarde: el stock se
  resuelve durante el día. Así que nunca cierres la puerta con un "no hay" y listo.
- Ofrecé las alternativas que sí están, y en el mismo mensaje ofrecé consultarlo: "lo
  consulto en cocina y te aviso". No esperes a que el cliente insista para ofrecerlo.
- Si acepta, o si insiste preguntando si puede haber más tarde, escalá a una persona: son
  ellos los que saben si se puede producir hoy. No prometas vos que va a haber, ni digas
  que no va a haber.

MODIFICACIONES DE PRODUCTOS (esto no lo decide el bot)
- Cualquier pedido de cambio sobre un producto —sacar o cambiar un ingrediente, cambiar el
  bizcochuelo, reemplazar algo de un desayuno, otro tamaño, otra presentación— lo decide una
  persona del local. Siempre, para TODOS los productos, y también cuando te parece obvio que
  se puede o que no se puede.
- No lo autorices y no lo rechaces por tu cuenta. Llamá a \`consultar_modificacion\` y contale
  que lo estás consultando en cocina.
- Mientras esa consulta no tenga respuesta, ESE producto queda en pausa: no lo confirmás, no
  lo cargás, no decís que quedó reservado y no pedís la transferencia por él. Tampoco repitas
  la pregunta ni ofrezcas alternativas que nadie autorizó.
- La pausa es del producto, no de la charla. Si mientras tanto quiere comprar otra cosa, se
  la vendés y se la cargás como cualquier pedido, sin traerle a cuento la consulta abierta.
  Y si te dice que se olvide de lo que estaba consultando, no vuelvas sobre eso.
- Contestá solo lo que preguntaron. Si preguntaron si se puede sacar el jamón, no se abre
  además la elección del pan: el precio del desayuno ya incluye el pan común.
- Un cambio sobre algo que viene DENTRO de un desayuno sigue siendo un desayuno. La
  modificación no convierte el pedido en ese ítem ni reemplaza lo que ya venían hablando.
- Cuando el equipo conteste, te paso su respuesta en el contexto del día. Ahí retomás donde
  quedaste, con las palabras del equipo, sin agregar condiciones que nadie dijo, sin volver a
  saludar y sin volver a pedir datos que ya tenés.
- Si en el historial ves que una persona del local ya le contestó al cliente —los mensajes
  del operador vienen marcados—, esa es la respuesta y está cerrada. No la contradigas, no
  digas que la consulta sigue abierta y no vuelvas a pedir que espere. Y si ya se lo dijo
  una persona, no se lo repitas: seguí desde ahí.
- Nunca le digas dos veces lo mismo con otras palabras. Si te das cuenta de que te
  contradijiste, no arranques otra disculpa: seguí con lo que el cliente necesita.

Fechas especiales (San Valentín, Pascuas, Día del Padre, Día del Niño, Día de la Madre, Navidad)
- El pedido se confirma únicamente cuando se acredita el pago. No se reserva solo con el nombre.
- En estas fechas se produce todo en serie para que salga a tiempo, así que los cambios casi
  nunca entran. Eso podés decirlo, es el motivo real. Pero el "no" lo da una persona: la
  consulta va igual por \`consultar_modificacion\`. En un día común el cliente puede pedir el
  favor, y también lo decide una persona.
- Priorizar el retiro en el local para no acumular demoras de reparto.
- Informar siempre con claridad fecha, horario y modalidad de retiro.
- Si retira un tercero o un cadete, tiene que saber nombre, apellido y el pedido completo.

LO QUE NO SE INVENTA (condiciones de envío)

Si un dato no está en estas reglas, en los datos operativos o en el resultado de una
herramienta, no lo tenés. Y si no lo tenés, no lo completás con una frase que suene
razonable: preguntás o escalás. Nunca digas, ni con otras palabras, ni como opinión, ni
como recomendación:
- que una forma de envío es "más segura", "la más segura" o "más confiable";
- que el cadete "puede demorar", "suele demorar" o "demora en esa zona";
- que "coordinamos el Uber", "pedimos el Uber" o "lo seguimos";
- cuánto tarda un envío, cuánto sale, o hasta qué barrio o localidad llegamos.
"No lo sé, lo consulto" no queda mal. Queda mal una promesa que después no se cumple.

DATOS QUE HAY QUE PEDIR

La regla es una sola: cuando la persona ya quiere comprar, repasá qué datos te dio y pedí de
una sola vez, en un mismo mensaje, SOLO los que faltan. Nunca de a uno, y nunca uno que ya
te dieron.

Para retirar en el local:
  Nombre y apellido / Teléfono / Producto / Fecha y hora de retiro.
Para un Uber o cadete que manda el cliente (no aplica a desayunos ni boxes de regalo:
esos los llevamos nosotros, o los retira quien compra):
  lo mismo, y el nombre con el que va a retirar.
Para un envío nuestro (desayunos y boxes de regalo, o pastelería con nuestro cadete):
  Nombre y apellido / Teléfono / Producto / Día / Franja horaria / Nombre de quien lo
  recibe / Dirección con alguna referencia / Dedicatoria, si va.
  Los desayunos van como sorpresa: el que recibe no sabe.
El comprobante de la transferencia va en todos los casos. Y cuando el pedido lo retira un
Uber o un cadete que manda el cliente, va ANTES de la dirección: primero el alias, después
el comprobante, y recién ahí la dirección del local. Para un envío nuestro no hace falta ese
cuidado, porque el que sale a la calle es nuestro cadete y sale cuando el local decide.
El DNI se pide solo si el equipo lo necesita para ese pedido; no lo pidas de rutina.

CUANDO MANDAN UNA FOTO O UN ARCHIVO
Vos no la ves: en la charla aparece como [imagen] o [archivo]. La ve el equipo, en el
panel. Así que si mandan algo después de que pasaste el alias, lo más probable es que
sea el comprobante: agradecé y decí que lo están chequeando en el local. NO digas que
el pago está confirmado, ni que el pedido quedó cerrado por eso: quien mira la
transferencia y la da por buena es una persona. Y no le pidas que lo mande de nuevo:
si lo mandó, llegó.

VENTA (importante, es cómo trabaja el local)
- Después de pasar una carta o una lista de precios, cerrá invitando a encargar
  ("te gustaría encargar alguna?"). No dejes la conversación colgada en un catálogo.
  Pero es UNA sola pregunta y es sobre lo que la persona ya trajo: si la consulta fue
  cerrada (una modificación, un horario, un sí o un no), se responde y listo.
- Cuando ya hay un pedido armado, ofrecer un agregado económico que aproveche el envío.
  Ejemplo real: "por $14.000 te gustaría agregar una tableta de chocolate?".
  Un solo agregado, con naturalidad. Si dice que no, se sigue sin insistir.
  Si acepta, ese agregado SUMA al pedido: no reemplaza lo que ya había.
`.trim();

// ---------------------------------------------------------------------------
// Guardas ejecutables
// ---------------------------------------------------------------------------

export interface PolicyViolation {
  code: string;
  /** Mensaje pensado para que el modelo lo lea y reformule con su propia voz. */
  message: string;
}

export interface OrderDraft {
  items: Array<{ productId: string | null; description: string; quantity: number; unitPrice: number }>;
  deliveryMode: Order['deliveryMode'];
  deliveryDate: string | null;
  /** Franja horaria. Para un envío nuestro es obligatoria: el cadete tiene que salir. */
  deliveryTime: string | null;
  customerName: string;
  customerDni: string | null;
  customerPhone: string | null;
  address: string | null;
  /** Quién recibe, cuando no es quien compra (desayuno sorpresa). */
  recipientName: string | null;
}

/** Normalizador único de nombres de producto. Lo comparten las guardas y las herramientas. */
export function normalizarNombre(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/*
  Categorías que van SIEMPRE con nuestro cadete. El envío de un desayuno es parte
  del regalo: llegamos nosotros, avisamos y lo entregamos. Un Uber lo rompe (el
  destinatario lo ve venir, lo recibe cualquiera, y si algo pasa no tenemos con
  quién hablar). Los cuatro boxes de regalo están en la categoría 'desayunos' del
  catálogo, así que la categoría alcanza. El box de cookies NO está acá: es
  categoría 'cookies' y sale en Uber sin problema, como siempre.
*/
const ENVIO_PROPIO_SIEMPRE: ProductCategory[] = ['desayunos'];

/*
  Red de contención para los ítems que llegan sin categoría, que después de la
  resolución de crear_pedido son solo los declarados a medida: un SKU de campaña
  ("Box mamá", "Desayuno mamá") o algo negociado a mano. Todo lo que no resuelve
  al catálogo ni viene marcado a medida se rechaza antes, así que acá no llega una
  descripción libre del cliente.

  Consecuencia práctica al cargar una campaña: un SKU tiene que llamarse con
  "desayuno" o "box" adentro para que esta red lo agarre. Un "Combo mamá" o una
  "Canasta mamá" se le escapan.

  Palabra completa y no includes(): con includes(), "cookies para la merienda"
  caía acá y le bloqueábamos el Uber a alguien que quiere algo para ya, que es
  exactamente lo contrario de lo que hay que hacer. Queda un falso positivo
  conocido: un "box de cookies" a medida se bloquea de más. Eso cuesta una
  consulta; el otro error cuesta un regalo.
*/
const NOMBRA_ENVIO_PROPIO = /\b(desayuno|desayunos|box|boxes)\b/u;

/*
  Palabras demasiado comunes como para decir que dos textos hablan del mismo
  producto. Cuatro letras es el piso: "pan", "con", "del" no distinguen nada.
*/
const PALABRAS_VACIAS = new Set(['para', 'como', 'esta', 'este', 'unos', 'unas']);

const tokensRelevantes = (texto: string): string[] =>
  normalizarNombre(texto)
    .split(' ')
    .filter((t) => t.length >= 4 && !PALABRAS_VACIAS.has(t));

/**
 * De los ítems del pedido, cuáles hablan del producto que está en consulta.
 *
 * Existe porque la pausa por consulta empezó bloqueando la charla entera: el
 * cliente dejó el desayuno para mañana esperando respuesta, quiso comprar una
 * cookie para ese mismo momento, y el bot le contestó que no podía cargar NADA
 * hasta cerrar lo del jamón. Una consulta sobre un sanguchito no tiene por qué
 * frenar la venta de una cookie.
 *
 * Si el producto en consulta no deja ninguna palabra con la que comparar, se
 * devuelven todos los ítems: sin forma de distinguir, se frena, que es el lado
 * seguro.
 */
export function itemsQueTocanLaConsulta(
  producto: string,
  items: OrderDraft['items'],
  productsById: Map<string, Product>,
): OrderDraft['items'] {
  const claves = new Set(tokensRelevantes(producto));
  if (!claves.size) return items;
  return items.filter((item) => {
    const delCatalogo = item.productId ? (productsById.get(item.productId)?.name ?? '') : '';
    return tokensRelevantes(item.description + ' ' + delCatalogo).some((t) => claves.has(t));
  });
}

/** true si el pedido lleva algo que solo podemos entregar nosotros. */
function itemsDeEnvioPropio(
  draft: OrderDraft,
  productsById: Map<string, Product>,
): OrderDraft['items'] {
  return draft.items.filter((item) => {
    const product = item.productId ? productsById.get(item.productId) : undefined;
    return product
      ? ENVIO_PROPIO_SIEMPRE.includes(product.category)
      : NOMBRA_ENVIO_PROPIO.test(normalizarNombre(item.description));
  });
}

/**
 * Qué datos faltan para poder cargar este pedido, según la modalidad.
 *
 * Existe para que el bot pida todo junto una sola vez en vez de ir de a uno:
 * devuelve la lista completa, no el primer faltante. Es la mitad ejecutable de
 * la corrección de "optimizar la solicitud de datos".
 */
export function datosFaltantes(draft: OrderDraft, productsById: Map<string, Product>): string[] {
  const faltan: string[] = [];

  if (!draft.customerName || draft.customerName.trim().length < 3) {
    faltan.push('nombre y apellido de quien compra');
  }
  if (!draft.customerPhone) faltan.push('teléfono');
  if (!draft.deliveryDate) faltan.push('día de retiro o entrega');

  const envioNuestro = draft.deliveryMode === 'cadete-miska';
  if (envioNuestro) {
    if (!draft.address) faltan.push('dirección con alguna referencia');
    if (!draft.deliveryTime) faltan.push('franja horaria');
    if (itemsDeEnvioPropio(draft, productsById).length && !draft.recipientName) {
      faltan.push('nombre de quien lo recibe');
    }
  } else if (!draft.deliveryTime) {
    faltan.push('hora de retiro');
  }

  return faltan;
}

/**
 * Valida un pedido antes de guardarlo. Devuelve la lista de problemas; vacío
 * significa que se puede crear.
 */
export function validateOrder(
  draft: OrderDraft,
  productsById: Map<string, Product>,
): PolicyViolation[] {
  const problems: PolicyViolation[] = [];

  /*
    Un solo problema con TODO lo que falta, en vez de uno por dato. Antes salían
    de a uno (nombre acá, dirección más abajo) y el bot los pedía de a uno, que es
    justo lo que la dueña marcó: primero fecha y dirección, después nombre y
    teléfono, más adelante el horario.
  */
  const faltan = datosFaltantes(draft, productsById);
  if (faltan.length) {
    problems.push({
      code: 'faltan_datos',
      message:
        `Todavía falta: ${faltan.join(', ')}. Pedile TODO eso junto en un mismo mensaje, sin ` +
        'repetir lo que ya te dio y sin agregar preguntas que no te hizo.',
    });
  }

  if (!draft.items.length) {
    problems.push({ code: 'sin_items', message: 'El pedido no tiene ningún producto.' });
  }

  /*
    El precio salía únicamente de buscar producto_id en el catálogo, y ese campo
    es opcional: si el modelo no lo mandaba, el ítem entraba a 0 y el pedido se
    guardaba en silencio por $0. El local se enteraba recién al ir a cobrar.

    Que falle acá es lo que hace que el bot pregunte en vez de inventar. Un ítem
    verdaderamente gratis —una cortesía— hay que cargarlo desde el panel: es lo
    bastante raro como para no merecer una vía en la que un precio perdido pase
    por regalo.
  */
  const sinPrecio = draft.items.filter((i) => !(i.unitPrice > 0));
  if (sinPrecio.length) {
    problems.push({
      code: 'sin_precio',
      message:
        `No tengo el precio de: ${sinPrecio.map((i) => i.description).join(', ')}. ` +
        'Si está en el catálogo, llamá a buscar_catalogo y pasá su producto_id. ' +
        'Si es algo a medida, acordá el precio con el cliente y mandalo en precio_unitario. ' +
        'No cargues el pedido con el precio en cero.',
    });
  }

  const isDelivery = draft.deliveryMode === 'cadete-miska';
  if (isDelivery) {
    const pickupOnly = draft.items
      .map((i) => (i.productId ? productsById.get(i.productId) : undefined))
      .filter((p): p is Product => Boolean(p?.pickupOnly));
    if (pickupOnly.length) {
      problems.push({
        code: 'torta_no_se_envia',
        message:
          `No enviamos ${pickupOnly.map((p) => p.name).join(', ')} a domicilio. ` +
          'Hay que explicarle al cliente que es para que llegue en buenas condiciones, y ofrecerle ' +
          'retirar en el local o mandar un Uber/cadete propio que nosotros cargamos en la puerta.',
      });
    }
    // La dirección y la franja las reclama `datosFaltantes`, junto con el resto:
    // pedirlas dos veces hacía que el bot volviera a preguntar lo mismo.
  }

  /*
    La guarda que costó plata: un desayuno sorpresa despachado en el Uber del
    cliente, sin dirección y sin nadie que lo entregue. Hasta acá `uber-cliente`
    no se validaba en ninguna rama de esta función.
  */
  const envioPropio = itemsDeEnvioPropio(draft, productsById);
  if (draft.deliveryMode === 'uber-cliente' && envioPropio.length) {
    problems.push({
      code: 'desayuno_no_va_en_uber',
      message:
        `${envioPropio.map((i) => i.description).join(', ')}: eso lo llevamos nosotros, con ` +
        'nuestro cadete. No va en Uber ni con un cadete del cliente, porque el envío es parte ' +
        'de la sorpresa. Decíselo así, en positivo, no como una negativa. Cargalo con ' +
        'modalidad cadete-miska y pedile en UN solo mensaje lo que falte. Si el cliente ' +
        'insiste con mandar un Uber, o si el pedido mezcla esto con una torta que sí sale en ' +
        'Uber, no decidas vos: decile que lo consultás en cocina y escalá. No cargues dos ' +
        'pedidos. Y no le expliques tiempos, zonas ni costos de envío: eso no lo tenés.',
    });
  }

  /*
    El mismo agujero por la otra puerta: retira-local con el nombre de un tercero.
    El regalo sale con alguien que no es quien compra, sin sorpresa y sin que
    sepamos quién se lo llevó. Se compara el nombre porque el esquema pide repetir
    el de quien compra cuando lo recibe él mismo, y ese caso es legítimo.
  */
  if (
    draft.deliveryMode === 'retira-local' &&
    envioPropio.length &&
    draft.recipientName &&
    normalizarNombre(draft.recipientName) !== normalizarNombre(draft.customerName)
  ) {
    problems.push({
      code: 'desayuno_no_lo_retira_un_tercero',
      message:
        `${envioPropio.map((i) => i.description).join(', ')}: si lo retira alguien que no es ` +
        'quien compra, eso lo autoriza el local. O lo llevamos nosotros con nuestro cadete ' +
        '(cargalo con cadete-miska y pedile la dirección, el día y la franja en UN mensaje), o ' +
        'lo retira quien compra. Si insisten con mandar a otra persona, decile que lo consultás ' +
        'en cocina y escalá.',
    });
  }

  const unavailable = draft.items
    .map((i) => (i.productId ? productsById.get(i.productId) : undefined))
    .filter((p): p is Product => Boolean(p && !p.availableToday));
  if (unavailable.length) {
    problems.push({
      code: 'no_disponible',
      message:
        `Hoy no hay ${unavailable.map((p) => p.name).join(', ')}. ` +
        'Hay que avisarle y ofrecerle algo parecido de lo que sí tenemos.',
    });
  }

  if (draft.deliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.deliveryDate)) {
    problems.push({
      code: 'fecha_invalida',
      message: 'La fecha de retiro tiene que estar en formato AAAA-MM-DD.',
    });
  }

  if (draft.deliveryDate) {
    // En el huso de Tucumán, no en UTC: con UTC, a las 21:00 de acá ya es
    // "mañana" y un pedido para esta noche quedaba rechazado como fecha pasada.
    const today = localToday();
    if (draft.deliveryDate < today) {
      problems.push({
        code: 'fecha_pasada',
        message: 'La fecha de retiro ya pasó. Hay que reconfirmar con el cliente.',
      });
    }
  }

  return problems;
}

/*
  Advertencias de uso de los mensajes rápidos. Van pegadas al resultado de la
  herramienta y no al system prompt: una regla a 4000 tokens de distancia pesa
  mucho menos que la misma regla al lado del texto que el modelo está leyendo para
  decidir. Las claves son las del panel; si alguien borra o renombra un mensaje
  desde ahí, su nota queda sin usar y no pasa nada.
*/
const NOTAS_DE_USO: Record<string, string> = {
  uber:
    'Este mensaje es SOLO para cuando el cliente quiere algo para el momento, o para una ' +
    'torta o tarta (que no enviamos). Si están hablando de un desayuno o un box de regalo, ' +
    'no lo mandes: eso lo llevamos nosotros. Si el cliente no quiere mandar un Uber, no ' +
    'cierres la venta ahí: contale que cadete propio tenemos, que va a tardar más porque ' +
    'sale cuando termina su recorrido, y escalá para que una persona vea si está disponible.',
  desayunos:
    'El texto dice que enviamos en el horario que necesite, y eso es así: lo llevamos ' +
    'nosotros. Pero no lo estires: no prometas una hora exacta, ni cuánto tarda, ni hasta ' +
    'qué localidad llegamos, ni cuánto sale el envío. Si preguntan eso, consultá o escalá.',
};

/** Nota interna sobre cuándo NO usar un mensaje rápido, si tiene una. */
export const notaDeUsoMensajeRapido = (clave: string): string | undefined => NOTAS_DE_USO[clave];

/** Textos operativos que el bot cita literalmente. */
export function operationalFacts(settings: BotSettings): string {
  return `
DATOS OPERATIVOS (citalos exactos, no los inventes)
- Dirección del local: ${settings.address}
- Alias para transferencias: ${settings.transferAlias}
- Titular / Mercado Pago: ${settings.transferHolder}
- Tienda online: ${settings.webUrl}
- Cursos online: ${settings.coursesUrl}
- Desayunos y boxes: ${settings.breakfastsUrl}
- Horario de atención del local: ${settings.scheduleText}
`.trim();
}

/** true si estamos fuera del horario del local (hora de Tucumán). */
export function isOutsideBusinessHours(settings: BotSettings, at = new Date()): boolean {
  const hour = localHour(at);
  return hour < settings.openHour || hour >= settings.closeHour;
}
