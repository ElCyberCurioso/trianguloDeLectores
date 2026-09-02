/**
 * Año de publicación a partir de texto libre.
 *
 * Ni MyLibrary ni Open Library guardan la fecha como fecha: viene como la
 * escribió alguien —«1998», «12 de marzo de 1998», «c1998» por *circa*, o
 * vacío—. Esto sólo busca un año con pinta de serlo.
 *
 * Los delimitadores son de dígito y no de palabra: con `\b`, «c1998» no casaba
 * —entre una letra y un dígito no hay frontera de palabra— y esas fichas
 * perdían el año en silencio. Con `(?<!\d)` y `(?!\d)` se acepta «c1998» y se
 * sigue rechazando «19985», que no es un año sino otra cosa.
 */
export function extractYear(value: string | null | undefined): number | null {
  const text = (value ?? '').trim();
  if (!text) return null;

  const match = text.match(/(?<!\d)(1[4-9]\d{2}|20\d{2}|21\d{2})(?!\d)/);
  if (!match) return null;

  const year = Number(match[1]);
  return year >= 1400 && year <= 2200 ? year : null;
}
