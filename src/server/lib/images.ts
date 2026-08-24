import type { Bindings } from '../../types/env';

/**
 * Portadas en R2 + transformación con Cloudflare Images (Image Resizing).
 *
 * Reparto de responsabilidades:
 *   - **R2** guarda el original subido por el administrador. Es el almacén
 *     barato y sin coste de egreso; nunca se expone el bucket directamente.
 *   - **Cloudflare Images (transformaciones vía /cdn-cgi/image)** genera al
 *     vuelo las variantes (thumb/card/hero) y negocia AVIF/WebP con el
 *     navegador. Se factura por imagen transformada y las variantes quedan
 *     cacheadas en el borde, así que no compensa duplicar derivados en R2.
 *   - Si `IMAGE_RESIZING` está desactivado (dev local, o zona sin el producto
 *     activo) se sirve el original con cache larga: degradación limpia, sin
 *     workaround frágil.
 */

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MIN_IMAGE_BYTES = 64;

const EXT_BY_TYPE: Record<AllowedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export const COVER_PREFIX = 'reviews/covers/';

/** Sólo aceptamos claves generadas por nosotros. Cierra path traversal y SSRF. */
const SAFE_KEY = /^reviews\/covers\/\d{4}\/[0-9a-f]{2}\/[0-9a-f-]{36}\.(jpg|png|webp|avif)$/;

export function isSafeMediaKey(key: string): boolean {
  if (key.length > 120) return false;
  if (key.includes('..') || key.includes('//') || key.includes('\\') || key.includes('%')) return false;
  return SAFE_KEY.test(key);
}

/**
 * Detecta el tipo real por magic bytes. El `Content-Type` declarado y la
 * extensión del fichero son datos del cliente y no se usan para decidir nada
 * (defensa contra MIME spoofing).
 */
export function sniffImageType(bytes: Uint8Array): AllowedImageType | null {
  if (bytes.length < 12) return null;
  const b = bytes;

  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';

  if (
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) return 'image/png';

  const ascii = (start: number, len: number) =>
    String.fromCharCode(...b.subarray(start, start + len));

  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';

  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand === 'avif' || brand === 'avis' || brand === 'av01') return 'image/avif';
  }
  return null;
}

export interface Dimensions { width: number; height: number }

/** Lectura de dimensiones sin decodificar el bitmap (no hay canvas en Workers). */
export function readDimensions(bytes: Uint8Array, type: AllowedImageType): Dimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (type === 'image/png') {
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (type === 'image/jpeg') {
      let off = 2;
      while (off + 9 < bytes.length) {
        if (bytes[off] !== 0xff) { off++; continue; }
        const marker = bytes[off + 1]!;
        const size = view.getUint16(off + 2);
        // SOF0..SOF15 excepto los marcadores DHT/JPG/DAC
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: view.getUint16(off + 5), width: view.getUint16(off + 7) };
        }
        off += 2 + size;
      }
      return null;
    }
    if (type === 'image/webp') {
      const fmt = String.fromCharCode(...bytes.subarray(12, 16));
      if (fmt === 'VP8X') {
        const w = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
        const h = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
        return { width: w, height: h };
      }
      if (fmt === 'VP8 ') {
        return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      }
      if (fmt === 'VP8L') {
        const bits = view.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    return null; // AVIF: parsear el box tree no compensa aquí
  } catch {
    return null;
  }
}

export interface ValidatedImage {
  bytes: Uint8Array;
  type: AllowedImageType;
  size: number;
  dimensions: Dimensions | null;
}

export type ImageValidationError =
  | 'empty'
  | 'too_large'
  | 'too_small'
  | 'unsupported_type'
  | 'dimensions_out_of_range';

export function validateImage(bytes: Uint8Array): { ok: true; value: ValidatedImage } | { ok: false; error: ImageValidationError } {
  if (bytes.length === 0) return { ok: false, error: 'empty' };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: 'too_large' };
  if (bytes.length < MIN_IMAGE_BYTES) return { ok: false, error: 'too_small' };

  const type = sniffImageType(bytes);
  if (!type) return { ok: false, error: 'unsupported_type' };

  const dimensions = readDimensions(bytes, type);
  if (dimensions) {
    const { width, height } = dimensions;
    if (width < 100 || height < 100 || width > 8000 || height > 8000) {
      return { ok: false, error: 'dimensions_out_of_range' };
    }
  }
  return { ok: true, value: { bytes, type, size: bytes.length, dimensions } };
}

/**
 * Clave de objeto impredecible y totalmente generada en servidor. El cliente no
 * influye en la ruta: ni nombre original, ni extensión, ni carpeta.
 */
export function buildCoverKey(type: AllowedImageType): string {
  const uuid = crypto.randomUUID();
  const year = new Date().getUTCFullYear();
  const shard = uuid.slice(0, 2);
  return `${COVER_PREFIX}${year}/${shard}/${uuid}.${EXT_BY_TYPE[type]}`;
}

export type ImageVariant = 'thumb' | 'card' | 'hero' | 'og';

const VARIANTS: Record<ImageVariant, { width: number; height?: number; fit: string; quality: number }> = {
  thumb: { width: 160, fit: 'cover', quality: 72 },
  card: { width: 400, fit: 'cover', quality: 78 },
  hero: { width: 900, fit: 'contain', quality: 82 },
  og: { width: 1200, height: 630, fit: 'cover', quality: 85 },
};

/** URL pública del original (dominio de R2 si existe, si no vía el Worker). */
export function originalUrl(env: Bindings, key: string): string {
  const base = env.MEDIA_PUBLIC_BASE?.replace(/\/$/, '');
  return base ? `${base}/${key}` : `/media/${key}`;
}

/** URL de una variante optimizada. Nunca se sirve el original al cliente. */
export function variantUrl(env: Bindings, key: string | null | undefined, variant: ImageVariant): string | null {
  if (!key || !isSafeMediaKey(key)) return null;
  const source = originalUrl(env, key);
  if (env.IMAGE_RESIZING !== 'true') return source;
  const v = VARIANTS[variant];
  const opts = [
    `width=${v.width}`,
    v.height ? `height=${v.height}` : '',
    `fit=${v.fit}`,
    `quality=${v.quality}`,
    'format=auto',
    'metadata=none',
  ]
    .filter(Boolean)
    .join(',');
  const absolute = source.startsWith('http') ? source : `${env.SITE_URL.replace(/\/$/, '')}${source}`;
  return `/cdn-cgi/image/${opts}/${absolute}`;
}

/** `srcset` responsive para las tarjetas del catálogo. */
export function coverSrcSet(env: Bindings, key: string | null | undefined): string | null {
  if (!key) return null;
  const thumb = variantUrl(env, key, 'thumb');
  const card = variantUrl(env, key, 'card');
  const hero = variantUrl(env, key, 'hero');
  if (!card) return null;
  if (env.IMAGE_RESIZING !== 'true') return null;
  return `${thumb} 160w, ${card} 400w, ${hero} 900w`;
}
