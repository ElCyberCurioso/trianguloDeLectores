import type { Container } from './container';
import type { RecommendationInput } from '../../validation/schemas';
import type { SessionUser } from '../lib/auth';
import type { RecommendationRow } from '../../db/repos/recommendations';
import type { RecommendationAction } from '../../types/domain';
import { badRequest, conflict, notFound } from '../lib/http';
import { pseudonymize } from '../lib/crypto';
import { escapeHtml } from '../lib/sanitize';
import { uniqueSlug } from '../lib/slug';
import { invalidateWatchlist } from '../lib/cache';

/** Cuántas propuestas admite una misma procedencia por hora. */
const MAX_POR_HORA = 5;
const HORA = 60 * 60 * 1000;

export interface RecommendationContext {
  ip: string | null;
  userAgent: string | null;
}

/**
 * Recomendaciones del público.
 *
 * Nada de lo que llega aquí se publica: entra en una bandeja interna y desde el
 * panel se decide qué hacer con ella. Aceptar una recomendación la convierte en
 * un **borrador** de reseña o en un pendiente, nunca en algo publicado — quien
 * decide qué se publica sigue siendo la persona que administra el sitio.
 */
export class RecommendationService {
  constructor(private readonly c: Container) {}

  /**
   * Registra una propuesta del público. La IP y el agente de usuario se guardan
   * pseudonimizados: sirven para frenar el abuso, no para identificar a nadie.
   */
  async submit(input: RecommendationInput, ctx: RecommendationContext): Promise<string> {
    const [ipHash, uaHash] = await Promise.all([
      pseudonymize(ctx.ip, this.c.env.HASH_PEPPER),
      pseudonymize(ctx.userAgent, this.c.env.HASH_PEPPER),
    ]);

    const recientes = await this.c.recommendations.countFrom(ipHash, Date.now() - HORA);
    if (recientes >= MAX_POR_HORA) {
      throw badRequest('too_many', 'Has enviado ya varias recomendaciones. Prueba dentro de un rato.');
    }

    if (await this.c.recommendations.pendingWithTitle(input.titleEs)) {
      throw conflict('duplicate', 'Ya hay una recomendación de esa obra esperando revisión. ¡Gracias de todas formas!');
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    await this.c.recommendations.insert({
      id,
      titleEs: input.titleEs,
      contentType: input.contentType,
      creator: input.creator ?? null,
      year: input.year ?? null,
      note: input.note,
      sourceUrl: input.sourceUrl && input.sourceUrl.length ? input.sourceUrl : null,
      alias: input.alias ?? null,
      status: 'PENDING',
      ipHash,
      uaHash,
      createdAt: now,
      updatedAt: now,
    });

    this.c.log.info('recommendation_received', { id, contentType: input.contentType });
    return id;
  }

  /** Acciones de la bandeja. Devuelve a dónde llevar al administrador, si procede. */
  async act(id: string, action: RecommendationAction, actor: SessionUser): Promise<{ redirectTo?: string }> {
    const item = await this.c.recommendations.getById(id);
    if (!item) throw notFound('Esa recomendación no existe');

    switch (action) {
      case 'to-review':
        return { redirectTo: await this.toReview(item, actor) };
      case 'to-watchlist':
        return { redirectTo: await this.toWatchlist(item, actor) };
      case 'reject':
        await this.c.recommendations.update(id, {
          status: 'REJECTED', resolution: null, resolvedAt: Date.now(),
          resolvedBy: actor.id, updatedAt: Date.now(),
        });
        break;
      case 'reopen':
        await this.c.recommendations.update(id, {
          status: 'PENDING', resolution: null, resolvedAt: null,
          resolvedBy: null, updatedAt: Date.now(),
        });
        break;
      case 'delete':
        await this.c.recommendations.remove(id);
        break;
    }

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: action === 'delete' ? 'recommendation.delete' : 'recommendation.status',
      entityType: 'recommendation',
      entityId: id,
      metadata: { action },
    });

    return {};
  }

  /**
   * La convierte en borrador de reseña, arrastrando lo que ya se sabe. El texto
   * de quien la recomendó abre el cuerpo como cita: se escapa, porque es texto
   * plano y el cuerpo de la reseña es HTML.
   */
  private async toReview(item: RecommendationRow, actor: SessionUser): Promise<string> {
    if (item.reviewId) throw conflict('already_converted', 'Esa recomendación ya tiene una reseña asociada');

    const reviewId = crypto.randomUUID();
    const now = Date.now();
    const slug = await uniqueSlug(item.titleEs, (candidato) => this.c.reviews.slugIsFree(candidato));
    const firma = item.alias ? `${escapeHtml(item.alias)} recomienda` : 'Recomendación del público';

    await this.c.reviews.insert({
      id: reviewId,
      slug,
      titleEs: item.titleEs,
      titleOriginal: null,
      otherTitles: null,
      contentType: item.contentType,
      categoryId: null,
      year: item.year,
      creator: item.creator,
      country: null,
      durationMin: null,
      episodes: null,
      volumes: null,
      ratingHalf: 0,
      summary: null,
      bodyHtml: `<blockquote><p>${escapeHtml(item.note)}</p><p><em>${firma}</em></p></blockquote><p></p>`,
      hasSpoilers: 0,
      status: 'DRAFT',
      commentsMode: 'INHERIT',
      coverKey: null,
      coverAlt: null,
      seoTitle: null,
      seoDescription: null,
      publishedAt: null,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    });

    await this.c.recommendations.update(item.id, {
      status: 'ACCEPTED', resolution: 'REVIEW', reviewId,
      resolvedAt: now, resolvedBy: actor.id, updatedAt: now,
    });

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'recommendation.to_review',
      entityType: 'recommendation',
      entityId: item.id,
      metadata: { reviewId, slug },
    });

    return `/admin/resenas/${reviewId}`;
  }

  /** La manda a la cola de pendientes, privada por omisión. */
  private async toWatchlist(item: RecommendationRow, actor: SessionUser): Promise<string> {
    if (item.watchlistId) throw conflict('already_converted', 'Esa recomendación ya está en la lista de pendientes');

    const watchlistId = crypto.randomUUID();
    const now = Date.now();
    const procedencia = item.alias ? `Recomendado por ${item.alias}: ` : 'Recomendación del público: ';

    await this.c.watchlist.insert({
      id: watchlistId,
      titleEs: item.titleEs,
      contentType: item.contentType,
      year: item.year,
      creator: item.creator,
      note: `${procedencia}${item.note}`.slice(0, 500),
      sourceUrl: item.sourceUrl,
      priority: 'MEDIUM',
      status: 'PENDING',
      // Privado hasta que se decida: la cola pública la compone quien administra.
      isPublic: 0,
      sortOrder: 0,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    });

    await this.c.recommendations.update(item.id, {
      status: 'ACCEPTED', resolution: 'WATCHLIST', watchlistId,
      resolvedAt: now, resolvedBy: actor.id, updatedAt: now,
    });

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'recommendation.to_watchlist',
      entityType: 'recommendation',
      entityId: item.id,
      metadata: { watchlistId },
    });

    await invalidateWatchlist(this.c.env);
    return `/admin/pendientes/${watchlistId}`;
  }
}
