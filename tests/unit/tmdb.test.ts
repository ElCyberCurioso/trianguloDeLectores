import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchTitles, isTmdbImageUrl } from '../../src/server/lib/tmdb';

/**
 * TMDB es la gemela de Open Library para lo que no se publica en papel.
 *
 * Lo que se prueba es lo mismo: que una ficha a medias dé una candidata menos y
 * nunca una excepción, que la clave no acabe donde no debe, y que sin clave el
 * buscador calle en vez de romperse.
 */
const CON_CLAVE = { TMDB_API_KEY: 'clave-de-pruebas' };

function respuestaCon(payload: unknown) {
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('búsqueda de cine y series', () => {
  it('traduce una película: título, original, año y póster', async () => {
    vi.stubGlobal('fetch', respuestaCon({
      results: [{
        title: 'Días perfectos',
        original_title: 'Perfect Days',
        release_date: '2023-12-21',
        poster_path: '/abc123.jpg',
      }],
    }) as unknown as typeof fetch);

    const candidata = (await searchTitles(CON_CLAVE, 'perfect days', 'movie'))[0]!;
    expect(candidata.title).toBe('Días perfectos');
    expect(candidata.titleOriginal).toBe('Perfect Days');
    expect(candidata.year).toBe(2023);
    expect(candidata.coverUrl).toBe('https://image.tmdb.org/t/p/w780/abc123.jpg');
    expect(isTmdbImageUrl(candidata.coverUrl!)).toBe(true);
    // La dirección no viene en la búsqueda: se deja vacía en vez de inventarla.
    expect(candidata.authors).toBeNull();
  });

  it('una serie trae `name` en vez de `title`, y se normaliza', async () => {
    vi.stubGlobal('fetch', respuestaCon({
      results: [{ name: 'Vinland Saga', original_name: 'ヴィンランド・サガ', first_air_date: '2019-07-08' }],
    }) as unknown as typeof fetch);

    const candidata = (await searchTitles(CON_CLAVE, 'vinland', 'tv'))[0]!;
    expect(candidata.title).toBe('Vinland Saga');
    expect(candidata.titleOriginal).toBe('ヴィンランド・サガ');
    expect(candidata.year).toBe(2019);
    expect(candidata.coverUrl).toBeNull();
  });

  it('no repite el título en el campo de título original', async () => {
    vi.stubGlobal('fetch', respuestaCon({
      results: [{ title: 'Dune', original_title: 'Dune', release_date: '2021-09-15' }],
    }) as unknown as typeof fetch);

    expect((await searchTitles(CON_CLAVE, 'dune', 'movie'))[0]!.titleOriginal).toBeNull();
  });

  it('sin clave no pregunta y devuelve lista vacía', async () => {
    const espia = respuestaCon({ results: [] });
    vi.stubGlobal('fetch', espia as unknown as typeof fetch);

    expect(await searchTitles({}, 'lo que sea', 'movie')).toEqual([]);
    expect(await searchTitles({ TMDB_API_KEY: '' }, 'lo que sea', 'movie')).toEqual([]);
    expect(espia).not.toHaveBeenCalled();
  });

  it('la clave va en la cabecera, nunca en la URL', async () => {
    const espia = respuestaCon({ results: [] });
    vi.stubGlobal('fetch', espia as unknown as typeof fetch);

    await searchTitles(CON_CLAVE, 'algo', 'movie');

    const [url, init] = espia.mock.calls[0]!;
    // Si acabara en la query, se iría a los logs del proveedor y al `Referer`.
    expect(url).not.toContain('clave-de-pruebas');
    expect(new URL(url).pathname).toBe('/3/search/movie');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer clave-de-pruebas');
  });

  it('fichas rotas, basura y caídas dan lista vacía, no excepciones', async () => {
    vi.stubGlobal('fetch', respuestaCon({ results: [{ release_date: '2020-01-01' }] }) as unknown as typeof fetch);
    expect(await searchTitles(CON_CLAVE, 'algo', 'movie')).toEqual([]);

    vi.stubGlobal('fetch', respuestaCon({ results: 'no es una lista' }) as unknown as typeof fetch);
    expect(await searchTitles(CON_CLAVE, 'algo', 'movie')).toEqual([]);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('vaya', { status: 401 })) as unknown as typeof fetch);
    expect(await searchTitles(CON_CLAVE, 'algo', 'movie')).toEqual([]);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('red caída'); }) as unknown as typeof fetch);
    expect(await searchTitles(CON_CLAVE, 'algo', 'movie')).toEqual([]);
  });

  it('sólo se bajan imágenes del dominio de TMDB', () => {
    expect(isTmdbImageUrl('https://image.tmdb.org/t/p/w780/a.jpg')).toBe(true);
    expect(isTmdbImageUrl('http://image.tmdb.org/t/p/w780/a.jpg')).toBe(false);
    expect(isTmdbImageUrl('https://image.tmdb.org.atacante.test/a.jpg')).toBe(false);
    expect(isTmdbImageUrl('https://api.themoviedb.org/3/x.jpg')).toBe(false);
  });
});
