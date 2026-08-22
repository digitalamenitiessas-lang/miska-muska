/**
 * Cómo se escribe, en código.
 *
 * La forma cuesta credibilidad igual que la plata: la dueña lee cada mensaje, y
 * un signo de apertura o un "te copa alguno?" le suenan a otra marca. Así que va
 * dos veces, como las reglas de negocio: en prosa en el system prompt (el bloque
 * WRITING de `agent/persona.ts`) y como guarda acá.
 *
 * Lo que se corrige en código es solo lo determinista y sin pérdida: borrar el
 * signo de apertura y traducir "copa". Cuántos emojis lleva un mensaje NO se
 * decide acá: eso es criterio, no regla, y una guarda que los borra a ciegas le
 * saca el 🙏🏻 justo al mensaje del papá internado. Eso vive solo en el prompt.
 *
 * Se aplica al texto que genera el modelo y al que sale de un mensaje rápido.
 * NO se aplica a lo que escribe una persona del local: corregirle la ortografía
 * a Mica sería un bug, no una mejora.
 */

/** Signos de apertura del español. El equipo escribe solo el de cierre. */
export const APERTURA = /[¿¡]/g;

/*
  "copa" no se usa: no es una palabra de la casa. El mapa es CERRADO y está
  anclado a "te/me + copa", así nunca toca una "copa de mousse" ni un producto
  futuro que se llame Copa. Si aparece una forma que no está acá, sale igual y se
  agrega a mano: reescritura libre no, porque no sería auditable.
*/
export const COPA: Array<[RegExp, string]> = [
  [/\bte coparí([ao])\b/gi, 'te gustarí$1'],
  [/\bte copan\b/gi, 'te gustan'],
  [/\bte copa\b/gi, 'te gusta'],
  [/\bme copan\b/gi, 'me gustan'],
  [/\bme copa\b/gi, 'me gusta'],
];

export interface WritingResult {
  text: string;
  /** Qué hubo que corregir. Vacío significa que el prompt cumplió solo. */
  fixes: string[];
}

/**
 * Normaliza un texto del bot. Idempotente, y seguro sobre alias, precios,
 * direcciones, links y {{placeholders}}: solo borra dos caracteres y reemplaza
 * una palabra anclada.
 *
 * Se compara el resultado en vez de usar `.test()` a propósito: un regex con la
 * bandera `g` guarda `lastIndex` entre llamadas y `test` lo mueve, así que
 * mezclarlo con `replace` sobre la misma constante es una fuente de bugs que se
 * ven una vez cada mil mensajes.
 */
export function normalizeWriting(text: string): WritingResult {
  const fixes: string[] = [];
  let out = text;

  const sinApertura = out.replace(APERTURA, '');
  if (sinApertura !== out) {
    fixes.push('signo de apertura');
    // Borrar el signo puede dejar un espacio doble: "Hola. ¡Mirá" → "Hola.  Mirá".
    out = sinApertura.replace(/[ \t]{2,}/g, ' ');
  }

  for (const [re, to] of COPA) {
    const traducido = out.replace(re, to);
    if (traducido !== out) {
      fixes.push('la palabra copa');
      out = traducido;
    }
  }

  return { text: out.trim(), fixes };
}

/** Normaliza las burbujas de un turno y descarta las que queden vacías. */
export function normalizeBubbles(bubbles: string[]): { bubbles: string[]; fixes: string[] } {
  const fixes: string[] = [];
  const out: string[] = [];
  for (const bubble of bubbles) {
    const result = normalizeWriting(bubble);
    fixes.push(...result.fixes);
    // Una burbuja que era solo puntuación puede quedar vacía, y un texto vacío
    // hace fallar el envío en el canal.
    if (result.text) out.push(result.text);
  }
  return { bubbles: out, fixes: [...new Set(fixes)] };
}
