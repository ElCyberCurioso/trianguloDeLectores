import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { env, SELF, fetchMock } from 'cloudflare:test';
import { ORIGIN, loginAsAdmin, resetAdminRateLimit, resetRateLimit, type AdminSession } from './helpers';

let session: AdminSession;

beforeAll(async () => {
  session = await loginAsAdmin();
  await resetAdminRateLimit();
  // Nada de salir a la red de verdad desde un test: lo que no esté declarado
  // explícitamente abajo falla en vez de llamar a Open Library.
  await resetRateLimit('upload');
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

// Traer una portada consume el mismo cubo de `upload` que subir una a mano, y
// los ficheros comparten runtime: sin esto, el siguiente que suba una imagen se
// come el 429 y falla sólo en la corrida completa.
afterAll(async () => {
  await resetRateLimit('upload');
});

async function postJson(path: string, body: unknown, conSesion = true): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: conSesion
      ? {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: session.cookie,
          Origin: ORIGIN,
          'Sec-Fetch-Site': 'same-origin',
          'X-CSRF-Token': session.csrf,
        }
      : { 'Content-Type': 'application/json', Accept: 'application/json' },
  });
}

/**
 * Una imagen falsa que el validador acepta, escrita como **texto**.
 *
 * El cuerpo de una respuesta simulada viaja como cadena y se codifica en UTF-8,
 * así que cualquier byte por encima de 0x7f se parte en dos y la cabecera deja
 * de ser la que era —un PNG, que empieza por 0x89, llega destrozado—. WebP no
 * tiene ese problema: su firma es «RIFF…WEBP», todo ASCII. El trozo siguiente
 * no es ninguno de los que el lector de dimensiones conoce, así que las deja en
 * nulo y no se comprueban, que es justo lo que interesa aquí.
 */
const WEBP_FALSO = `RIFF\u0000\u0010\u0000\u0000WEBPXXXX${'x'.repeat(240)}`;

describe('buscar la ficha de una obra', () => {
  it('devuelve candidatas y no deja que el navegador hable con el tercero', async () => {
    fetchMock
      .get('https://openlibrary.org')
      .intercept({ path: (p) => p.startsWith('/search.json') })
      .reply(200, { docs: [{ title: 'Pedro Páramo', author_name: ['Juan Rulfo'], first_publish_year: 1955 }] });

    const response = await postJson('/admin/api/obras', { q: 'pedro paramo', type: 'BOOK' });
    const payload = (await response.json()) as { data: { results: { title: string; year: number }[] } };

    expect(response.status).toBe(200);
    expect(payload.data.results[0]!.title).toBe('Pedro Páramo');
    expect(payload.data.results[0]!.year).toBe(1955);
  });

  it('exige al menos dos letras', async () => {
    const response = await postJson('/admin/api/obras', { q: 'a', type: 'BOOK' });
    await response.text();
    expect(response.status).toBe(400);
  });

  it('el tipo decide a qué catálogo se pregunta', async () => {
    // Un libro va a Open Library. Si fuera a TMDB, este interceptor quedaría
    // sin consumir y `assertNoPendingInterceptors` lo cantaría.
    fetchMock
      .get('https://openlibrary.org')
      .intercept({ path: (p) => p.startsWith('/search.json') })
      .reply(200, { docs: [{ title: 'Un libro' }] });
    const libro = await postJson('/admin/api/obras', { q: 'un libro', type: 'NOVEL' });
    await libro.text();
    expect(libro.status).toBe(200);

    // Una serie va a TMDB. En los tests no hay clave, así que el cliente ni
    // pregunta y devuelve vacío: sin clave hay menos ayuda, no un error.
    const serie = await postJson('/admin/api/obras', { q: 'una serie', type: 'ANIME' });
    const payload = (await serie.json()) as { data: { results: unknown[] } };
    expect(serie.status).toBe(200);
    expect(payload.data.results).toEqual([]);
  });

  it('un tipo sin buscador no rompe: devuelve vacío', async () => {
    const response = await postJson('/admin/api/obras', { q: 'lo que sea', type: 'GAME' });
    const payload = (await response.json()) as { data: { results: unknown[] } };
    expect(response.status).toBe(200);
    expect(payload.data.results).toEqual([]);
  });

  it('un tipo inventado se rechaza', async () => {
    const response = await postJson('/admin/api/obras', { q: 'lo que sea', type: 'PODCAST' });
    await response.text();
    expect(response.status).toBe(400);
  });

  it('sin sesión no se busca', async () => {
    const response = await postJson('/admin/api/obras', { q: 'lo que sea', type: 'BOOK' }, false);
    await response.text();
    expect([401, 403]).toContain(response.status);
  });
});

describe('traer la portada de la obra', () => {
  it('la descarga el servidor y la guarda en R2', async () => {
    fetchMock
      .get('https://covers.openlibrary.org')
      .intercept({ path: '/b/id/424242-L.jpg' })
      .reply(200, WEBP_FALSO, { headers: { 'Content-Type': 'image/webp' } });

    const response = await postJson('/admin/api/obras/portada', {
      url: 'https://covers.openlibrary.org/b/id/424242-L.jpg',
    });
    const payload = (await response.json()) as { data: { key: string } };

    expect(response.status).toBe(201);
    // La clave la genera el servidor bajo el prefijo público de portadas: el
    // cliente no influye en la ruta.
    expect(payload.data.key).toMatch(/^reviews\/covers\/\d{4}\/[0-9a-f]{2}\/[0-9a-f-]{36}\.webp$/);

    const guardada = await env.MEDIA.get(payload.data.key);
    expect(guardada).not.toBeNull();

    // Y queda registrada como cualquier otra subida, no como un caso aparte.
    const fila = await env.DB.prepare('SELECT mime FROM media_objects WHERE key = ?')
      .bind(payload.data.key)
      .first<{ mime: string }>();
    expect(fila?.mime).toBe('image/webp');
  });

  it('también baja el póster de TMDB, que es el otro catálogo', async () => {
    fetchMock
      .get('https://image.tmdb.org')
      .intercept({ path: '/t/p/w780/poster.jpg' })
      .reply(200, WEBP_FALSO, { headers: { 'Content-Type': 'image/webp' } });

    const response = await postJson('/admin/api/obras/portada', {
      url: 'https://image.tmdb.org/t/p/w780/poster.jpg',
    });
    const payload = (await response.json()) as { data: { key: string } };
    expect(response.status).toBe(201);
    expect(payload.data.key).toMatch(/^reviews\/covers\//);
  });

  it('no baja nada de un dominio que no sea el de los dos catálogos', async () => {
    for (const url of [
      'https://ejemplo.test/portada.jpg',
      'http://127.0.0.1/portada.jpg',
      'https://openlibrary.org.atacante.test/b/id/1-L.jpg',
      'https://image.tmdb.org.atacante.test/t/p/w780/a.jpg',
      // La API de TMDB no es su CDN de imágenes: sólo entra el dominio de
      // imágenes, no cualquier cosa del proveedor.
      'https://api.themoviedb.org/3/movie/1',
    ]) {
      const response = await postJson('/admin/api/obras/portada', { url });
      await response.text();
      // 400 y no 500: se rechaza antes de tocar la red, y por eso el
      // interceptor no ha recibido ninguna llamada.
      expect(response.status, url).toBe(400);
    }
  });

  it('lo que no es una imagen no entra aunque venga del dominio bueno', async () => {
    fetchMock
      .get('https://covers.openlibrary.org')
      .intercept({ path: '/b/id/999-L.jpg' })
      .reply(200, `esto no es una imagen${'.'.repeat(200)}`, { headers: { 'Content-Type': 'image/webp' } });

    const response = await postJson('/admin/api/obras/portada', {
      url: 'https://covers.openlibrary.org/b/id/999-L.jpg',
    });
    await response.text();
    expect(response.status).toBe(400);
  });

  it('un salto a otro sitio no se sigue, y el fallo es limpio', async () => {
    fetchMock
      .get('https://covers.openlibrary.org')
      .intercept({ path: '/b/id/302-L.jpg' })
      .reply(302, '', { headers: { Location: 'http://169.254.169.254/latest/meta-data/' } });

    const response = await postJson('/admin/api/obras/portada', {
      url: 'https://covers.openlibrary.org/b/id/302-L.jpg',
    });
    await response.text();
    expect(response.status).toBe(400);

    /*
     * Este caso vale por dos.
     *
     * Lo obvio: un redirect es la vía clásica para convertir una descarga
     * permitida en una petición a la red interna, y aquí se descarta.
     *
     * Lo que no se veía: esto se pedía con `redirect: 'error'`, que **workerd
     * rechaza** con un TypeError y dice que no piensa implementar. El error
     * caía en el `catch` de `fetchCover()` y se traducía en «no se ha podido»,
     * así que ninguna portada de Open Library se descargaba nunca, ni aquí ni
     * en la biblioteca privada, y nadie se enteraba porque el libro se guardaba
     * igual. Si alguien lo devuelve a `'error'`, la prueba de arriba —la que
     * sí baja una portada— se cae.
     */
  });

  it('sin sesión no se trae nada', async () => {
    const response = await postJson(
      '/admin/api/obras/portada',
      { url: 'https://covers.openlibrary.org/b/id/1-L.jpg' },
      false,
    );
    await response.text();
    expect([401, 403]).toContain(response.status);
  });
});
