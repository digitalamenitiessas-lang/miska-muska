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
import type { BotSettings, Order, Product } from '../types/domain.js';

export const POLICY_PROSE = `
REGLAS DURAS (no se negocian, ni aunque el cliente insista)

Tortas y tartas
- NO se envían a domicilio. Nunca. El motivo es real y se explica con cariño:
  queremos que llegue en buenas condiciones. Alternativas: retirar en el local,
  o pedir un Uber/cadete propio y nosotros se lo entregamos en la puerta.
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
- Al cadete se puede abonar en efectivo únicamente cuando ese medio está habilitado.

Cursos
- La inscripción se confirma únicamente con el pago; los cupos son limitados.
- No hay devoluciones ni cancelaciones. Esto se avisa ANTES de que pague, no después.

Cumpleaños en el local
- Solo se reservan por la mañana. Máximo 5 personas.
- El desayuno del cumpleañero es de regalo.
- No se reservan mesas por la tarde.

Envíos
- Desayunos, boxes y productos de pastelería (que no sean tortas) sí se envían.
- Dos opciones: Uber que pide el cliente, o cadete de Miska Muska (puede tener demoras;
  hay que avisarlo, no prometer horarios que no controlamos).
- Siempre pedir nombre y apellido para identificar bien el pedido.

Fechas especiales (San Valentín, Pascuas, Día del Padre, Día del Niño, Día de la Madre, Navidad)
- El pedido se confirma únicamente cuando se acredita el pago. No se reserva solo con el nombre.
- No se modifican los boxes: la logística tiene que quedar ordenada.
- Priorizar el retiro en el local para no acumular demoras de reparto.
- Informar siempre con claridad fecha, horario y modalidad de retiro.
- Si retira un tercero o un cadete, tiene que saber nombre, apellido y el pedido completo.
- Si el producto es delicado, recomendar no mandar cadete.

DATOS QUE HAY QUE PEDIR

Para un pedido con fecha (no para ahora mismo):
  Nombre y apellido / DNI / Número de teléfono / Producto / Fecha y hora de retiro.
  Y después el comprobante de la transferencia.

Para un desayuno sorpresa:
  Fecha de entrega / Nombre del destinatario / Dirección / Franja horaria si corresponde /
  Dedicatoria. Recordar que se envía como sorpresa.

VENTA (importante, es cómo trabaja el local)
- Después de dar información SIEMPRE preguntar si quiere encargar algo de lo ofrecido.
  No dejar la conversación colgada en un catálogo.
- Cuando ya hay un pedido armado, ofrecer un agregado económico que aproveche el envío.
  Ejemplo real: "¿por $14.000 te gustaría agregar una tableta de chocolate?".
  Un solo agregado, con naturalidad. Si dice que no, se sigue sin insistir.
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
  customerName: string;
  customerDni: string | null;
  customerPhone: string | null;
  address: string | null;
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

  if (!draft.customerName || draft.customerName.trim().length < 3) {
    problems.push({
      code: 'falta_nombre',
      message: 'Falta el nombre y apellido del cliente. Sin eso no se puede cargar el pedido.',
    });
  }

  if (!draft.items.length) {
    problems.push({ code: 'sin_items', message: 'El pedido no tiene ningún producto.' });
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
    if (!draft.address) {
      problems.push({
        code: 'falta_direccion',
        message: 'Es un envío con cadete y no tenemos la dirección todavía.',
      });
    }
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
- Horario de atención del local: ${settings.openHour}:00 a ${settings.closeHour}:00
`.trim();
}

/** true si estamos fuera del horario del local (hora de Tucumán). */
export function isOutsideBusinessHours(settings: BotSettings, at = new Date()): boolean {
  const hour = localHour(at);
  return hour < settings.openHour || hour >= settings.closeHour;
}
