import { parseIsbn } from './isbn';
import { extractYear } from './year';

/**
 * Ficha de un libro a partir de su ISBN, vía Open Library.
 *
 * La consulta la hace **el Worker**, no el navegador. Dos motivos:
 *   - la CSP del subdominio lleva `connect-src 'self'`, y así sigue;
 *   - la IP de quien usa la aplicación no llega a un tercero.
 *
 * Open Library es abierta, sin clave y sin límite duro publicado. Lo que
 * devuelve es una sugerencia: la ficha se guarda sólo cuando la persona la
 * confirma, y todos los campos son editables.
 */

const ORIGIN = 'https://openlibrary.org';
const COVERS_ORIGIN = 'https://covers.openlibrary.org';
/** Si tarda más, no merece la pena hacer esperar a nadie: se rellena a mano. */
const TIMEOUT_MS = 6000;
const USER_AGENT = 'TrianguloDeLectores/1.0 (biblioteca privada)';

export interface BookDraft {
  isbn13: string;
  isbn10: string | null;
  title: string;
  subtitle: string | null;
  authors: string | null;
  publisher: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  language: string | null;
  /** URL de la portada en Open Library, para que la descargue el servidor. */
  coverUrl: string | null;
}

interface Edition {
  title?: unknown;
  subtitle?: unknown;
  publishers?: unknown;
  publish_date?: unknown;
  number_of_pages?: unknown;
  languages?: unknown;
  authors?: unknown;
  covers?: unknown;
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    // Un tercero caído o lento no puede tumbar el alta de un libro.
    return null;
  }
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length ? value.trim() : null;

/**
 * Open Library da la fecha en texto libre («1998», «Jan 12, 1998», «c1998»).
 * Comparte el extractor con la importación de MyLibrary: aquí había una copia
 * con el mismo fallo, que perdía el año en las fechas tipo «c1998».
 */
function publishYear(value: unknown): number | null {
  return extractYear(str(value));
}

function firstString(value: unknown): string | null {
  return Array.isArray(value) ? str(value[0]) : str(value);
}

/** `/languages/spa` -> `spa`. */
function extractLanguage(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const key = value[0];
  if (typeof key !== 'object' || key === null) return null;
  const path = str((key as { key?: unknown }).key);
  return path ? path.split('/').pop() ?? null : null;
}

/** Los autores vienen como referencias: hay que resolver cada una por su nombre. */
async function resolveAuthors(value: unknown): Promise<string | null> {
  if (!Array.isArray(value)) return null;
  const keys = value
    .map((entry) => (typeof entry === 'object' && entry !== null ? str((entry as { key?: unknown }).key) : null))
    .filter((key): key is string => Boolean(key) && /^\/authors\/OL\d+A$/.test(key!))
    .slice(0, 5);
  if (!keys.length) return null;

  const names = await Promise.all(
    keys.map(async (key) => {
      const author = await getJson(`${ORIGIN}${key}.json`);
      return typeof author === 'object' && author !== null ? str((author as { name?: unknown }).name) : null;
    }),
  );
  const list = names.filter((name): name is string => Boolean(name));
  return list.length ? list.join(', ') : null;
}

/**
 * Busca la ficha de una edición por ISBN.
 *
 * El ISBN se valida **antes** de construir la URL: sólo dígitos y una X, así
 * que no hay forma de inyectar una ruta ni de apuntar la petición a otro sitio.
 */
export async function lookupIsbn(rawIsbn: string): Promise<BookDraft | null> {
  const parsed = parseIsbn(rawIsbn);
  if (!parsed) return null;

  const edition = (await getJson(`${ORIGIN}/isbn/${parsed.isbn13}.json`)) as Edition | null;
  if (!edition || typeof edition !== 'object') return null;

  const title = str(edition.title);
  if (!title) return null;

  const coverId = Array.isArray(edition.covers) ? edition.covers.find((id) => Number.isInteger(id)) : null;

  return {
    isbn13: parsed.isbn13,
    isbn10: parsed.isbn10,
    title,
    subtitle: str(edition.subtitle),
    authors: await resolveAuthors(edition.authors),
    publisher: firstString(edition.publishers),
    publishedYear: publishYear(edition.publish_date),
    pageCount: typeof edition.number_of_pages === 'number' ? edition.number_of_pages : null,
    language: extractLanguage(edition.languages),
    coverUrl: coverId ? `${COVERS_ORIGIN}/b/id/${coverId}-L.jpg` : null,
  };
}

/** Sólo se descargan portadas del dominio de portadas de Open Library. */
export function isOpenLibraryCoverUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.host === new URL(COVERS_ORIGIN).host;
  } catch {
    return false;
  }
}

export async function fetchCover(url: string): Promise<Uint8Array | null> {
  if (!isOpenLibraryCoverUrl(url)) return null;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      // Sin seguir saltos a otro sitio: un redirect es la vía clásica para
      // convertir una descarga permitida en una petición a la red interna.
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}
