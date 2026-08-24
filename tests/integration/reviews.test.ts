import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  ORIGIN, loginAsAdmin, createReview, CATEGORY_ID, PLATFORM_ID, type AdminSession,
} from './helpers';

let session: AdminSession;

beforeAll(async () => {
  session = await loginAsAdmin();
});

/**
 * POST autenticado al panel. Consume siempre el cuerpo: dejar respuestas sin
 * leer mantiene abiertos los streams y el runtime de test no llega a cerrarse.
 */
async function adminPost(path: string, fields: Record<string, string>) {
  const response = await SELF.fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    body: new URLSearchParams({ _csrf: session.csrf, ...fields }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: session.cookie,
      Origin: ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
    },
    redirect: 'manual',
  });
  await response.text();
  return response;
}

/** Comprueba el código de estado consumiendo el cuerpo de la respuesta. */
async function expectStatus(url: string, status: number): Promise<void> {
  const response = await SELF.fetch(url, { headers: { Accept: 'text/html' } });
  await response.text();
  expect(response.status).toBe(status);
}

describe('CRUD de reseñas', () => {
  it('crea una reseña publicada con géneros y plataformas', async () => {
    const { id, slug } = await createReview(session, { title: 'Dune completo' });

    const row = await env.DB.prepare('SELECT * FROM reviews WHERE id = ?').bind(id)
      .first<Record<string, unknown>>();
    expect(row!.status).toBe('PUBLISHED');
    expect(row!.published_at).toBeTruthy();
    expect(row!.category_id).toBe(CATEGORY_ID);
    expect(row!.rating).toBe(9);
    expect(slug).toBe('dune-completo');

    const genre = await env.DB.prepare('SELECT * FROM review_genres WHERE review_id = ?').bind(id).first();
    expect(genre).toBeTruthy();

    const platform = await env.DB.prepare('SELECT * FROM review_platforms WHERE review_id = ?').bind(id)
      .first<Record<string, unknown>>();
    expect(platform!.platform_id).toBe(PLATFORM_ID);
    expect(platform!.availability).toBe('SUBSCRIPTION');
  });

  it('sanea el HTML de la reseña antes de guardarlo', async () => {
    const { id } = await createReview(session, {
      title: 'Reseña con XSS',
      extra: { bodyHtml: '<p>ok</p><script>alert(1)</script><img src=x onerror=alert(2)>' },
    });
    const row = await env.DB.prepare('SELECT body_html FROM reviews WHERE id = ?').bind(id)
      .first<{ body_html: string }>();

    expect(row!.body_html).toContain('<p>ok</p>');
    expect(row!.body_html).not.toContain('script');
    expect(row!.body_html).not.toContain('onerror');
  });

  it('genera slugs únicos ante títulos repetidos', async () => {
    const a = await createReview(session, { title: 'Título repetido' });
    const b = await createReview(session, { title: 'Título repetido' });
    expect(a.slug).not.toBe(b.slug);
    expect(b.slug).toMatch(/^titulo-repetido-\d+$/);
  });

  it('los borradores no son visibles públicamente', async () => {
    const { slug } = await createReview(session, { title: 'Aún sin publicar', status: 'DRAFT' });
    const publica = await SELF.fetch(`${ORIGIN}/resena/${slug}`, { headers: { Accept: 'text/html' } });
    expect(publica.status).toBe(404);

    const listado = await SELF.fetch(`${ORIGIN}/`, { headers: { Accept: 'text/html' } });
    expect(await listado.text()).not.toContain('Aún sin publicar');
  });

  it('publica y despublica', async () => {
    const { id, slug } = await createReview(session, { title: 'Ida y vuelta', status: 'DRAFT' });

    await adminPost(`/admin/resenas/${id}/estado`, { status: 'PUBLISHED' });
    await expectStatus(`${ORIGIN}/resena/${slug}`, 200);

    await adminPost(`/admin/resenas/${id}/estado`, { status: 'DRAFT' });
    await expectStatus(`${ORIGIN}/resena/${slug}`, 404);
  });

  it('duplica siempre como borrador', async () => {
    const { id } = await createReview(session, { title: 'Original a duplicar' });
    const response = await adminPost(`/admin/resenas/${id}/duplicar`, {});
    const nuevoId = /\/admin\/resenas\/([0-9a-f-]{36})/.exec(response.headers.get('Location') ?? '')?.[1];

    const row = await env.DB.prepare('SELECT title_es, status FROM reviews WHERE id = ?').bind(nuevoId)
      .first<{ title_es: string; status: string }>();
    expect(row!.status).toBe('DRAFT');
    expect(row!.title_es).toContain('(copia)');
  });

  it('elimina de forma lógica y la reseña desaparece del catálogo', async () => {
    const { id, slug } = await createReview(session, { title: 'Para eliminar' });
    await adminPost(`/admin/resenas/${id}/eliminar`, {});

    const row = await env.DB.prepare('SELECT deleted_at FROM reviews WHERE id = ?').bind(id)
      .first<{ deleted_at: number | null }>();
    expect(row!.deleted_at).toBeTruthy();
    await expectStatus(`${ORIGIN}/resena/${slug}`, 404);
  });

  it('restaura una reseña eliminada', async () => {
    const { id } = await createReview(session, { title: 'Para restaurar' });
    await adminPost(`/admin/resenas/${id}/eliminar`, {});
    await adminPost(`/admin/resenas/${id}/restaurar`, {});

    const row = await env.DB.prepare('SELECT deleted_at FROM reviews WHERE id = ?').bind(id)
      .first<{ deleted_at: number | null }>();
    expect(row!.deleted_at).toBeNull();
  });

  it('registra las acciones en auditoría', async () => {
    const { id } = await createReview(session, { title: 'Con auditoría' });
    const row = await env.DB.prepare(
      "SELECT action, actor_role FROM audit_log WHERE entity_id = ? AND action = 'review.create'",
    ).bind(id).first<{ action: string; actor_role: string }>();
    expect(row!.actor_role).toBe('ADMIN');
  });

  it('rechaza una reseña sin título', async () => {
    const response = await adminPost('/admin/resenas/nueva', { titleEs: '', contentType: 'MOVIE' });
    expect(response.status).toBe(400);
  });

  it('ignora campos no declarados (mass assignment)', async () => {
    const response = await adminPost('/admin/resenas/nueva', {
      titleEs: 'Intento de inyección',
      contentType: 'MOVIE',
      id: '00000000-0000-4000-8000-000000000000',
      comment_count: '9999',
      created_by: 'otro-usuario',
    });
    expect(response.status).toBe(303);

    const row = await env.DB.prepare("SELECT id, comment_count FROM reviews WHERE title_es = 'Intento de inyección'")
      .first<{ id: string; comment_count: number }>();
    expect(row!.id).not.toBe('00000000-0000-4000-8000-000000000000');
    expect(row!.comment_count).toBe(0);
  });
});

describe('catálogo público', () => {
  // Marcador único: los tests comparten la base, así que cada bloque se acota
  // a sus propios datos en vez de dar por hecho qué hay en la primera página.
  const MARCA = `zxq${Date.now().toString(36)}`;

  beforeAll(async () => {
    await createReview(session, { title: `Alfa ${MARCA}`, rating: 10 });
    await createReview(session, { title: `Beta ${MARCA}`, rating: 4 });
  });

  it('lista las reseñas publicadas', async () => {
    const html = await (await SELF.fetch(`${ORIGIN}/?q=${MARCA}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain(`Alfa ${MARCA}`);
    expect(html).toContain(`Beta ${MARCA}`);
  });

  it('filtra por búsqueda de texto', async () => {
    const html = await (await SELF.fetch(`${ORIGIN}/?q=Alfa+${MARCA}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain(`Alfa ${MARCA}`);
    expect(html).not.toContain(`Beta ${MARCA}`);
  });

  it('filtra por categoría y por género combinados', async () => {
    const response = await SELF.fetch(
      `${ORIGIN}/?q=${MARCA}&category=peliculas&genre=ciencia-ficcion&type=MOVIE`,
      { headers: { Accept: 'text/html' } },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`Alfa ${MARCA}`);
  });

  it('ordena por puntuación', async () => {
    const html = await (await SELF.fetch(`${ORIGIN}/?q=${MARCA}&sort=rating`, {
      headers: { Accept: 'text/html' },
    })).text();
    const alfa = html.indexOf(`Alfa ${MARCA}`);
    const beta = html.indexOf(`Beta ${MARCA}`);
    expect(alfa).toBeGreaterThan(-1);
    expect(beta).toBeGreaterThan(-1);
    expect(alfa).toBeLessThan(beta);
  });

  it('pagina', async () => {
    const response = await SELF.fetch(`${ORIGIN}/?perPage=1&page=2`, { headers: { Accept: 'text/html' } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('pagination');
  });

  it('sirve el parcial del modal sin el documento completo', async () => {
    const { slug } = await createReview(session, { title: 'Para el modal' });
    const html = await (await SELF.fetch(`${ORIGIN}/resena/${slug}?parcial=1`, { headers: { Accept: 'text/html' } })).text();
    expect(html).not.toContain('<html');
    expect(html).toContain('Para el modal');
    expect(html).toContain('comentarios');
  });

  it('muestra el aviso de spoilers cuando la reseña está marcada', async () => {
    const { slug } = await createReview(session, { title: 'Con spoilers', hasSpoilers: true });
    const html = await (await SELF.fetch(`${ORIGIN}/resena/${slug}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain('contiene spoilers');
  });

  it('muestra medias estrellas', async () => {
    const { slug } = await createReview(session, { title: 'Media estrella', rating: 7 });
    const html = await (await SELF.fetch(`${ORIGIN}/resena/${slug}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain('star--half');
    expect(html).toContain('3,5 de 5 estrellas');
  });

  it('muestra las plataformas donde encontrarla', async () => {
    const { slug } = await createReview(session, { title: 'Con plataformas' });
    const html = await (await SELF.fetch(`${ORIGIN}/resena/${slug}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain('Dónde verlo');
    expect(html).toContain('Netflix');
    expect(html).toContain('Incluido con suscripción');
  });

  it('no rompe con búsquedas que parecen inyección SQL', async () => {
    const response = await SELF.fetch(`${ORIGIN}/?q=${encodeURIComponent("'; DROP TABLE reviews;--")}`, {
      headers: { Accept: 'text/html' },
    });
    expect(response.status).toBe(200);
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM reviews').first<{ total: number }>();
    expect(count!.total).toBeGreaterThan(0);
  });

  it('escapa el término de búsqueda en el HTML devuelto', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    const html = await (await SELF.fetch(`${ORIGIN}/?q=${encodeURIComponent(payload)}`, {
      headers: { Accept: 'text/html' },
    })).text();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

describe('invalidación de caché', () => {
  it('publicar una reseña cambia el sello de versión de la caché', async () => {
    const before = await env.CACHE.get('cachever:reviews');
    await createReview(session, { title: 'Invalida la caché' });
    const after = await env.CACHE.get('cachever:reviews');
    expect(after).not.toBe(before);
  });

  it('la reseña recién publicada aparece de inmediato en el catálogo', async () => {
    await SELF.fetch(`${ORIGIN}/`, { headers: { Accept: 'text/html' } }); // calienta la caché
    await createReview(session, { title: 'Recién salida del horno' });
    const html = await (await SELF.fetch(`${ORIGIN}/`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain('Recién salida del horno');
  });
});
