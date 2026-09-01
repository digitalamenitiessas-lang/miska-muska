/**
 * Achicar una foto antes de mandarla.
 *
 * Hace falta por tres cosas que se rompen sin esto, y las tres pasan con la
 * foto de un celular:
 *
 *  - EL TAMAÑO. El servidor acepta 5 MB y una foto de celular moderno pesa 8 o
 *    12. Sin achicarla, elegir la foto y que falle es lo único que ve el
 *    operador.
 *  - EL FORMATO. Un iPhone guarda HEIC, que el servidor no acepta. Al pasarla
 *    por un canvas sale JPEG, y el navegador que la pudo mostrar la pudo
 *    decodificar.
 *  - EL TIEMPO. Del otro lado hay una clienta esperando y una foto de 12 MB
 *    tarda en subir, en guardarse y en que Meta la vuelva a bajar.
 *
 * Mil seiscientos píxeles es de sobra para mirar una torta en un teléfono, y
 * deja el archivo en unos cientos de kilobytes.
 */

/** El lado más largo que va a tener la foto después de achicarla. */
const LADO_MAXIMO = 1600;

/** Cuánto se comprime. 0.85 no se nota a simple vista y pesa la mitad. */
const CALIDAD = 0.85;

/** Abajo de esto no vale la pena tocarla: se manda tal cual. */
const YA_ES_CHICA = 900 * 1024;

const TIPOS_QUE_ACEPTA_EL_SERVIDOR = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Devuelve la foto lista para subir: achicada si hacía falta, o la original si
 * ya estaba bien.
 *
 * Nunca tira. Si el navegador no puede decodificarla —un HEIC en Chrome de
 * escritorio, por ejemplo— devuelve el archivo original y que sea el servidor
 * el que diga que no puede: el error de allá es más preciso que uno inventado
 * acá.
 */
export async function prepararFoto(file: File): Promise<File> {
  const chicaYCompatible = file.size <= YA_ES_CHICA && TIPOS_QUE_ACEPTA_EL_SERVIDOR.has(file.type);
  if (chicaYCompatible) return file;

  // Se libera pase lo que pase: un ImageBitmap que no se cierra retiene el mapa
  // de bits descomprimido, que en una foto de celular son decenas de megas.
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);

    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext('2d');
    if (!ctx) return file;

    /*
      El fondo blanco va ANTES de dibujar, y no es un detalle: un canvas nace
      transparente y el JPEG no tiene transparencia, así que lo transparente se
      rellena con negro. Un flyer PNG con fondo transparente, o una captura de
      Mac con las esquinas redondeadas, le llegaban a la clienta con el fondo
      negro.
    */
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ancho, alto);
    ctx.drawImage(bitmap, 0, 0, ancho, alto);

    const blob = await new Promise<Blob | null>((resolve) =>
      lienzo.toBlob(resolve, 'image/jpeg', CALIDAD),
    );
    if (!blob) return file;

    // Si el "achicado" quedó más pesado que el original, gana el original.
    if (blob.size >= file.size && TIPOS_QUE_ACEPTA_EL_SERVIDOR.has(file.type)) return file;

    const nombre = file.name.replace(/\.[^.]+$/, '') || 'foto';
    return new File([blob], `${nombre}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
