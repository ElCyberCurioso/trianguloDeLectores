import type { Bindings } from '../../types/env';

/**
 * Almacenamiento de la biblioteca privada en R2.
 *
 * Tres prefijos, deliberadamente distintos de `reviews/covers/`:
 *
 *   - `books/pdf/`     los PDF que se leen en el visor
 *   - `books/covers/`  portadas de documentos y de libros en papel
 *   - `backups/`       volcados diarios del catálogo
 *
 * `isSafeMediaKey()` (src/server/lib/images.ts) sólo reconoce las claves de
 * `reviews/covers/`, así que **la ruta pública `/media/*` no puede servir nada
 * de aquí**. Todo esto sale por rutas del subdominio autenticado. No amplíes
 * aquel patrón: es lo que mantiene los PDF fuera del alcance de cualquiera.
 */

export const PDF_PREFIX = 'books/pdf/';
export const BOOK_COVER_PREFIX = 'books/covers/';
export const BACKUP_PREFIX = 'backups/library/';

/** 50 MB. Cabe cualquier libro, incluidos escaneados, sin trocear la subida. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
/** Un PDF válido no baja de esto ni de lejos. Descarta ficheros vacíos. */
export const MIN_PDF_BYTES = 512;

const SAFE_PDF_KEY = /^books\/pdf\/\d{4}\/[0-9a-f]{2}\/[0-9a-f-]{36}\.pdf$/;
const SAFE_BOOK_COVER_KEY = /^books\/covers\/\d{4}\/[0-9a-f]{2}\/[0-9a-f-]{36}\.(jpg|png|webp|avif)$/;

function hasTraversal(key: string): boolean {
  return key.length > 120 || key.includes('..') || key.includes('//') || key.includes('\\') || key.includes('%');
}

/** Sólo claves generadas por nosotros. Cierra path traversal. */
export function isSafePdfKey(key: string): boolean {
  return !hasTraversal(key) && SAFE_PDF_KEY.test(key);
}

export function isSafeBookCoverKey(key: string): boolean {
  return !hasTraversal(key) && SAFE_BOOK_COVER_KEY.test(key);
}

/**
 * Clave nueva para un PDF. El cliente no influye en la ruta: ni el nombre del
 * fichero que sube ni nada que envíe entra aquí.
 *
 * El nivel intermedio son los dos primeros caracteres del UUID, que reparte los
 * objetos y evita un prefijo con decenas de miles de entradas.
 */
export function buildPdfKey(): string {
  const uuid = crypto.randomUUID();
  return `${PDF_PREFIX}${new Date().getUTCFullYear()}/${uuid.slice(0, 2)}/${uuid}.pdf`;
}

export function buildBookCoverKey(extension: 'jpg' | 'png' | 'webp' | 'avif'): string {
  const uuid = crypto.randomUUID();
  return `${BOOK_COVER_PREFIX}${new Date().getUTCFullYear()}/${uuid.slice(0, 2)}/${uuid}.${extension}`;
}

/**
 * ¿Empieza por `%PDF-`?
 *
 * El `Content-Type` que declara el navegador y la extensión del fichero son
 * datos del cliente y no deciden nada, igual que en las portadas. Aquí se mira
 * el contenido real.
 */
export function looksLikePdf(head: Uint8Array): boolean {
  if (head.length < 5) return false;
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
}

/** URL del PDF dentro del subdominio. Nunca la del bucket. */
export function pdfUrl(documentId: string): string {
  return `/documentos/${documentId}/fichero`;
}

/** URL de una portada de la biblioteca. Se sirve autenticada, sin transformar. */
export function bookCoverUrl(key: string | null | undefined): string | null {
  if (!key || !isSafeBookCoverKey(key)) return null;
  return `/portadas/${key.slice(BOOK_COVER_PREFIX.length)}`;
}

/** Reconstruye la clave a partir del trozo que viaja en la URL de la portada. */
export function bookCoverKeyFromPath(path: string): string | null {
  const key = `${BOOK_COVER_PREFIX}${path}`;
  return isSafeBookCoverKey(key) ? key : null;
}

/** Host del subdominio de la biblioteca para el entorno actual. */
export function booksHost(env: Bindings): string {
  if (env.BOOKS_URL) return new URL(env.BOOKS_URL).host;
  return `books.${new URL(env.SITE_URL).host}`;
}

/** ¿Esta petición va dirigida al subdominio de la biblioteca? */
export function isBooksRequest(request: Request, env: Bindings): boolean {
  try {
    return new URL(request.url).host === booksHost(env);
  } catch {
    return false;
  }
}
