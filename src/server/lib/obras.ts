import type { Bindings } from '../../types/env';
import type { ContentType } from '../../types/domain';
import { searchWorks, fetchCover, isOpenLibraryCoverUrl, type WorkCandidate } from './openlibrary';
import { searchTitles, fetchPoster, isTmdbImageUrl } from './tmdb';

/**
 * De qué catálogo se saca la ficha de cada tipo de obra.
 *
 * Un solo sitio que decide, para que ni la ruta ni el navegador tengan que
 * saberlo. Lo que no está aquí no tiene buscador y se escribe a mano: de un
 * videojuego no hay fuente abierta que valga la pena, y «Otro» es, por
 * definición, cualquier cosa.
 */
const PROVEEDOR: Partial<Record<ContentType, 'openlibrary' | 'tmdb-movie' | 'tmdb-tv'>> = {
  BOOK: 'openlibrary',
  NOVEL: 'openlibrary',
  COMIC: 'openlibrary',
  MANGA: 'openlibrary',
  MOVIE: 'tmdb-movie',
  // Una serie y un anime se emiten igual y TMDB los tiene en el mismo sitio.
  SERIES: 'tmdb-tv',
  ANIME: 'tmdb-tv',
};

/** Los tipos que tienen buscador. Lo consume la vista para tapar el bloque. */
export const LOOKUP_CONTENT_TYPES = Object.keys(PROVEEDOR) as ContentType[];

export function tieneBuscador(type: ContentType): boolean {
  return PROVEEDOR[type] !== undefined;
}

export async function buscarObras(
  env: Pick<Bindings, 'TMDB_API_KEY'>,
  query: string,
  type: ContentType,
): Promise<WorkCandidate[]> {
  switch (PROVEEDOR[type]) {
    case 'openlibrary': return searchWorks(query);
    case 'tmdb-movie': return searchTitles(env, query, 'movie');
    case 'tmdb-tv': return searchTitles(env, query, 'tv');
    default: return [];
  }
}

/**
 * Trae la imagen que ha ofrecido la búsqueda.
 *
 * El despacho va **por dominio**, que es la única lista de sitios de los que se
 * descarga. Una dirección que no sea de ninguno de los dos no se pide: es la
 * guarda que impide que este endpoint sea una petición a donde diga el cliente.
 */
export async function traerPortada(url: string): Promise<Uint8Array | null> {
  if (isOpenLibraryCoverUrl(url)) return fetchCover(url);
  if (isTmdbImageUrl(url)) return fetchPoster(url);
  return null;
}
