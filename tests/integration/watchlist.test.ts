import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  ORIGIN, loginAsAdmin, resetAdminRateLimit, CATEGORY_ID, type AdminSession,
} from './helpers';

let session: AdminSession;

beforeAll(async () => {
  session = await loginAsAdmin();
  await resetAdminRateLimit();
});

async function adminPost(path: string, fields: Record<string, string>): Promise<Response> {
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
  // Consumir el cuerpo: dejar streams abiertos impide cerrar el runtime de test.
  await response.text();
  return response;
}

async function crearPendiente(fields: Record<string, string> = {}): Promise<string> {
  const titulo = fields.titleEs ?? `Pendiente ${crypto.randomUUID().slice(0, 8)}`;
  const response = await adminPost('/admin/pendientes', {
    titleEs: titulo,
    contentType: 'GAME',
    priority: 'MEDIUM',
    isPublic: '1',
    ...fields,
  });
  expect(response.status).toBe(303);

  const row = await env.DB.prepare('SELECT id FROM watchlist_items WHERE title_es = ? ORDER BY created_at DESC LIMIT 1')
    .bind(titulo)
    .first<{ id: string }>();
  return row!.id;
}

describe('alta de pendientes', () => {
  it('crea un pendiente desde el formulario rápido', async () => {
    const id = await crearPendiente({ titleEs: 'Disco Elysium', contentType: 'GAME', priority: 'HIGH' });

    const row = await env.DB.prepare('SELECT * FROM watchlist_items WHERE id = ?').bind(id)
      .first<Record<string, unknown>>();
    expect(row!.title_es).toBe('Disco Elysium');
    expect(row!.status).toBe('PENDING');
    expect(row!.priority).toBe('HIGH');
    expect(row!.is_public).toBe(1);
    expect(row!.review_id).toBeNull();
  });

  it('guarda la ficha completa al editar', async () => {
    const id = await crearPendiente({ titleEs: 'Vinland Saga' });

    const response = await adminPost(`/admin/pendientes/${id}`, {
      titleEs: 'Vinland Saga',
      titleOriginal: 'Vinland Saga',
      contentType: 'MANGA',
      categoryId: CATEGORY_ID,
      year: '2005',
      creator: 'Makoto Yukimura',
      note: 'Me lo recomiendan sin parar.',
      sourceUrl: 'https://example.com/vinland',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      isPublic: '1',
      sortOrder: '3',
    });
    expect(response.status).toBe(303);

    const row = await env.DB.prepare('SELECT * FROM watchlist_items WHERE id = ?').bind(id)
      .first<Record<string, unknown>>();
    expect(row!.content_type).toBe('MANGA');
    expect(row!.year).toBe(2005);
    expect(row!.creator).toBe('Makoto Yukimura');
    expect(row!.source_url).toBe('https://example.com/vinland');
    expect(row!.status).toBe('IN_PROGRESS');
    expect(row!.sort_order).toBe(3);
  });

  it('rechaza datos inválidos', async () => {
    const response = await adminPost('/admin/pendientes', { titleEs: '', contentType: 'GAME' });
    expect(response.status).toBe(400);
  });

  it('rechaza un enlace que no es una URL', async () => {
    const id = await crearPendiente();
    const response = await adminPost(`/admin/pendientes/${id}`, {
      titleEs: 'Con enlace roto',
      contentType: 'GAME',
      priority: 'LOW',
      status: 'PENDING',
      sourceUrl: 'javascript:alert(1)',
    });
    expect(response.status).toBe(400);
  });

  it('ignora campos no declarados (mass assignment)', async () => {
    const titulo = `Sin inyección ${crypto.randomUUID().slice(0, 6)}`;
    await adminPost('/admin/pendientes', {
      titleEs: titulo,
      contentType: 'BOOK',
      review_id: '00000000-0000-4000-8000-000000000000',
      completed_at: '123',
    });

    const row = await env.DB.prepare('SELECT review_id, completed_at FROM watchlist_items WHERE title_es = ?')
      .bind(titulo)
      .first<{ review_id: string | null; completed_at: number | null }>();
    expect(row!.review_id).toBeNull();
    expect(row!.completed_at).toBeNull();
  });

  it('añade varios títulos de golpe', async () => {
    const marca = crypto.randomUUID().slice(0, 6);
    const response = await adminPost('/admin/pendientes/lote', {
      titles: `Uno ${marca}\nDos ${marca}\n\n   \nTres ${marca}`,
      contentType: 'MOVIE',
      priority: 'LOW',
      isPublic: '1',
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toContain('added=3');

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM watchlist_items WHERE title_es LIKE ? AND content_type = 'MOVIE'",
    ).bind(`%${marca}`).first<{ total: number }>();
    expect(row!.total).toBe(3);
  });
});

describe('cola y acciones', () => {
  it('empieza, termina, descarta y reabre', async () => {
    const id = await crearPendiente();

    await adminPost(`/admin/pendientes/${id}/accion`, { action: 'start' });
    expect(await estado(id)).toBe('IN_PROGRESS');

    await adminPost(`/admin/pendientes/${id}/accion`, { action: 'complete' });
    expect(await estado(id)).toBe('DONE');
    const completado = await env.DB.prepare('SELECT completed_at FROM watchlist_items WHERE id = ?')
      .bind(id)
      .first<{ completed_at: number | null }>();
    expect(completado!.completed_at).toBeGreaterThan(0);

    await adminPost(`/admin/pendientes/${id}/accion`, { action: 'reopen' });
    expect(await estado(id)).toBe('PENDING');

    await adminPost(`/admin/pendientes/${id}/accion`, { action: 'drop' });
    expect(await estado(id)).toBe('DROPPED');
  });

  it('alterna la visibilidad pública', async () => {
    const id = await crearPendiente();
    await adminPost(`/admin/pendientes/${id}/accion`, { action: 'toggle-public' });

    const row = await env.DB.prepare('SELECT is_public FROM watchlist_items WHERE id = ?').bind(id)
      .first<{ is_public: number }>();
    expect(row!.is_public).toBe(0);
  });

  it('elimina de la lista', async () => {
    const id = await crearPendiente();
    await adminPost(`/admin/pendientes/${id}/accion`, { action: 'delete' });

    const row = await env.DB.prepare('SELECT id FROM watchlist_items WHERE id = ?').bind(id).first();
    expect(row).toBeNull();
  });

  it('rechaza acciones desconocidas', async () => {
    const id = await crearPendiente();
    const response = await adminPost(`/admin/pendientes/${id}/accion`, { action: 'publicar' });
    expect(response.status).toBe(400);
  });

  it('registra las acciones en auditoría', async () => {
    const id = await crearPendiente();
    const row = await env.DB.prepare(
      "SELECT action, actor_role FROM audit_log WHERE entity_id = ? AND action = 'watchlist.create'",
    ).bind(id).first<{ action: string; actor_role: string }>();
    expect(row!.actor_role).toBe('ADMIN');
  });
});

describe('conversión en reseña', () => {
  it('crea un borrador con los datos del pendiente y enlaza ambos', async () => {
    const id = await crearPendiente({ titleEs: 'Perfect Days', contentType: 'MOVIE' });
    await adminPost(`/admin/pendientes/${id}`, {
      titleEs: 'Perfect Days',
      contentType: 'MOVIE',
      categoryId: CATEGORY_ID,
      year: '2023',
      creator: 'Wim Wenders',
      note: 'Para una tarde tranquila.',
      priority: 'MEDIUM',
      status: 'PENDING',
      isPublic: '1',
    });

    const response = await adminPost(`/admin/pendientes/${id}/accion`, { action: 'convert' });
    expect(response.status).toBe(303);
    const location = response.headers.get('Location') ?? '';
    expect(location).toMatch(/\/admin\/resenas\/[0-9a-f-]{36}/);

    const reviewId = /\/admin\/resenas\/([0-9a-f-]{36})/.exec(location)![1];
    const review = await env.DB.prepare('SELECT * FROM reviews WHERE id = ?').bind(reviewId)
      .first<Record<string, unknown>>();

    expect(review!.title_es).toBe('Perfect Days');
    expect(review!.content_type).toBe('MOVIE');
    expect(review!.year).toBe(2023);
    expect(review!.creator).toBe('Wim Wenders');
    // Nace como borrador: publicar sigue siendo un acto explícito.
    expect(review!.status).toBe('DRAFT');
    expect(review!.published_at).toBeNull();
    expect(review!.rating).toBe(0);
    // La nota arranca el cuerpo, escapada.
    expect(review!.body_html).toContain('Para una tarde tranquila.');

    const item = await env.DB.prepare('SELECT status, review_id FROM watchlist_items WHERE id = ?').bind(id)
      .first<{ status: string; review_id: string }>();
    expect(item!.status).toBe('DONE');
    expect(item!.review_id).toBe(reviewId);
  });

  it('escapa la nota al pasarla al cuerpo de la reseña', async () => {
    const id = await crearPendiente({ titleEs: 'Nota con XSS' });
    await adminPost(`/admin/pendientes/${id}`, {
      titleEs: 'Nota con XSS',
      contentType: 'BOOK',
      priority: 'LOW',
      status: 'PENDING',
      note: '<img src=x onerror=alert(1)>',
    });
    const response = await adminPost(`/admin/pendientes/${id}/accion`, { action: 'convert' });
    const reviewId = /\/admin\/resenas\/([0-9a-f-]{36})/.exec(response.headers.get('Location') ?? '')![1];

    const review = await env.DB.prepare('SELECT body_html FROM reviews WHERE id = ?').bind(reviewId)
      .first<{ body_html: string }>();
    expect(review!.body_html).not.toContain('<img');
    expect(review!.body_html).toContain('&lt;img');
  });

  it('no deja convertir dos veces el mismo pendiente', async () => {
    const id = await crearPendiente({ titleEs: 'Solo una vez' });
    expect((await adminPost(`/admin/pendientes/${id}/accion`, { action: 'convert' })).status).toBe(303);
    expect((await adminPost(`/admin/pendientes/${id}/accion`, { action: 'convert' })).status).toBe(409);
  });
});

describe('página pública', () => {
  it('muestra los pendientes públicos y activos', async () => {
    const marca = crypto.randomUUID().slice(0, 6);
    await crearPendiente({ titleEs: `Publico ${marca}`, isPublic: '1' });

    const html = await (await SELF.fetch(`${ORIGIN}/pendientes`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain(`Publico ${marca}`);
  });

  it('oculta los marcados como privados', async () => {
    const marca = crypto.randomUUID().slice(0, 6);
    const id = await crearPendiente({ titleEs: `Privado ${marca}` });
    await adminPost(`/admin/pendientes/${id}/accion`, { action: 'toggle-public' });

    const html = await (await SELF.fetch(`${ORIGIN}/pendientes`, { headers: { Accept: 'text/html' } })).text();
    expect(html).not.toContain(`Privado ${marca}`);
  });

  it('oculta los ya terminados y los descartados', async () => {
    const marca = crypto.randomUUID().slice(0, 6);
    const terminado = await crearPendiente({ titleEs: `Terminado ${marca}` });
    const descartado = await crearPendiente({ titleEs: `Descartado ${marca}` });
    await adminPost(`/admin/pendientes/${terminado}/accion`, { action: 'complete' });
    await adminPost(`/admin/pendientes/${descartado}/accion`, { action: 'drop' });

    const html = await (await SELF.fetch(`${ORIGIN}/pendientes`, { headers: { Accept: 'text/html' } })).text();
    expect(html).not.toContain(`Terminado ${marca}`);
    expect(html).not.toContain(`Descartado ${marca}`);
  });

  it('separa lo que está en curso de lo que está en cola', async () => {
    const marca = crypto.randomUUID().slice(0, 6);
    const id = await crearPendiente({ titleEs: `Viendo ${marca}` });
    await adminPost(`/admin/pendientes/${id}/accion`, { action: 'start' });

    const html = await (await SELF.fetch(`${ORIGIN}/pendientes`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain('Ahora mismo');
    expect(html).toContain(`Viendo ${marca}`);
  });

  it('filtra por tipo de contenido', async () => {
    const marca = crypto.randomUUID().slice(0, 6);
    await crearPendiente({ titleEs: `Libro ${marca}`, contentType: 'BOOK' });
    await crearPendiente({ titleEs: `Juego ${marca}`, contentType: 'GAME' });

    const html = await (await SELF.fetch(`${ORIGIN}/pendientes?type=BOOK`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain(`Libro ${marca}`);
    expect(html).not.toContain(`Juego ${marca}`);
  });

  it('ignora un tipo inventado en vez de romper', async () => {
    const response = await SELF.fetch(`${ORIGIN}/pendientes?type=PODCAST`, { headers: { Accept: 'text/html' } });
    expect(response.status).toBe(200);
    await response.text();
  });

  it('escapa el contenido en el HTML', async () => {
    const marca = crypto.randomUUID().slice(0, 6);
    const id = await crearPendiente({ titleEs: `XSS ${marca}` });
    await adminPost(`/admin/pendientes/${id}`, {
      titleEs: `XSS ${marca}`,
      contentType: 'BOOK',
      priority: 'LOW',
      status: 'PENDING',
      isPublic: '1',
      note: '<script>alert(1)</script>',
    });

    const html = await (await SELF.fetch(`${ORIGIN}/pendientes`, { headers: { Accept: 'text/html' } })).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('es cacheable en el borde', async () => {
    const response = await SELF.fetch(`${ORIGIN}/pendientes`, { headers: { Accept: 'text/html' } });
    expect(response.headers.get('Cache-Control')).toContain('s-maxage');
    await response.text();
  });

  it('publicar un pendiente invalida la caché de la sección', async () => {
    const antes = await env.CACHE.get('cachever:watchlist');
    await crearPendiente({ titleEs: `Invalida ${crypto.randomUUID().slice(0, 6)}` });
    const despues = await env.CACHE.get('cachever:watchlist');
    expect(despues).not.toBe(antes);
  });
});

describe('control de acceso', () => {
  it('la lista del panel exige sesión de administrador', async () => {
    const response = await SELF.fetch(`${ORIGIN}/admin/pendientes`, {
      headers: { Accept: 'application/json' },
    });
    expect(response.status).toBe(401);
    await response.text();
  });

  it('crear un pendiente sin sesión no funciona', async () => {
    const response = await SELF.fetch(`${ORIGIN}/admin/pendientes`, {
      method: 'POST',
      body: new URLSearchParams({ titleEs: 'Intruso', contentType: 'BOOK' }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
      },
      redirect: 'manual',
    });
    expect(response.status).toBe(401);
    await response.text();

    const row = await env.DB.prepare("SELECT id FROM watchlist_items WHERE title_es = 'Intruso'").first();
    expect(row).toBeNull();
  });

  it('exige token CSRF', async () => {
    const response = await SELF.fetch(`${ORIGIN}/admin/pendientes`, {
      method: 'POST',
      body: new URLSearchParams({ titleEs: 'Sin CSRF', contentType: 'BOOK' }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: session.cookie,
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
      },
      redirect: 'manual',
    });
    expect(response.status).toBe(403);
    await response.text();
  });
});

async function estado(id: string): Promise<string> {
  const row = await env.DB.prepare('SELECT status FROM watchlist_items WHERE id = ?').bind(id)
    .first<{ status: string }>();
  return row!.status;
}
