/**
 * ISBN: normalización, validación y conversión.
 *
 * El código de barras de un libro (EAN-13) **es** su ISBN-13, así que lo que
 * devuelve la cámara entra por aquí sin traducción. Las ediciones antiguas
 * llevan ISBN-10, que se convierte a 13 para tener una sola clave de búsqueda.
 *
 * Nada de esto confía en el dígito de control como medida de seguridad: sólo
 * evita dar de alta un número mal leído.
 */

/** Deja sólo dígitos y la X final del ISBN-10. Quita guiones y espacios. */
export function normalizeIsbn(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/** Dígito de control del ISBN-10: suma ponderada 10..1, módulo 11. */
function isbn10CheckDigit(first9: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += (10 - i) * Number(first9[i]);
  const remainder = (11 - (sum % 11)) % 11;
  return remainder === 10 ? 'X' : String(remainder);
}

/** Dígito de control del EAN-13: pesos alternos 1 y 3, módulo 10. */
function isbn13CheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

export function isValidIsbn10(value: string): boolean {
  const isbn = normalizeIsbn(value);
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  return isbn10CheckDigit(isbn.slice(0, 9)) === isbn[9];
}

export function isValidIsbn13(value: string): boolean {
  const isbn = normalizeIsbn(value);
  // 978 y 979 son los prefijos de la industria del libro dentro de EAN-13. Un
  // código de barras de un yogur también es EAN-13 y no debe colarse.
  if (!/^97[89]\d{10}$/.test(isbn)) return false;
  return isbn13CheckDigit(isbn.slice(0, 12)) === isbn[12];
}

/** ISBN-10 a ISBN-13: prefijo 978 y dígito de control recalculado. */
export function isbn10To13(value: string): string | null {
  if (!isValidIsbn10(value)) return null;
  const body = `978${normalizeIsbn(value).slice(0, 9)}`;
  return body + isbn13CheckDigit(body);
}

export interface ParsedIsbn {
  isbn13: string;
  isbn10: string | null;
}

/**
 * Acepta ISBN-10 o ISBN-13 y devuelve siempre el 13, que es la clave con la que
 * se guarda y se busca. Devuelve `null` si el número no es un ISBN válido.
 */
export function parseIsbn(raw: string): ParsedIsbn | null {
  const isbn = normalizeIsbn(raw);
  if (isValidIsbn13(isbn)) {
    // El 10 sólo existe si el 13 empieza por 978.
    if (!isbn.startsWith('978')) return { isbn13: isbn, isbn10: null };
    const body = isbn.slice(3, 12);
    return { isbn13: isbn, isbn10: body + isbn10CheckDigit(body) };
  }
  if (isValidIsbn10(isbn)) {
    const thirteen = isbn10To13(isbn);
    return thirteen ? { isbn13: thirteen, isbn10: isbn } : null;
  }
  return null;
}
