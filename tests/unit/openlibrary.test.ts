import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchWorks, isOpenLibraryCoverUrl } from '../../src/server/lib/openlibrary';

/**
 * Lo que devuelve Open Library es texto de un tercero.
 *
 * Aquí no se prueba que el servicio funcione —eso es suyo—, sino que lo que
 * llega se traduce sin confiar en su forma: campos que faltan, tipos que no
 * son los esperados y listas vacías tienen que dar una candidata menos, nunca
 * una excepción a media petición.
 */
function respuestaCon(payload: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('búsqueda de obras por título', () => {
  it('traduce las fichas y compone la URL de la portada', async () => {
    vi.stubGlobal('fetch', respuestaCon({
      docs: [
        {
          title: 'Vinland Saga',
          author_name: ['Makoto Yukimura'],
          first_publish_year: 2005,
          cover_i: 12345,
          isbn: ['8467901234', '9788467901238'],
        },
      ],
    }));

    const candidata = (await searchWorks('vinland'))[0]!;
    expect(candidata.title).toBe('Vinland Saga');
    expect(candidata.authors).toBe('Makoto Yukimura');
    expect(candidata.year).toBe(2005);
    expect(candidata.isbn13).toBe('9788467901238');
    expect(candidata.coverUrl).toBe('https://covers.openlibrary.org/b/id/12345-L.jpg');
    // Y esa URL es descargable: si no pasara el filtro de dominio, la portada
    // se ofrecería y luego fallaría al traerla.
    expect(isOpenLibraryCoverUrl(candidata.coverUrl!)).toBe(true);
  });

  it('aguanta fichas a medias sin romperse', async () => {
    vi.stubGlobal('fetch', respuestaCon({
      docs: [
        { title: 'Sin nada más' },
        { title: 'Autores raros', author_name: 'no es una lista', cover_i: 'tampoco' },
        { author_name: ['Alguien'] },
        { title: '   ' },
      ],
    }));

    const resultados = await searchWorks('lo que sea');
    // Las dos con título sobreviven; la que no lo tiene y la del título en
    // blanco se caen, porque una ficha sin título no sirve para nada.
    expect(resultados).toHaveLength(2);
    expect(resultados[0]).toEqual({
      title: 'Sin nada más', authors: null, year: null, coverUrl: null, isbn13: null,
    });
    expect(resultados[1]!.authors).toBeNull();
    expect(resultados[1]!.coverUrl).toBeNull();
  });

  it('corta a cinco candidatas', async () => {
    vi.stubGlobal('fetch', respuestaCon({
      docs: Array.from({ length: 20 }, (_, i) => ({ title: `Obra ${i}` })),
    }));
    expect(await searchWorks('obra')).toHaveLength(5);
  });

  it('no pregunta por menos de dos letras', async () => {
    const espia = respuestaCon({ docs: [] });
    vi.stubGlobal('fetch', espia);

    expect(await searchWorks('a')).toEqual([]);
    expect(await searchWorks('  ')).toEqual([]);
    expect(espia).not.toHaveBeenCalled();
  });

  it('un tercero caído o con basura dentro devuelve lista vacía, no una excepción', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('vaya', { status: 500 })) as unknown as typeof fetch);
    expect(await searchWorks('cualquier cosa')).toEqual([]);

    vi.stubGlobal('fetch', respuestaCon({ docs: 'esto no es una lista' }));
    expect(await searchWorks('cualquier cosa')).toEqual([]);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('red caída'); }) as unknown as typeof fetch);
    expect(await searchWorks('cualquier cosa')).toEqual([]);
  });

  it('el título viaja en un parámetro de query, nunca en la ruta', async () => {
    const espia = vi.fn(
      async (_url: string) => new Response(JSON.stringify({ docs: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', espia as unknown as typeof fetch);

    await searchWorks('../../admin?x=1&y=2');

    const url = new URL(espia.mock.calls[0]![0]);
    expect(url.origin).toBe('https://openlibrary.org');
    expect(url.pathname).toBe('/search.json');
    expect(url.searchParams.get('q')).toBe('../../admin?x=1&y=2');
  });
});
