import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  ORIGIN, loginAsAdmin, createReview, readFormToken, mintFormToken, setSetting, type AdminSession,
  resetAdminRateLimit,
} from './helpers';

let session: AdminSession;

beforeAll(async () => {
  session = await loginAsAdmin();
  await resetAdminRateLimit();
});

interface PostCommentOptions {
  alias?: string;
  body?: string;
  parentId?: string;
  formToken?: string;
  origin?: string;
  website?: string;
}

async function postComment(
  slug: string,
  reviewId: string,
  options: PostCommentOptions = {},
): Promise<Response> {
  const fields: Record<string, string> = {
    _form: options.formToken ?? (await readFormToken(slug)),
    reviewId,
    alias: options.alias ?? 'Ana',
    body: options.body ?? 'Un comentario de prueba.',
  };
  if (options.parentId) fields.parentId = options.parentId;
  if (options.website !== undefined) fields.website = options.website;

  return SELF.fetch(`${ORIGIN}/api/resenas/${slug}/comentarios`, {
    method: 'POST',
    body: new URLSearchParams(fields),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Origin: options.origin ?? ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
      'CF-Connecting-IP': `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
    },
  });
}

describe('publicación de comentarios', () => {
  it('acepta un comentario anónimo y lo deja pendiente de aprobación', async () => {
    await setSetting('comments.require_approval', true);
    const review = await createReview(session, { title: 'Reseña comentable' });

    const response = await postComment(review.slug, review.id);
    expect(response.status).toBe(201);

    const payload = (await response.json()) as { ok: boolean; data: { pending: boolean } };
    expect(payload.data.pending).toBe(true);

    const row = await env.DB.prepare('SELECT status, author_alias FROM comments WHERE review_id = ?')
      .bind(review.id)
      .first<{ status: string; author_alias: string }>();
    expect(row!.status).toBe('PENDING');
    expect(row!.author_alias).toBe('Ana');
  });

  it('publica directamente si no se exige aprobación', async () => {
    await setSetting('comments.require_approval', false);
    const review = await createReview(session, { title: 'Sin moderación previa' });

    await postComment(review.slug, review.id, { body: 'Directo al hilo' });

    const row = await env.DB.prepare('SELECT status FROM comments WHERE review_id = ?')
      .bind(review.id)
      .first<{ status: string }>();
    expect(row!.status).toBe('APPROVED');

    await setSetting('comments.require_approval', true);
  });

  it('guarda el cuerpo como texto plano, nunca como HTML', async () => {
    const review = await createReview(session, { title: 'Comentario con XSS' });
    await postComment(review.slug, review.id, { body: '<script>alert(1)</script>' });

    const row = await env.DB.prepare('SELECT body FROM comments WHERE review_id = ?')
      .bind(review.id)
      .first<{ body: string }>();
    // Se guarda literal; el escapado ocurre al renderizar.
    expect(row!.body).toBe('<script>alert(1)</script>');
  });

  it('el comentario aprobado se renderiza escapado', async () => {
    await setSetting('comments.require_approval', false);
    const review = await createReview(session, { title: 'Render seguro' });
    await postComment(review.slug, review.id, { body: '<img src=x onerror=alert(1)>' });

    const html = await (await SELF.fetch(`${ORIGIN}/resena/${review.slug}`, { headers: { Accept: 'text/html' } })).text();
    // Lo importante es que no exista una etiqueta real: el texto escapado sí
    // contiene la cadena literal, y eso es exactamente lo que se busca.
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');

    await setSetting('comments.require_approval', true);
  });

  it('convierte ||texto|| en spoiler al renderizar', async () => {
    await setSetting('comments.require_approval', false);
    const review = await createReview(session, { title: 'Spoiler en comentario' });
    await postComment(review.slug, review.id, { body: 'Ojo: ||muere al final||' });

    const html = await (await SELF.fetch(`${ORIGIN}/resena/${review.slug}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain('class="spoiler"');

    await setSetting('comments.require_approval', true);
  });

  it('rechaza el comentario sin token de formulario', async () => {
    const review = await createReview(session, { title: 'Sin token' });
    const response = await postComment(review.slug, review.id, { formToken: 'token-inventado' });
    expect(response.status).toBe(403);
  });

  it('rechaza el comentario desde otro origen', async () => {
    const review = await createReview(session, { title: 'Origen cruzado' });
    const response = await postComment(review.slug, review.id, { origin: 'https://malicioso.example' });
    expect(response.status).toBe(403);
  });

  it('descarta silenciosamente los comentarios que caen en el honeypot', async () => {
    const review = await createReview(session, { title: 'Honeypot' });
    const response = await postComment(review.slug, review.id, { website: 'http://spam.example' });
    expect(response.status).toBe(200);

    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM comments WHERE review_id = ?')
      .bind(review.id)
      .first<{ total: number }>();
    expect(count!.total).toBe(0);
  });

  it('rechaza comentarios demasiado cortos o demasiado largos', async () => {
    const review = await createReview(session, { title: 'Longitudes' });
    expect((await postComment(review.slug, review.id, { body: 'x' })).status).toBe(400);
    expect((await postComment(review.slug, review.id, { body: 'y'.repeat(5000) })).status).toBe(400);
  });

  it('no permite comentar en una reseña no publicada', async () => {
    const review = await createReview(session, { title: 'Borrador cerrado', status: 'DRAFT' });
    const response = await SELF.fetch(`${ORIGIN}/api/resenas/${review.slug}/comentarios`, {
      method: 'POST',
      body: new URLSearchParams({ reviewId: review.id, alias: 'Ana', body: 'hola', _form: 'x' }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    expect(response.status).toBe(404);
  });
});

describe('respuestas anidadas', () => {
  it('anida respuestas y mantiene el orden del hilo', async () => {
    await setSetting('comments.require_approval', false);
    const review = await createReview(session, { title: 'Hilo anidado' });

    await postComment(review.slug, review.id, { body: 'Comentario raíz' });
    const root = await env.DB.prepare('SELECT id, path, depth FROM comments WHERE review_id = ?')
      .bind(review.id)
      .first<{ id: string; path: string; depth: number }>();
    expect(root!.depth).toBe(0);

    await postComment(review.slug, review.id, { body: 'Respuesta nivel 1', parentId: root!.id });
    const child = await env.DB.prepare('SELECT id, path, depth, parent_id FROM comments WHERE parent_id = ?')
      .bind(root!.id)
      .first<{ id: string; path: string; depth: number; parent_id: string }>();

    expect(child!.depth).toBe(1);
    expect(child!.path.startsWith(root!.path)).toBe(true);

    const parent = await env.DB.prepare('SELECT reply_count FROM comments WHERE id = ?')
      .bind(root!.id)
      .first<{ reply_count: number }>();
    expect(parent!.reply_count).toBe(1);

    await setSetting('comments.require_approval', true);
  });

  it('respeta el límite de profundidad configurado', async () => {
    await setSetting('comments.require_approval', false);
    await setSetting('comments.max_depth', 2);

    const review = await createReview(session, { title: 'Profundidad limitada' });
    await postComment(review.slug, review.id, { body: 'Nivel 0' });
    const root = await env.DB.prepare('SELECT id FROM comments WHERE review_id = ? AND depth = 0')
      .bind(review.id)
      .first<{ id: string }>();

    await postComment(review.slug, review.id, { body: 'Nivel 1', parentId: root!.id });
    const child = await env.DB.prepare('SELECT id FROM comments WHERE review_id = ? AND depth = 1')
      .bind(review.id)
      .first<{ id: string }>();

    const tooDeep = await postComment(review.slug, review.id, { body: 'Nivel 2', parentId: child!.id });
    expect(tooDeep.status).toBe(400);

    await setSetting('comments.max_depth', 4);
    await setSetting('comments.require_approval', true);
  });

  it('no permite responder a un comentario de otra reseña', async () => {
    await setSetting('comments.require_approval', false);
    const a = await createReview(session, { title: 'Reseña A' });
    const b = await createReview(session, { title: 'Reseña B' });

    await postComment(a.slug, a.id, { body: 'En A' });
    const enA = await env.DB.prepare('SELECT id FROM comments WHERE review_id = ?').bind(a.id)
      .first<{ id: string }>();

    const cruzado = await postComment(b.slug, b.id, { body: 'Cruzado', parentId: enA!.id });
    expect(cruzado.status).toBe(400);

    await setSetting('comments.require_approval', true);
  });
});

describe('moderación', () => {
  async function moderate(commentId: string, action: string) {
    return SELF.fetch(`${ORIGIN}/admin/comentarios/${commentId}/accion`, {
      method: 'POST',
      body: new URLSearchParams({ _csrf: session.csrf, action }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: session.cookie,
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
      },
      redirect: 'manual',
    });
  }

  it('aprueba un comentario pendiente y lo hace visible', async () => {
    const review = await createReview(session, { title: 'A moderar' });
    await postComment(review.slug, review.id, { body: 'Pendiente de aprobación' });
    const comment = await env.DB.prepare('SELECT id FROM comments WHERE review_id = ?').bind(review.id)
      .first<{ id: string }>();

    let html = await (await SELF.fetch(`${ORIGIN}/resena/${review.slug}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).not.toContain('Pendiente de aprobación');

    await moderate(comment!.id, 'approve');

    html = await (await SELF.fetch(`${ORIGIN}/resena/${review.slug}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain('Pendiente de aprobación');
  });

  it('actualiza el contador de comentarios de la reseña', async () => {
    const review = await createReview(session, { title: 'Contador' });
    await postComment(review.slug, review.id, { body: 'Uno' });
    const comment = await env.DB.prepare('SELECT id FROM comments WHERE review_id = ?').bind(review.id)
      .first<{ id: string }>();

    await moderate(comment!.id, 'approve');
    const row = await env.DB.prepare('SELECT comment_count FROM reviews WHERE id = ?').bind(review.id)
      .first<{ comment_count: number }>();
    expect(row!.comment_count).toBe(1);
  });

  it('oculta y restaura', async () => {
    const review = await createReview(session, { title: 'Ocultar y restaurar' });
    await postComment(review.slug, review.id, { body: 'Visible o no' });
    const comment = await env.DB.prepare('SELECT id FROM comments WHERE review_id = ?').bind(review.id)
      .first<{ id: string }>();

    await moderate(comment!.id, 'hide');
    let row = await env.DB.prepare('SELECT status, is_deleted FROM comments WHERE id = ?').bind(comment!.id)
      .first<{ status: string; is_deleted: number }>();
    expect(row!.status).toBe('HIDDEN');

    await moderate(comment!.id, 'restore');
    row = await env.DB.prepare('SELECT status, is_deleted FROM comments WHERE id = ?').bind(comment!.id)
      .first<{ status: string; is_deleted: number }>();
    expect(row!.status).toBe('APPROVED');
    expect(row!.is_deleted).toBe(0);
  });

  it('al eliminar conserva el nodo como tumba y no rompe el hilo', async () => {
    await setSetting('comments.require_approval', false);
    const review = await createReview(session, { title: 'Tumba en el hilo' });

    await postComment(review.slug, review.id, { body: 'Padre a eliminar' });
    const padre = await env.DB.prepare('SELECT id FROM comments WHERE review_id = ? AND depth = 0')
      .bind(review.id)
      .first<{ id: string }>();
    await postComment(review.slug, review.id, { body: 'Respuesta que sobrevive', parentId: padre!.id });

    await moderate(padre!.id, 'delete');

    const row = await env.DB.prepare('SELECT is_deleted, body FROM comments WHERE id = ?').bind(padre!.id)
      .first<{ is_deleted: number; body: string }>();
    expect(row!.is_deleted).toBe(1);
    expect(row!.body).toBe('');

    const html = await (await SELF.fetch(`${ORIGIN}/resena/${review.slug}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain('Este comentario ha sido eliminado');
    expect(html).toContain('Respuesta que sobrevive');

    await setSetting('comments.require_approval', true);
  });

  it('el borrado definitivo elimina también el subárbol', async () => {
    await setSetting('comments.require_approval', false);
    const review = await createReview(session, { title: 'Borrado definitivo' });

    await postComment(review.slug, review.id, { body: 'Raíz' });
    const raiz = await env.DB.prepare('SELECT id FROM comments WHERE review_id = ? AND depth = 0')
      .bind(review.id)
      .first<{ id: string }>();
    await postComment(review.slug, review.id, { body: 'Hija', parentId: raiz!.id });

    await moderate(raiz!.id, 'purge');

    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM comments WHERE review_id = ?')
      .bind(review.id)
      .first<{ total: number }>();
    expect(count!.total).toBe(0);

    await setSetting('comments.require_approval', true);
  });

  it('no permite moderar sin sesión de administrador', async () => {
    const review = await createReview(session, { title: 'Moderación protegida' });
    await postComment(review.slug, review.id, { body: 'Intocable' });
    const comment = await env.DB.prepare('SELECT id FROM comments WHERE review_id = ?').bind(review.id)
      .first<{ id: string }>();

    const response = await SELF.fetch(`${ORIGIN}/admin/comentarios/${comment!.id}/accion`, {
      method: 'POST',
      body: new URLSearchParams({ action: 'approve' }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        Accept: 'application/json',
      },
      redirect: 'manual',
    });
    expect(response.status).toBe(401);
  });
});

describe('política de comentarios', () => {
  it('respeta el modo CLOSED de la reseña', async () => {
    const review = await createReview(session, {
      title: 'Comentarios cerrados',
      extra: { commentsMode: 'CLOSED' },
    });

    const html = await (await SELF.fetch(`${ORIGIN}/resena/${review.slug}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain('comentarios están cerrados');

    // Token emitido a mano: la página cerrada no pinta formulario, pero el
    // servidor debe rechazar igualmente aunque alguien fabrique la petición.
    const response = await postComment(review.slug, review.id, {
      formToken: await mintFormToken(review.id),
    });
    expect(response.status).toBe(403);
  });

  it('el modo AUTH exige sesión', async () => {
    const review = await createReview(session, {
      title: 'Comentarios con sesión',
      extra: { commentsMode: 'AUTH' },
    });
    const response = await postComment(review.slug, review.id, {
      formToken: await mintFormToken(review.id),
    });
    expect(response.status).toBe(403);
  });
});
