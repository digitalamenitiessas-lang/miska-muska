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
*/

/** Un renglón de la cuenta, ya resuelto. */
interface Renglon {
  /** Lo que aporta al total. */
  subtotal: number;
  /** El precio es unitario y hubo que multiplicarlo. */
  multiplicado: boolean;
}

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

/** La cantidad de un renglón: "3 Budín", "2x Muffin", "Alfajor x3". */
function cantidad(linea: string): number {
  const m =
    linea.match(/(?:^|[^\w$])(\d{1,2})\s*x\b/i) ??
    linea.match(/\bx\s*(\d{1,2})\b/i) ??
    linea.match(/^[^\w$]*(\d{1,2})\s+[a-záéíóúñ]/i);
  const n = m ? Number(m[1]) : 1;
  return n >= 1 && n <= 50 ? n : 1;
}

/**
 * ¿Esta línea es un renglón de la cuenta?
 *
 * Los renglones empiezan con un emoji, un guion, un asterisco o un número. La
 * prosa empieza con una letra, y ahí es donde aparecen los precios que NO son
 * parte de la cuenta: "nuestras cajas de regalo van a partir de $26.000".
 */
function esRenglon(linea: string): boolean {
  const l = linea.trim();
  if (!l || /total/i.test(l)) return false;
  if (pesos(l).length !== 1) return false;
  return !/^[a-záéíóúñ¿¡"'(]/i.test(l);
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

/**
 * Revisa la cuenta de un mensaje. `null` si no hay ninguna cuenta que revisar,
 * que es la enorme mayoría de los mensajes.
 */
export function revisarCuenta(texto: string): Cuenta | null {
  const lineas = texto.split('\n');

  /*
    El ÚLTIMO total y no el primero: si el mensaje trae un subtotal y abajo el
    total con el envío, el que vale es el de abajo.
  */
  const iTotal = lineas.reduce(
    (ultimo, l, i) => (/total/i.test(l) && pesos(l).length === 1 ? i : ultimo),
    -1,
  );
  if (iTotal <= 0) return null;

  const dijo = pesos(lineas[iTotal])[0];
  const arriba = lineas.slice(0, iTotal);
  const renglones: Renglon[] = [];

  for (const l of arriba) {
    if (!esRenglon(l)) continue;
    const precio = pesos(l)[0];
    const multiplicar = /c\/u|cada un/i.test(l);
    renglones.push({
      subtotal: multiplicar ? precio * cantidad(l) : precio,
      multiplicado: multiplicar,
    });
  }
  if (renglones.length < 2) return null;

  const da = renglones.reduce((s, r) => s + r.subtotal, 0);

  /*
    CUÁNDO NO ME CREO LA LECTURA.

    - Un precio abierto en el mensaje: "desde $26.000" no es un renglón, y si se
      me coló adentro la suma da cualquier cosa.
    - Más de ocho renglones: eso ya no es un pedido, es la carta, y el total de
      abajo no suma la carta entera.
    - Un renglón con cantidad pero sin "c/u": ahí no se sabe si el precio ya
      viene multiplicado. "Alfajor x3 — $12.900" ya está sumado; "3 Budín $4.000
      c/u" no. Sin el "c/u" la línea es ambigua y no la interpreto.
  */
  const hayAbierto = arriba.some((l) => PRECIO_ABIERTO.test(l) && pesos(l).length > 0);
  const ambiguo = arriba.some(
    (l) => esRenglon(l) && cantidad(l) > 1 && !/c\/u|cada un/i.test(l),
  );
  const confiable = !hayAbierto && !ambiguo && renglones.length <= 8;

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
  const iTotal = lineas.reduce(
    (ultimo, l, i) => (/total/i.test(l) && pesos(l).length === 1 ? i : ultimo),
    -1,
  );

  // Se escribe como lo escribe el local: punto para los miles.
  const bien = '$' + cuenta.da.toLocaleString('es-AR');
  lineas[iTotal] = lineas[iTotal].replace(/\$\s?[\d.]+/, bien);

  return { texto: lineas.join('\n'), corregido: cuenta };
}
