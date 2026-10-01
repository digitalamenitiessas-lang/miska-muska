/*
  LA SUMA NO ES UNA OPINIÓN.

  Del local, un viernes a las 15:47: "está haciendo mal la suma de los totales,
  está mandando totales de pedidos que no corresponden".

  Es real y salió así:

    🧁 2x Muffin pistacho — $4.800 c/u
    🧁 1x Muffin maracuyá — $4.100
    🧁 1x Muffin vainilla con chips — $4.100
    **Total:** $17.700          ← son $17.800

  Cien pesos. Pero el que lo mira del otro lado no piensa "se equivocó en cien":
  piensa que la cuenta está mal, y de ahí en adelante revisa todo lo que le
  pasamos. Y del lado del local alguien tiene que cobrar un número que no cierra.

  Esto NO va en la prosa, y es la diferencia que importa. Una regla de escritura
  se le pide al modelo y a veces sale; una suma tiene UN resultado y se puede
  calcular acá, sin preguntarle a nadie. La cuenta está entera dentro del
  mensaje: los renglones arriba, el total abajo. No hace falta el catálogo ni la
  base de pedidos.

  Se CORRIGE, no se avisa. Es la única guarda del sistema que reescribe un
  número, y se justifica porque no hay criterio de por medio: 4.800 por 2 más
  4.100 más 4.100 da 17.800 y no hay una segunda lectura posible. Pero solo se
  toca cuando el mensaje se leyó ENTERO y sin ambigüedad —ver `confiable`—;
  ante la menor duda no se toca nada y queda anotado, porque romper una cuenta
  buena es peor que dejar pasar una mala.

  ──────────────────────────────────────────────────────────────────────────
  LO QUE SE LE ESCAPÓ, Y POR QUÉ (30 de septiembre, pedido de Cami).

  Tres veces seguidas en la misma conversación mandó $44.800 donde los
  renglones daban $38.800. El número llegó hasta el pedido de transferencia, la
  clienta pagó 6.000 de más, a las 23:01 escribió "me cobraron de más" y al día
  siguiente el local tuvo que devolverle la diferencia y pedirle disculpas.

  La guarda había leído la cuenta BIEN —38.800— y se calló igual, por esta
  línea:

    🍪 Cookie Kinder (x3) — $15.000

  La regla vieja decía: hay cantidad pero no dice "c/u", así que no sé si
  $15.000 es el precio de una o de las tres, y ante la duda no toco. El miedo
  era razonable. Pero era una duda teórica, y se podía preguntar.

  Se le preguntó a los mensajes de verdad: 42 mensajes con esa forma en 60
  días. En 38 el total escrito coincidía con leer el precio como YA
  multiplicado. En CERO coincidía con leerlo como unitario. Los 4 restantes
  eran cuentas mal hechas. O sea que la lectura "unitaria" no es una ambigüedad
  real: es una que nunca ocurrió, y por cuidarse de ella se dejaron pasar las
  que sí.

  Así que el renglón con un solo precio vale lo que dice, y la cantidad no lo
  multiplica salvo que esté el "c/u".

  LO QUE SÍ ERA UNA TRAMPA, y es el motivo de que esto no se cambiara antes:

    🥪 Sandwich en pan de chipá x2 — $7.800 c/u = $15.600

  Dos precios en un renglón. La regla vieja lo descartaba entero —exigía
  exactamente un precio— y la suma quedaba $15.600 corta. Si se hubiera
  levantado la ambigüedad sin mirar esto, la guarda le habría "corregido" a esa
  clienta un total que estaba perfecto. Por eso ahora esa forma se lee —el bot
  ya hizo la multiplicación y la dejó escrita, se toma el número de la derecha—
  y cualquier renglón con plata que NO se haya podido leer apaga la corrección
  entera. Ver `plataSinLeer`.

  Medido sobre 186 mensajes con cuenta de 120 días: corrige 4, y los 4 estaban
  mal. Ninguno de los otros 182 se toca.
*/

/**
 * Los pesos de un texto.
 *
 * En Argentina el punto separa los miles —"$12.900"— así que se BORRA. Leerlo
 * como decimal convierte doce mil novecientos en doce con nueve.
 */
function pesos(texto: string): number[] {
  return [...texto.matchAll(/\$\s?([\d.]+)/g)]
    .map((m) => Number(m[1].replace(/\./g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** La cantidad de un renglón: "3 Budín", "2x Muffin", "Alfajor x3", "(x3)". */
function cantidad(linea: string): number {
  const m =
    linea.match(/(?:^|[^\w$])(\d{1,2})\s*x\b/i) ??
    linea.match(/\bx\s*(\d{1,2})\b/i) ??
    linea.match(/^[^\w$]*(\d{1,2})\s+[a-záéíóúñ]/i);
  const n = m ? Number(m[1]) : 1;
  return n >= 1 && n <= 50 ? n : 1;
}

/** "c/u", "cada uno": el precio del renglón es el de una unidad. */
const POR_UNIDAD = /c\/u|cada un/i;

/** "x2 — $7.800 c/u = $15.600": el bot ya multiplicó y dejó la cuenta escrita. */
const UNIDAD_RESUELTA = /c\/u\s*=\s*\$/i;

/**
 * ¿Esta línea es prosa?
 *
 * La prosa empieza con una letra, y ahí es donde aparecen los precios que NO
 * son parte de la cuenta: "nuestras cajas de regalo van a partir de $26.000".
 * Los renglones empiezan con un emoji, un guion, un asterisco o un número.
 */
function esProsa(linea: string): boolean {
  return /^[a-záéíóúñ¿¡"'(]/i.test(linea.trim());
}

/**
 * Lo que este renglón aporta al total, o `null` si la línea no es un renglón
 * que pueda leer.
 */
function subtotalDe(linea: string): number | null {
  const l = linea.trim();
  if (!l || /total/i.test(l) || esProsa(l)) return null;

  const p = pesos(l);
  // El unitario y el subtotal, los dos escritos: vale el de la derecha.
  if (p.length === 2 && UNIDAD_RESUELTA.test(l)) return p[1];
  if (p.length !== 1) return null;
  // Con "c/u" el precio es de a una y hay que multiplicar; sin "c/u" ya está.
  return POR_UNIDAD.test(l) ? p[0] * cantidad(l) : p[0];
}

/**
 * Una línea que tiene plata y que NO pude leer como renglón.
 *
 * Es la red de seguridad que reemplazó a la regla de la ambigüedad: si hay
 * pesos dando vueltas en un formato que no entiendo, mi suma está incompleta y
 * no tengo derecho a corregir nada.
 */
function plataSinLeer(linea: string): boolean {
  const l = linea.trim();
  if (!l || /total/i.test(l) || esProsa(l)) return false;
  return pesos(l).length > 0 && subtotalDe(l) === null;
}

/** Un precio que no es un precio cerrado: "desde", "a partir de", "entre". */
const PRECIO_ABIERTO = /\b(desde|a partir de|aprox|alrededor de|entre)\b/i;

export interface Cuenta {
  /** El total que escribió el bot. */
  dijo: number;
  /** El total que dan los renglones. */
  da: number;
  /**
   * El mensaje se leyó entero y sin ambigüedad. Si es `false` la diferencia
   * puede ser mía y no del bot, así que no se toca nada.
   */
  confiable: boolean;
}

/** Dónde está el renglón del total: el ÚLTIMO, no el primero. */
function dondeEstaElTotal(lineas: string[]): number {
  /*
    Si el mensaje trae un subtotal y abajo el total con el envío, el que vale
    es el de abajo.
  */
  return lineas.reduce(
    (ultimo, l, i) => (/total/i.test(l) && pesos(l).length === 1 ? i : ultimo),
    -1,
  );
}

/**
 * Revisa la cuenta de un mensaje. `null` si no hay ninguna cuenta que revisar,
 * que es la enorme mayoría de los mensajes.
 */
export function revisarCuenta(texto: string): Cuenta | null {
  const lineas = texto.split('\n');
  const iTotal = dondeEstaElTotal(lineas);
  if (iTotal <= 0) return null;

  const dijo = pesos(lineas[iTotal])[0];
  const arriba = lineas.slice(0, iTotal);

  const subtotales = arriba
    .map(subtotalDe)
    .filter((s): s is number => s !== null);
  if (subtotales.length < 2) return null;

  const da = subtotales.reduce((s, n) => s + n, 0);

  /*
    CUÁNDO NO ME CREO LA LECTURA.

    - Un precio abierto en el mensaje: "desde $26.000" no es un renglón, y si
      se me coló adentro la suma da cualquier cosa.
    - Una línea con pesos que no supe leer: la suma está incompleta.
    - Más de ocho renglones: eso ya no es un pedido, es la carta, y el total de
      abajo no suma la carta entera.
  */
  const hayAbierto = arriba.some((l) => PRECIO_ABIERTO.test(l) && pesos(l).length > 0);
  const hayIlegible = arriba.some(plataSinLeer);
  const confiable = !hayAbierto && !hayIlegible && subtotales.length <= 8;

  return { dijo, da, confiable };
}

/**
 * Corrige el total de un mensaje. Devuelve el texto igual si no hay nada que
 * corregir, y el mismo texto con el número arreglado si la cuenta no daba.
 *
 * Se reemplaza SOLO el número del renglón del total; el resto del mensaje —el
 * formato, los emojis, las negritas— queda intacto.
 */
export function corregirTotal(texto: string): { texto: string; corregido: Cuenta | null } {
  const cuenta = revisarCuenta(texto);
  if (!cuenta || cuenta.dijo === cuenta.da || !cuenta.confiable) {
    return { texto, corregido: null };
  }

  const lineas = texto.split('\n');
  const iTotal = dondeEstaElTotal(lineas);

  // Se escribe como lo escribe el local: punto para los miles.
  const bien = '$' + cuenta.da.toLocaleString('es-AR');
  lineas[iTotal] = lineas[iTotal].replace(/\$\s?[\d.]+/, bien);

  return { texto: lineas.join('\n'), corregido: cuenta };
}
