import type { Context } from 'hono';
import { Hono } from 'hono';
import type { AppEnv } from '../../types/env';
import { commentInputSchema, reportInputSchema, recommendationInputSchema, fieldErrors } from '../../validation/schemas';
import { verifyFormToken } from '../lib/formtoken';
import { verifyTurnstile } from '../lib/turnstile';
import { badRequest, forbidden, isSameOrigin, clientIp, ok, notFound } from '../lib/http';
import { rateLimit } from '../middleware/ratelimit';
import { CommentService } from '../services/comments';
import { RecommendationService } from '../services/recommendations';
import { ReviewService } from '../services/reviews';
import { getOrCreateReporterId } from '../lib/auth';
import { renderCommentBody } from '../lib/sanitize';

export const publicApi = new Hono<AppEnv>();

/** Los formularios públicos no tienen sesión: el origen es la primera barrera. */
function assertOrigin(c: Context<AppEnv>) {
  if (!isSameOrigin(c)) throw forbidden('Origen no permitido');
}

/**
 * Techo de tamaño para los formularios públicos. Los campos más largos suman
 * unos pocos kilobytes; 64 kB deja margen de sobra y corta el cuerpo enorme
 * antes de gastar CPU en parsearlo.
 */
const MAX_FORM_BYTES = 64 * 1024;

function assertBodySize(c: Context<AppEnv>) {
  const declarado = Number(c.req.header('Content-Length') ?? '0');
  if (Number.isFinite(declarado) && declarado > MAX_FORM_BYTES) {
    throw badRequest('too_large', 'El formulario es demasiado grande.');
  }
}

function wantsJson(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const accept = c.req.header('Accept') ?? '';
  return accept.includes('application/json') || (c.req.header('X-Requested-With') ?? '') === 'fetch';
}

// ------------------------------------------------------------- comentarios --
publicApi.post('/resenas/:slug/comentarios', rateLimit('comment'), async (c) => {
  assertOrigin(c);
  assertBodySize(c);
  const container = c.get('container');
  const slug = c.req.param('slug');

  const review = await container.reviews.getBySlug(slug);
  if (!review) throw notFound('La reseña no existe');

  const body = await c.req.parseBody({ all: true });
  const parsed = commentInputSchema.safeParse({
    reviewId: typeof body.reviewId === 'string' ? body.reviewId : review.id,
    parentId: typeof body.parentId === 'string' && body.parentId ? body.parentId : undefined,
    alias: typeof body.alias === 'string' ? body.alias : c.get('user')?.displayName ?? '',
    body: typeof body.body === 'string' ? body.body : '',
    turnstileToken: typeof body['cf-turnstile-response'] === 'string' ? body['cf-turnstile-response'] : undefined,
    website: typeof body.website === 'string' ? body.website : undefined,
  });

  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    if (wantsJson(c)) return c.json({ ok: false, error: { code: 'validation', message: 'Revisa el formulario', details: errors } }, 400);
    return c.redirect(`/resena/${slug}?error=validacion#comentarios`, 303);
  }

  const input = parsed.data;
  if (input.reviewId !== review.id) throw badRequest('mismatch', 'La reseña no coincide');

  // Honeypot: se responde 200 para no darle señal al bot, pero no se guarda nada.
  if (input.website && input.website.length > 0) {
    container.log.warn('honeypot_triggered', { slug });
    if (wantsJson(c)) return ok(c, { pending: true, message: 'Comentario recibido.' });
    return c.redirect(`/resena/${slug}?comentario=pendiente#comentarios`, 303);
  }

  if (!(await verifyFormToken(c.env, `comment:${review.id}`, typeof body._form === 'string' ? body._form : null))) {
    throw forbidden('El formulario ha caducado. Recarga la página e inténtalo de nuevo.');
  }

  const settings = await container.settings.all();
  if (settings['security.turnstile_comments']) {
    const verdict = await verifyTurnstile(c.env, input.turnstileToken, clientIp(c), c.get('requestId'));
    if (!verdict.success) {
      container.log.warn('turnstile_failed', { scope: 'comment', errorCodes: verdict.errorCodes });
      throw forbidden('No hemos podido verificar que no eres un bot. Inténtalo de nuevo.');
    }
  }

  const policy = await new ReviewService(container).commentPolicy(review);
  const service = new CommentService(container);
  const result = await service.create(input, {
    ip: clientIp(c),
    userAgent: c.req.header('User-Agent') ?? null,
    user: c.get('user'),
  }, policy);

  if (wantsJson(c)) {
    return ok(c, {
      pending: result.pending,
      message: result.pending
        ? 'Tu comentario se ha enviado y aparecerá cuando se apruebe.'
        : 'Comentario publicado.',
      comment: result.pending
        ? null
        : {
            id: result.comment.id,
            authorAlias: result.comment.authorAlias,
            createdAt: result.comment.createdAt,
            parentId: result.comment.parentId,
            depth: result.comment.depth,
            html: renderCommentBody(result.comment.body),
          },
    }, 201);
  }

  const flag = result.pending ? 'pendiente' : 'publicado';
  return c.redirect(`/resena/${slug}?comentario=${flag}#comentarios`, 303);
});

// ---------------------------------------------------------------- reportes --
publicApi.post('/comentarios/:id/reportar', rateLimit('report'), async (c) => {
  assertOrigin(c);
  assertBodySize(c);
  const container = c.get('container');
  const commentId = c.req.param('id');

  const body = await c.req.parseBody({ all: true });
  const parsed = reportInputSchema.safeParse({
    commentId,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    details: typeof body.details === 'string' ? body.details : undefined,
    turnstileToken: typeof body['cf-turnstile-response'] === 'string' ? body['cf-turnstile-response'] : undefined,
  });
  if (!parsed.success) throw badRequest('validation', 'Selecciona un motivo válido', fieldErrors(parsed.error));

  const comment = await container.comments.getById(commentId);
  if (!comment) throw notFound('El comentario no existe');

  // El token del formulario se emite por reseña: se valida contra la reseña
  // real del comentario, no contra un campo que envíe el cliente.
  const formToken = typeof body._form === 'string' ? body._form : null;
  if (!(await verifyFormToken(c.env, `comment:${comment.reviewId}`, formToken))) {
    throw forbidden('El formulario ha caducado. Recarga la página e inténtalo de nuevo.');
  }

  const settings = await container.settings.all();
  if (settings['security.turnstile_reports']) {
    const verdict = await verifyTurnstile(c.env, parsed.data.turnstileToken, clientIp(c), c.get('requestId'));
    if (!verdict.success) throw forbidden('No hemos podido verificar que no eres un bot.');
  }

  const reporterId = getOrCreateReporterId(c);
  const service = new CommentService(container);
  const result = await service.report(parsed.data, {
    reporterId,
    ip: clientIp(c),
    user: c.get('user'),
  });

  if (wantsJson(c)) {
    return ok(c, { message: 'Gracias. Hemos recibido tu reporte.', transitioned: result.transitioned });
  }
  const review = await container.reviews.getById(comment.reviewId);
  return c.redirect(review ? `/resena/${review.slug}?reporte=recibido#comentarios` : '/', 303);
});

// ---------------------------------------------------------- recomendaciones --
/**
 * Propuestas del público. Mismo cinturón que los comentarios: origen, token de
 * formulario firmado, honeypot, Turnstile y límite por IP. Nada se publica: la
 * propuesta entra en la bandeja interna del panel.
 */
publicApi.post('/recomendaciones', rateLimit('recommendation'), async (c) => {
  assertOrigin(c);
  assertBodySize(c);
  const container = c.get('container');
  const body = await c.req.parseBody({ all: true });

  const texto = (campo: unknown): string | undefined =>
    typeof campo === 'string' && campo.trim().length ? campo : undefined;

  if (!(await verifyFormToken(c.env, 'recommendation', typeof body._form === 'string' ? body._form : null))) {
    throw badRequest('form_token', 'El formulario ha caducado. Vuelve a cargarlo.');
  }

  // Honeypot: se responde como si todo hubiera ido bien, pero no se guarda nada.
  if (texto(body.website)) {
    container.log.warn('honeypot_triggered', { form: 'recommendation' });
    return c.redirect('/recomendar?enviada=1', 303);
  }

  const parsed = recommendationInputSchema.safeParse({
    titleEs: typeof body.titleEs === 'string' ? body.titleEs : '',
    contentType: typeof body.contentType === 'string' ? body.contentType : '',
    creator: texto(body.creator),
    year: texto(body.year),
    note: typeof body.note === 'string' ? body.note : '',
    sourceUrl: texto(body.sourceUrl) ?? '',
    alias: texto(body.alias),
  });

  if (!parsed.success) {
    const errores = fieldErrors(parsed.error);
    if (wantsJson(c)) {
      return c.json({ ok: false, error: { code: 'validation', message: 'Revisa el formulario', details: errores } }, 400);
    }
    return c.redirect('/recomendar?error=validacion', 303);
  }

  const settings = await container.settings.all();
  if (c.env.TURNSTILE_ENABLED === 'true' && settings['security.turnstile_comments']) {
    const token = typeof body['cf-turnstile-response'] === 'string' ? body['cf-turnstile-response'] : undefined;
    const verdict = await verifyTurnstile(c.env, token, clientIp(c), c.get('requestId'));
    if (!verdict.success) throw forbidden('No hemos podido verificar que no eres un robot');
  }

  await new RecommendationService(container).submit(parsed.data, {
    ip: clientIp(c),
    userAgent: c.req.header('User-Agent') ?? null,
  });

  if (wantsJson(c)) return ok(c, { message: 'Recomendación recibida.' });
  return c.redirect('/recomendar?enviada=1', 303);
});
