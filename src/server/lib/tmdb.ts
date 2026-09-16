import type { Bindings } from '../../types/env';
import type { WorkCandidate } from './openlibrary';

/**
 * Fichas de cine, series y anime, vía TMDB.
 *
 * La gemela de `openlibrary.ts` para lo que no se publica en papel. Mismas dos
 * reglas y por los mismos motivos:
 *   - la consulta la hace **el Worker**, así que la CSP sigue con
 *     `connect-src 'self'` y la dirección de quien escribe no llega a un tercero;
 *   - lo que devuelve es una sugerencia, y la ficha se guarda sólo cuando
 *     alguien la elige.
 *
 * A diferencia de Open Library, TMDB **pide clave**. Es opcional: sin ella esto
 * devuelve lista vacía y el buscador sigue sirviendo para libros. Un entorno sin
 * la clave tiene menos ayuda, no un error.
 *
 * TMDB exige atribución en la interfaz de quien use su API; va en el pie del
 * panel, que es donde se usa.
 */

const ORIGIN = 'https://api.themoviedb.org/3';
/** El tamaño que se pide del póster. 780 px de ancho cubre la portada 2:3. */
const IMAGES_ORIGIN = 'https://image.tmdb.org';
const POSTER_SIZE = 'w780';
const TIMEOUT_MS = 6000;
const MAX_CANDIDATES = 5;

/** Qué se busca en TMDB: una película o algo que se emite por episodios. */
export type TmdbKind = 'movie' | 'tv';

interface SearchResult {
  title?: unknown;
  name?: unknown;
  original_title?: unknown;
  original_name?: unknown;
  release_date?: unknown;
  first_air_date?: unknown;
  poster_path?: unknown;
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length ? value.trim() : null;

/** «2019-05-13» -> 2019. Lo que no empiece por cuatro dígitos no vale. */
function year(value: unknown): number | null {
  const texto = str(value);
  const match = texto ? /^(\d{4})/.exec(texto) : null;
  return match ? Number(match[1]) : null;
}

/**
 * Busca por título.
 *
 * `language=es-ES` para que el título llegue en español cuando exista, e
 * `include_adult=false` porque esto es un buscador de fichas, no un catálogo.
 */
export async function searchTitles(
  env: Pick<Bindings, 'TMDB_API_KEY'>,
  query: string,
  kind: TmdbKind,
): Promise<WorkCandidate[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  // Sin clave no hay búsqueda, y no es un fallo: se dice con una lista vacía.
  if (!env.TMDB_API_KEY) return [];

  const url = new URL(`${ORIGIN}/search/${kind}`);
  url.searchParams.set('query', q);
  url.searchParams.set('language', 'es-ES');
  url.searchParams.set('include_adult', 'false');
  url.searchParams.set('page', '1');

  let payload: unknown;
  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        // La clave va en la cabecera y no en la query: así no acaba en los logs
        // de nadie ni en el `Referer` de una petición posterior.
        Authorization: `Bearer ${env.TMDB_API_KEY}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return [];
    payload = await response.json();
  } catch {
    // Un tercero caído o lento no puede tumbar el editor de reseñas.
    return [];
  }

  const results = (payload as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];

  return results
    .slice(0, MAX_CANDIDATES)
    .map((raw) => toCandidate(raw as SearchResult, kind))
    .filter((candidate): candidate is WorkCandidate => candidate !== null);
}

function toCandidate(result: SearchResult, kind: TmdbKind): WorkCandidate | null {
  // Una película trae `title` y una serie `name`. Es la misma cosa con dos
  // nombres, y por eso se normaliza aquí y no en quien lo consume.
  const title = kind === 'movie' ? str(result.title) : str(result.name);
  if (!title) return null;

  const original = kind === 'movie' ? str(result.original_title) : str(result.original_name);
  const poster = str(result.poster_path);

  return {
    title,
    // TMDB no da la dirección en la búsqueda —haría falta otra petición por
    // ficha—, así que el campo de autor se deja vacío en vez de inventarlo.
    authors: null,
    year: year(kind === 'movie' ? result.release_date : result.first_air_date),
    coverUrl: poster ? `${IMAGES_ORIGIN}/t/p/${POSTER_SIZE}${poster}` : null,
    isbn13: null,
    // El título original sólo se ofrece si de verdad es otro: repetirlo en los
    // dos campos no aporta nada y hay que borrarlo a mano.
    titleOriginal: original && original !== title ? original : null,
  };
}

/** Sólo se descargan pósteres del dominio de imágenes de TMDB. */
export function isTmdbImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.host === new URL(IMAGES_ORIGIN).host;
  } catch {
    return false;
  }
}

export async function fetchPoster(url: string): Promise<Uint8Array | null> {
  if (!isTmdbImageUrl(url)) return null;
  try {
    const response = await fetch(url, {
      // `'manual'` y no `'error'`: workerd rechaza `'error'` con un TypeError.
      // Ver la regla en CLAUDE.md; costó que ninguna portada se descargara.
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) return null;
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}
