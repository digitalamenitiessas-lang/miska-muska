/**
 * MIRA LO QUE EL BOT DICE DE PRECIOS. NO LO CORRIGE.
 *
 * Esto no es una guarda: es un termómetro. La diferencia importa y por eso está
 * escrita acá arriba.
 *
 * La historia: una carta que mandó el bot tenía la cookie red velvet a $4500
 * cuando el catálogo decía $4000, y la conclusión apurada fue "el modelo inventa
 * precios". Después apareció la explicación de verdad: la semilla le reseteaba
 * los precios en cada arranque, el local los cambiaba, y entre un despliegue y
 * otro el catálogo iba y venía. El bot lo había leído bien todas las veces.
 *
 * Con eso arreglado, no queda un solo caso confirmado de precio inventado. Y una
 * guarda que reescribe mensajes tiene su propio riesgo: corregir el número
 * equivocado —un total, una seña, el "por $14.000 te sumo una tableta"— es un
 * daño que hoy no existe. Escribir eso sin un caso real sería cambiar un
 * problema que no tenemos por uno que sí.
 *
 * Así que primero se mide. Esto anota en el log cuando lo que el bot escribió no
 * coincide con el catálogo, y no toca el mensaje. Si en unas semanas el log está
 * vacío, quedó demostrado que no hacía falta. Si se enciende, la guarda se
 * escribe con casos de verdad en la mano en vez de con una teoría.
 */

import type { Product } from '../types/domain.js';

/**
 * Sin mayúsculas ni acentos, para comparar contra lo que escribe el modelo.
 *
 * El rango va con escapes y no con los caracteres pegados: son marcas
 * combinantes, invisibles en el editor, y un copiar y pegar las come sin que
 * nadie lo note. Ya pasó una vez, en un script que por eso midió cero errores
 * donde había dos.
 */
const normalizar = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Cuántos caracteres se miran después del nombre para encontrarle el precio.
 *
 * Corto a propósito. En una carta el precio va pegado al nombre ("cookie nutella
 * $5000"); estirarlo empieza a agarrar el precio del renglón siguiente y a
 * inventar diferencias que no existen.
 */
const VENTANA = 20;

const PRECIO = /\$\s?([0-9][0-9.,]*)/;

export interface PrecioDicho {
  producto: string;
  /** Lo que escribió el bot. */
  dijo: number;
  /** Lo que dice el catálogo. */
  catalogo: number;
}

/**
 * Precios que el bot escribió pegados a un producto y no coinciden con el
 * catálogo.
 *
 * Solo mira el número que está INMEDIATAMENTE después del nombre. Un total
 * ("son $12.500 en total"), una seña o el alias no tienen un nombre de producto
 * adelante, así que no entran acá — que es lo que lo hace barato y silencioso.
 */
export function preciosQueNoCoinciden(text: string, products: Product[]): PrecioDicho[] {
  const plano = normalizar(text);
  const encontrados: PrecioDicho[] = [];

  for (const p of products) {
    const nombre = normalizar(p.name);
    if (nombre.length < 4) continue;

    let desde = plano.indexOf(nombre);
    while (desde >= 0) {
      const cerca = plano.slice(desde + nombre.length, desde + nombre.length + VENTANA);
      const m = cerca.match(PRECIO);
      if (m) {
        // "4.500" y "4500" son el mismo número: los puntos son separadores de
        // miles, no decimales. Acá no hay centavos.
        const dijo = Number(m[1].replace(/[.,]/g, ''));
        if (Number.isFinite(dijo) && dijo > 0 && dijo !== p.price) {
          encontrados.push({ producto: p.name, dijo, catalogo: p.price });
        }
      }
      desde = plano.indexOf(nombre, desde + 1);
    }
  }

  return encontrados;
}

/**
 * Productos apagados que el bot igual listó con precio.
 *
 * El precio al lado es lo que distingue ofrecer de negar: "hoy no tenemos cookie
 * de vainilla" es exactamente lo que queremos que diga, y no lleva número.
 * "cookie vainilla con chips $4000" adentro de una carta, sí.
 */
export function agotadosConPrecio(text: string, products: Product[]): string[] {
  const plano = normalizar(text);
  const nombres: string[] = [];

  for (const p of products) {
    if (p.availableToday) continue;
    const nombre = normalizar(p.name);
    if (nombre.length < 4) continue;

    const desde = plano.indexOf(nombre);
    if (desde < 0) continue;
    const cerca = plano.slice(desde + nombre.length, desde + nombre.length + VENTANA);
    if (PRECIO.test(cerca)) nombres.push(p.name);
  }

  return nombres;
}
