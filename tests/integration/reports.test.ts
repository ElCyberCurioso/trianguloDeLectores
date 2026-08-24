import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  ORIGIN, loginAsAdmin, createReview, readFormToken, setSetting, type AdminSession,
  resetAdminRateLimit,
} from './helpers';

let session: AdminSession;

beforeAll(async () => {
  session = await loginAsAdmin();
  await resetAdminRateLimit();
  await setSetting('comments.require_approval', false);
  await setSetting('moderation.report_threshold', 3);
  await setSetting('moderation.auto_hide_threshold', 10);
});

async function createApprovedComment(title: string): Promise<{ reviewId: string; slug: string; commentId: string }> {
  const review = await createReview(session, { title });
  const formToken = await readFormToken(review.slug);

  await SELF.fetch(`${ORIGIN}/api/resenas/${review.slug}/comentarios`, {
    method: 'POST',
    body: new URLSearchParams({ _form: formToken, reviewId: review.id, alias: 'Ana', body: 'Comentario reportable' }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Origin: ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
      // IP aleatoria: el rate limit por IP es real y aquí no es lo que se prueba.
      'CF-Connecting-IP': `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`,
    },
  });

  const comment = await env.DB.prepare('SELECT id FROM comments WHERE review_id = ?').bind(review.id)
    .first<{ id: string }>();
  return { reviewId: review.id, slug: review.slug, commentId: comment!.id };
}

/** Cada "persona" que reporta se identifica por su propia cookie tdl_rid + IP. */
async function report(
  slug: string,
  commentId: string,
  reporter: string,
  reason = 'SPAM',
): Promise<Response> {
  const formToken = await readFormToken(slug);
  return SELF.fetch(`${ORIGIN}/api/comentarios/${commentId}/reportar`, {
    method: 'POST',
    body: new URLSearchParams({ _form: formToken, commentId, reason }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Origin: ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
      Cookie: `tdl_rid=${reporter}`,
      // La identidad que deduplica es la cookie tdl_rid, no la IP.
      'CF-Connecting-IP': `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`,
    },
  });
}

describe('reportes de comentarios', () => {
  it('acepta un reporte y lo persiste', async () => {
    const { slug, commentId } = await createApprovedComment('Reseña con reporte');
    const response = await report(slug, commentId, 'reporterAAAAAAAAAAAAAAAA');
    expect(response.status).toBe(200);

    const row = await env.DB.prepare('SELECT reason, status FROM comment_reports WHERE comment_id = ?')
      .bind(commentId)
      .first<{ reason: string; status: string }>();
    expect(row!.reason).toBe('SPAM');
    expect(row!.status).toBe('OPEN');
  });

  it('impide que la misma persona reporte dos veces el mismo comentario', async () => {
    const { slug, commentId } = await createApprovedComment('Reporte duplicado');
    const reporter = 'reporterBBBBBBBBBBBBBBBB';

    expect((await report(slug, commentId, reporter)).status).toBe(200);
    const segundo = await report(slug, commentId, reporter);
    expect(segundo.status).toBe(409);

    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM comment_reports WHERE comment_id = ?')
      .bind(commentId)
      .first<{ total: number }>();
    expect(count!.total).toBe(1);
  });

  it('no guarda datos identificativos en claro del reportante', async () => {
    const { slug, commentId } = await createApprovedComment('Privacidad del reporte');
    const reporter = 'reporterCCCCCCCCCCCCCCCC';
    await report(slug, commentId, reporter);

    const row = await env.DB.prepare('SELECT reporter_hash FROM comment_reports WHERE comment_id = ?')
      .bind(commentId)
      .first<{ reporter_hash: string }>();
    expect(row!.reporter_hash).not.toContain(reporter);
    expect(row!.reporter_hash).not.toContain('10.2.');
    expect(row!.reporter_hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('la dedupe no se rompe si cambia la IP del reportante', async () => {
    const { slug, commentId } = await createApprovedComment('Dedupe con IP cambiante');
    const reporter = 'reporterMovilYWifiXXXXXX';

    expect((await report(slug, commentId, reporter)).status).toBe(200);
    // `report` usa una IP aleatoria en cada llamada: aun así debe rechazarse.
    expect((await report(slug, commentId, reporter)).status).toBe(409);
  });

  it('rechaza motivos desconocidos', async () => {
    const { slug, commentId } = await createApprovedComment('Motivo inválido');
    const response = await report(slug, commentId, 'reporterDDDDDDDDDDDDDDDD', 'MOTIVO_FALSO');
    expect(response.status).toBe(400);
  });

  it('rechaza reportes desde otro origen', async () => {
    const { slug, commentId } = await createApprovedComment('Reporte cruzado');
    const formToken = await readFormToken(slug);
    const response = await SELF.fetch(`${ORIGIN}/api/comentarios/${commentId}/reportar`, {
      method: 'POST',
      body: new URLSearchParams({ _form: formToken, commentId, reason: 'SPAM' }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Origin: 'https://malicioso.example',
      },
    });
    expect(response.status).toBe(403);
  });
});

describe('umbral automático', () => {
  it('al alcanzar el umbral el comentario pasa de APPROVED a REPORTED', async () => {
    const { slug, commentId } = await createApprovedComment('Umbral alcanzado');

    await report(slug, commentId, 'reporterE1'.padEnd(24, 'x'));
    await report(slug, commentId, 'reporterE2'.padEnd(25, 'x'));

    let row = await env.DB.prepare('SELECT status, report_count FROM comments WHERE id = ?').bind(commentId)
      .first<{ status: string; report_count: number }>();
    expect(row!.status).toBe('APPROVED');
    expect(row!.report_count).toBe(2);

    // Tercer reporte: se cruza el umbral configurado (3).
    await report(slug, commentId, 'reporterE3'.padEnd(26, 'x'));

    row = await env.DB.prepare('SELECT status, report_count FROM comments WHERE id = ?').bind(commentId)
      .first<{ status: string; report_count: number }>();
    expect(row!.report_count).toBe(3);
    expect(row!.status).toBe('REPORTED');
  });

  it('deja de mostrarse públicamente al pasar a REPORTED', async () => {
    const { slug, commentId } = await createApprovedComment('Reportado se oculta');
    for (const suffix of ['F1', 'F2', 'F3']) {
      await report(slug, commentId, `reporter${suffix}`.padEnd(24 + suffix.length, 'x'));
    }

    const html = await (await SELF.fetch(`${ORIGIN}/resena/${slug}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).not.toContain('Comentario reportable');
  });

  it('registra la transición en auditoría', async () => {
    const { slug, commentId } = await createApprovedComment('Auditoría del umbral');
    for (const suffix of ['G1', 'G2', 'G3']) {
      await report(slug, commentId, `reporter${suffix}`.padEnd(24 + suffix.length, 'x'));
    }

    const row = await env.DB.prepare(
      "SELECT action, actor_role FROM audit_log WHERE entity_id = ? AND action = 'report.threshold'",
    ).bind(commentId).first<{ action: string; actor_role: string }>();
    expect(row!.actor_role).toBe('SYSTEM');
  });

  it('el umbral es configurable', async () => {
    await setSetting('moderation.report_threshold', 2);
    const { slug, commentId } = await createApprovedComment('Umbral de dos');

    await report(slug, commentId, 'reporterH1'.padEnd(24, 'x'));
    await report(slug, commentId, 'reporterH2'.padEnd(25, 'x'));

    const row = await env.DB.prepare('SELECT status FROM comments WHERE id = ?').bind(commentId)
      .first<{ status: string }>();
    expect(row!.status).toBe('REPORTED');

    await setSetting('moderation.report_threshold', 3);
  });

  it('el umbral de ocultación automática pasa el comentario a HIDDEN', async () => {
    await setSetting('moderation.auto_hide_threshold', 4);
    const { slug, commentId } = await createApprovedComment('Ocultación automática');

    for (const suffix of ['I1', 'I2', 'I3', 'I4']) {
      await report(slug, commentId, `reporter${suffix}`.padEnd(24 + suffix.length, 'x'));
    }

    const row = await env.DB.prepare('SELECT status FROM comments WHERE id = ?').bind(commentId)
      .first<{ status: string }>();
    expect(row!.status).toBe('HIDDEN');

    await setSetting('moderation.auto_hide_threshold', 10);
  });

  it('aprobar tras el umbral limpia el contador y los reportes', async () => {
    const { slug, commentId } = await createApprovedComment('Reset tras aprobar');
    for (const suffix of ['J1', 'J2', 'J3']) {
      await report(slug, commentId, `reporter${suffix}`.padEnd(24 + suffix.length, 'x'));
    }

    await SELF.fetch(`${ORIGIN}/admin/comentarios/${commentId}/accion`, {
      method: 'POST',
      body: new URLSearchParams({ _csrf: session.csrf, action: 'approve' }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: session.cookie,
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
      },
      redirect: 'manual',
    });

    const row = await env.DB.prepare('SELECT status, report_count FROM comments WHERE id = ?').bind(commentId)
      .first<{ status: string; report_count: number }>();
    expect(row!.status).toBe('APPROVED');
    expect(row!.report_count).toBe(0);

    const open = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM comment_reports WHERE comment_id = ? AND status = 'OPEN'",
    ).bind(commentId).first<{ total: number }>();
    expect(open!.total).toBe(0);
  });
});

describe('dashboard', () => {
  it('cuenta los comentarios pendientes', async () => {
    await setSetting('comments.require_approval', true);
    const review = await createReview(session, { title: 'Pendientes en dashboard' });
    const formToken = await readFormToken(review.slug);

    await SELF.fetch(`${ORIGIN}/api/resenas/${review.slug}/comentarios`, {
      method: 'POST',
      body: new URLSearchParams({ _form: formToken, reviewId: review.id, alias: 'Ana', body: 'Cuento como pendiente' }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        'CF-Connecting-IP': `10.3.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`,
      },
    });

    await env.CACHE.delete('stats:pending');
    const response = await SELF.fetch(`${ORIGIN}/admin/api/stats/pendientes`, {
      headers: { Cookie: session.cookie, Accept: 'application/json' },
    });
    const payload = (await response.json()) as { data: { pending: number } };
    expect(payload.data.pending).toBeGreaterThanOrEqual(1);

    const html = await (await SELF.fetch(`${ORIGIN}/admin`, {
      headers: { Cookie: session.cookie, Accept: 'text/html' },
    })).text();
    expect(html).toContain('Comentarios pendientes:');

    await setSetting('comments.require_approval', false);
  });
});
