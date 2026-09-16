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

/** Una obra encontrada por título, para elegir entre varias. */
export interface WorkCandidate {
  title: string;
  /** Sólo cuando de verdad es otro; si no, nulo. Lo usa TMDB. */
  titleOriginal?: string | null;
  authors: string | null;
  year: number | null;
  /** URL de la portada en el proveedor, para que la descargue el servidor. */
  coverUrl: string | null;
  /** El primer ISBN conocido, si lo hay. Sólo informativo. */
  isbn13: string | null;
}

interface SearchDoc {
  title?: unknown;
  author_name?: unknown;
  first_publish_year?: unknown;
  cover_i?: unknown;
  isbn?: unknown;
}

/** Cuántas se ofrecen. Cinco caben en pantalla y se eligen de un vistazo. */
const MAX_CANDIDATES = 5;

/**
 * Busca obras por título.
 *
 * Es la otra mitad de `lookupIsbn()`: quien reseña un libro casi nunca tiene el
 * ISBN a mano —lo leyó hace meses, o es prestado—, pero el título sí. Devuelve
 * candidatas para elegir, nunca una ficha que se aplique sola: lo que llega de
 * fuera es una sugerencia y la decisión es de quien escribe.
 *
 * `fields` acota lo que pide: sin él, Open Library devuelve fichas enormes con
 * decenas de campos que aquí no se miran y que hay que descargar igual.
 */
export async function searchWorks(query: string): Promise<WorkCandidate[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const url = new URL(`${ORIGIN}/search.json`);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(MAX_CANDIDATES));
  url.searchParams.set('fields', 'title,author_name,first_publish_year,cover_i,isbn');

  const payload = await getJson(url.toString());
  const docs = (payload as { docs?: unknown } | null)?.docs;
  if (!Array.isArray(docs)) return [];

  return docs
    .slice(0, MAX_CANDIDATES)
    .map((raw) => toCandidate(raw as SearchDoc))
    .filter((candidate): candidate is WorkCandidate => candidate !== null);
}

function toCandidate(doc: SearchDoc): WorkCandidate | null {
  const title = str(doc.title);
  if (!title) return null;

  const authors = Array.isArray(doc.author_name)
    ? doc.author_name
        .map(str)
        .filter((name): name is string => Boolean(name))
        .slice(0, 3)
        .join(', ')
    : null;

  // `cover_i` es el identificador de portada del buscador; se compone igual que
  // el de una edición, así que la descarga pasa por la misma comprobación de
  // dominio que todo lo demás.
  const coverId = typeof doc.cover_i === 'number' && Number.isInteger(doc.cover_i) ? doc.cover_i : null;

  return {
    title,
    authors: authors && authors.length ? authors : null,
    year: typeof doc.first_publish_year === 'number' ? doc.first_publish_year : null,
    coverUrl: coverId ? `${COVERS_ORIGIN}/b/id/${coverId}-L.jpg` : null,
    isbn13: Array.isArray(doc.isbn) ? (doc.isbn.map(str).find((v) => v?.length === 13) ?? null) : null,
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
      /*
       * Sin seguir saltos a otro sitio: un redirect es la vía clásica para
       * convertir una descarga permitida en una petición a la red interna.
       *
       * `'manual'` y no `'error'`: workerd rechaza `redirect: 'error'` con un
       * `TypeError` y dice que no lo va a implementar. Como aquí abajo hay un
       * `catch` que devuelve `null`, esto hacía que **ninguna portada de Open
       * Library se descargara nunca** —ni en la biblioteca ni en el móvil—, y
       * el libro se guardaba sin ella sin decir nada.
       */
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // El salto se descarta a mano, que es lo que antes se creía delegado.
    if (response.status >= 300 && response.status < 400) return null;
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}
