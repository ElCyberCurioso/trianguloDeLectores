/**
 * Descodificador de códigos de barras de reserva.
 *
 * Se carga **sólo** si el navegador no trae `BarcodeDetector` nativo, que es el
 * caso de Safari y Firefox. Va en su propio bundle y se importa a mano en ese
 * momento: son unos cuantos cientos de kilobytes que no tiene sentido servir a
 * quien no los necesita, ni en las demás páginas de la biblioteca.
 *
 * ZXing en JavaScript puro, no en WebAssembly: bastante tiene ya la CSP con lo
 * que pdf.js necesita.
 */
import {
  MultiFormatOneDReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource,
  DecodeHintType, BarcodeFormat,
} from '@zxing/library';

// Sólo los códigos que lleva un libro. Limitar los formatos acelera cada
// fotograma y evita leer por error el código de otra cosa que haya en la mesa.
const hints = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8]],
  [DecodeHintType.TRY_HARDER, true],
]);

const reader = new MultiFormatOneDReader(hints);

/**
 * Busca un código de barras en un fotograma. Devuelve el número leído o `null`
 * si en ese fotograma no había nada legible, que es lo normal casi siempre.
 */
export function decodeFrame(canvas: HTMLCanvasElement): string | null {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  const { width, height } = canvas;
  const image = context.getImageData(0, 0, width, height);

  // ZXing trabaja sobre luminancia, no sobre color: se convierte aquí con los
  // coeficientes de siempre en vez de dejar que lo haga con una copia de más.
  const pixels = image.data;
  const luminances = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j += 1) {
    luminances[j] = ((pixels[i]! * 306) + (pixels[i + 1]! * 601) + (pixels[i + 2]! * 117)) >> 10;
  }

  try {
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminances, width, height)));
    return reader.decode(bitmap, hints as never).getText();
  } catch {
    // ZXing lanza `NotFoundException` en cada fotograma sin código. Es el caso
    // corriente, no un error: se mira el siguiente.
    return null;
  } finally {
    reader.reset();
  }
}
