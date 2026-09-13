import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  ORIGIN, loginAsAdmin, resetAdminRateLimit, createReview, CATEGORY_ID, type AdminSession,
} from './helpers';

let session: AdminSession;

beforeAll(async () => {
  session = await loginAsAdmin();
  await resetAdminRateLimit();
});

function autenticado(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Cookie: session.cookie,
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    ...extra,
  };
}

async function post(path: string, fields: Record<string, string>, conSesion = true): Promise<Response> {
  const response = await SELF.fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    body: new URLSearchParams(conSesion ? { _csrf: session.csrf, ...fields } : fields),
    headers: conSesion
      ? autenticado({ 'Content-Type': 'application/x-www-form-urlencoded' })
      : { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' },
    redirect: 'manual',
  });
  await response.text();
  return response;
}

/**
 * Cómo se reconoce una tarjeta en el HTML.
 *
 * No vale buscar el título a secas: el buscador devuelve lo escrito en el
 * `value` del campo, así que la cadena aparece aunque no haya resultados. Y no
 * vale atarse a `pending__title` porque con sesión el título va dentro de un
 * enlace. Lo que sí es estable en los dos casos es el título pegado a su
 * etiqueta de apertura y seguido de otra.
 */
function tarjeta(titulo: string): string {
  return `>${titulo}<`;
}

async function get(path: string, conSesion = false): Promise<{ status: number; html: string }> {
  const response = await SELF.fetch(`${ORIGIN}${path}`, {
    headers: conSesion ? autenticado({ Accept: 'text/html' }) : { Accept: 'text/html' },
    redirect: 'manual',
  });
  return { status: response.status, html: await response.text() };
}

describe('gestión desde la página pública', () => {
  it('sin sesión no hay botones de gestión', async () => {
    const { html } = await get('/pendientes');
    expect(html).not.toContain('/pendientes/nuevo');
    expect(html).not.toContain('/editar');
  });

  it('con sesión aparece el botón de añadir', async () => {
    const { html } = await get('/pendientes', true);
    expect(html).toContain('/pendientes/nuevo');
    expect(html).toContain('Añadir pendiente');
  });

  it('el formulario de alta exige sesión', async () => {
    const anonimo = await SELF.fetch(`${ORIGIN}/pendientes/nuevo`, {
      headers: { Accept: 'text/html' },
      redirect: 'manual',
    });
    await anonimo.text();
    // Redirige al acceso en vez de enseñar el formulario.
    expect(anonimo.status).toBe(302);
    expect(anonimo.headers.get('Location')).toContain('/admin/login');

    const conSesion = await get('/pendientes/nuevo', true);
    expect(conSesion.status).toBe(200);
    expect(conSesion.html).toContain('Añadir pendiente');
  });

  it('da de alta un pendiente desde la página pública', async () => {
    const respuesta = await post('/pendientes/nuevo', {
      titleEs: 'Pentiment',
      contentType: 'GAME',
      year: '2022',
      priority: 'HIGH',
      status: 'PENDING',
      isPublic: '1',
      sortOrder: '0',
    });
    expect(respuesta.status).toBe(303);

    const row = await env.DB.prepare('SELECT id, year, priority FROM watchlist_items WHERE title_es = ?')
      .bind('Pentiment')
      .first<{ id: string; year: number; priority: string }>();
    expect(row!.year).toBe(2022);
    expect(row!.priority).toBe('HIGH');

    const { html } = await get('/pendientes', true);
    expect(html).toContain(`/pendientes/${row!.id}/editar`);
  });

  it('con sesión, la tarjeta entera lleva a la edición y no hay botón aparte', async () => {
    const conSesion = await get('/pendientes', true);
    // La clase es lo que estira el enlace sobre toda la tarjeta; sin ella la
    // tarjeta se pinta igual pero deja de ser pulsable.
    expect(conSesion.html).toContain('pending--editable');
    // El enlace es el título, no un botón: se quitó el botón «Editar».
    expect(conSesion.html).toContain('class="pending__titlelink"');
    expect(conSesion.html).not.toContain('pending__edit');
    expect(conSesion.html).not.toContain('>Editar<');

    const anonimo = await get('/pendientes');
    expect(anonimo.html).toContain('class="pending pending--');
    expect(anonimo.html).not.toContain('pending--editable');
    expect(anonimo.html).not.toContain('pending__titlelink');
  });

  it('un alta sin sesión se rechaza', async () => {
    const respuesta = await post('/pendientes/nuevo', { titleEs: 'No debería entrar', contentType: 'GAME' }, false);
    expect([302, 401, 403]).toContain(respuesta.status);

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM watchlist_items WHERE title_es = ?')
      .bind('No debería entrar')
      .first<{ n: number }>();
    expect(row!.n).toBe(0);
  });

  it('edita un pendiente desde la página pública', async () => {
    await post('/pendientes/nuevo', {
      titleEs: 'Serie por ver',
      contentType: 'SERIES',
      year: '2019',
      priority: 'MEDIUM',
      status: 'PENDING',
      isPublic: '1',
      sortOrder: '0',
    });
    const row = await env.DB.prepare('SELECT id FROM watchlist_items WHERE title_es = ?')
      .bind('Serie por ver')
      .first<{ id: string }>();

    const editor = await get(`/pendientes/${row!.id}/editar`, true);
    expect(editor.status).toBe(200);
    expect(editor.html).toContain('Serie por ver');

    const guardado = await post(`/pendientes/${row!.id}/editar`, {
      titleEs: 'Serie por ver (editada)',
      contentType: 'SERIES',
      year: '2019-actualidad',
      seasons: '4',
      priority: 'LOW',
      status: 'IN_PROGRESS',
      isPublic: '1',
      sortOrder: '0',
    });
    expect(guardado.status).toBe(303);

    const despues = await env.DB
      .prepare('SELECT title_es, year, year_end, year_ongoing, seasons, priority, status FROM watchlist_items WHERE id = ?')
      .bind(row!.id)
      .first<Record<string, unknown>>();
    expect(despues!.title_es).toBe('Serie por ver (editada)');
    expect(despues!.year).toBe(2019);
    expect(despues!.year_ongoing).toBe(1);
    expect(despues!.seasons).toBe(4);
    expect(despues!.status).toBe('IN_PROGRESS');
  });

  it('editar sin sesión no cambia nada', async () => {
    const row = await env.DB.prepare("SELECT id, title_es FROM watchlist_items WHERE title_es = 'Pentiment'")
      .first<{ id: string; title_es: string }>();

    const respuesta = await post(`/pendientes/${row!.id}/editar`, { titleEs: 'Secuestrado', contentType: 'GAME' }, false);
    expect([302, 401, 403]).toContain(respuesta.status);

    const despues = await env.DB.prepare('SELECT title_es FROM watchlist_items WHERE id = ?')
      .bind(row!.id)
      .first<{ title_es: string }>();
    expect(despues!.title_es).toBe('Pentiment');
  });
});

describe('filtro de la página pública', () => {
  beforeAll(async () => {
    const base = {
      contentType: 'MOVIE',
      priority: 'MEDIUM',
      status: 'PENDING',
      isPublic: '1',
      sortOrder: '0',
    };
    await post('/pendientes/nuevo', { ...base, titleEs: 'Buscable Alfa', creator: 'Kurosawa', year: '1954' });
    await post('/pendientes/nuevo', { ...base, titleEs: 'Buscable Beta', contentType: 'ANIME', year: '2020-2022' });
    await post('/pendientes/nuevo', {
      ...base,
      titleEs: 'Buscable Privado',
      isPublic: '0',
      categoryId: CATEGORY_ID,
    });
  });

  it('busca por texto en título y autor', async () => {
    const porTitulo = await get('/pendientes?q=Buscable+Alfa');
    expect(porTitulo.html).toContain(tarjeta('Buscable Alfa'));
    expect(porTitulo.html).not.toContain(tarjeta('Buscable Beta'));

    const porAutor = await get('/pendientes?q=Kurosawa');
    expect(porAutor.html).toContain(tarjeta('Buscable Alfa'));
  });

  it('filtra por tipo de contenido', async () => {
    const { html } = await get('/pendientes?type=ANIME');
    expect(html).toContain(tarjeta('Buscable Beta'));
    expect(html).not.toContain(tarjeta('Buscable Alfa'));
  });

  it('el año busca por solape del periodo, no por coincidencia exacta', async () => {
    // «Buscable Beta» va de 2020 a 2022: en 2021 se estaba emitiendo.
    const { html } = await get('/pendientes?year=2021');
    expect(html).toContain(tarjeta('Buscable Beta'));
    expect(html).not.toContain(tarjeta('Buscable Alfa'));
  });

  it('lo privado no sale sin sesión aunque se pida por la URL', async () => {
    const anonimo = await get('/pendientes?visibility=PRIVATE&status=ALL');
    expect(anonimo.html).not.toContain(tarjeta('Buscable Privado'));

    const conSesion = await get('/pendientes?visibility=PRIVATE&status=ALL', true);
    expect(conSesion.html).toContain(tarjeta('Buscable Privado'));
  });

  it('lo ya reseñado sigue fuera de la lista pública, pero el filtro con sesión lo encuentra', async () => {
    // Un pendiente enlazado a una reseña: terminado y con `review_id`.
    const row = await env.DB.prepare("SELECT id FROM watchlist_items WHERE title_es = 'Buscable Alfa'")
      .first<{ id: string }>();
    const review = await createReview(session, { title: 'Reseña que cierra un pendiente' });
    await env.DB
      .prepare("UPDATE watchlist_items SET status = 'DONE', review_id = ? WHERE id = ?")
      .bind(review.id, row!.id)
      .run();

    const anonimo = await get('/pendientes?q=Buscable+Alfa&status=ALL');
    expect(anonimo.html).not.toContain(tarjeta('Buscable Alfa'));
    expect(anonimo.html).toContain('Nada coincide con esa búsqueda');

    const conSesion = await get('/pendientes?q=Buscable+Alfa&status=ALL', true);
    expect(conSesion.html).toContain(tarjeta('Buscable Alfa'));
  });

  it('una lista filtrada no se indexa', async () => {
    const { html } = await get('/pendientes?q=Buscable');
    expect(html).toContain('noindex');

    const sinFiltro = await get('/pendientes');
    expect(sinFiltro.html).not.toContain('name="robots" content="noindex');
  });
});
