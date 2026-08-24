import type { Container } from './container';
import type { ReviewInput } from '../../validation/schemas';
import { sanitizeHtml, htmlToText } from '../lib/sanitize';
import { uniqueSlug } from '../lib/slug';
import { invalidatePublicContent } from '../lib/cache';
import type { SessionUser } from '../lib/auth';
import type { ReviewDetail } from '../../db/repos/reviews';
import { notFound, badRequest } from '../lib/http';

/**
 * Reglas de negocio de las reseñas. El HTML del editor se sanea **aquí**, en
 * servidor, antes de tocar la base de datos: lo que se guarda ya es seguro, así
 * que un fallo futuro en la capa de render no puede convertirse en XSS.
 */
export class ReviewService {
  constructor(private readonly c: Container) {}

  private async prepare(input: ReviewInput, existingId?: string) {
    const bodyHtml = sanitizeHtml(input.bodyHtml ?? '');
    const desiredSlug = input.slug ?? input.titleEs;
    const slug = await uniqueSlug(desiredSlug, (candidate) =>
      this.c.reviews.slugIsFree(candidate, existingId),
    );
    const summary = input.summary ?? (bodyHtml ? htmlToText(bodyHtml, 280) : null);
    return { bodyHtml, slug, summary };
  }

  async create(input: ReviewInput, actor: SessionUser): Promise<string> {
    const { bodyHtml, slug, summary } = await this.prepare(input);
    const now = Date.now();
    const id = crypto.randomUUID();
    const publishing = input.status === 'PUBLISHED';

    await this.c.reviews.insert({
      id,
      slug,
      titleEs: input.titleEs,
      titleOriginal: input.titleOriginal ?? null,
      otherTitles: input.otherTitles.length ? JSON.stringify(input.otherTitles) : null,
      contentType: input.contentType,
      categoryId: input.categoryId ?? null,
      year: input.year ?? null,
      creator: input.creator ?? null,
      country: input.country ?? null,
      durationMin: input.durationMin ?? null,
      episodes: input.episodes ?? null,
      volumes: input.volumes ?? null,
      rating: input.rating,
      summary: summary ?? null,
      bodyHtml,
      hasSpoilers: input.hasSpoilers ? 1 : 0,
      status: input.status,
      commentsMode: input.commentsMode,
      coverKey: input.coverKey ?? null,
      coverAlt: input.coverAlt ?? null,
      seoTitle: input.seoTitle ?? null,
      seoDescription: input.seoDescription ?? null,
      publishedAt: publishing ? now : null,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    });

    await this.c.reviews.setGenres(id, input.genreIds);
    await this.c.reviews.setPlatforms(
      id,
      input.platforms.map((p) => ({
        platformId: p.platformId,
        url: p.url && p.url.length ? p.url : null,
        availability: p.availability,
        note: p.note ?? null,
      })),
    );

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'review.create',
      entityType: 'review',
      entityId: id,
      metadata: { slug, status: input.status },
    });
    if (publishing) await invalidatePublicContent(this.c.env);
    return id;
  }

  async update(id: string, input: ReviewInput, actor: SessionUser): Promise<void> {
    const existing = await this.c.reviews.getById(id, { includeDrafts: true });
    if (!existing) throw notFound('La reseña no existe');

    const { bodyHtml, slug, summary } = await this.prepare(input, id);
    const now = Date.now();
    const wasPublished = existing.status === 'PUBLISHED';
    const willPublish = input.status === 'PUBLISHED';

    await this.c.reviews.update(id, {
      slug,
      titleEs: input.titleEs,
      titleOriginal: input.titleOriginal ?? null,
      otherTitles: input.otherTitles.length ? JSON.stringify(input.otherTitles) : null,
      contentType: input.contentType,
      categoryId: input.categoryId ?? null,
      year: input.year ?? null,
      creator: input.creator ?? null,
      country: input.country ?? null,
      durationMin: input.durationMin ?? null,
      episodes: input.episodes ?? null,
      volumes: input.volumes ?? null,
      rating: input.rating,
      summary: summary ?? null,
      bodyHtml,
      hasSpoilers: input.hasSpoilers ? 1 : 0,
      status: input.status,
      commentsMode: input.commentsMode,
      coverKey: input.coverKey ?? null,
      coverAlt: input.coverAlt ?? null,
      seoTitle: input.seoTitle ?? null,
      seoDescription: input.seoDescription ?? null,
      publishedAt: willPublish ? (existing.publishedAt ?? now) : null,
      updatedAt: now,
    });

    await this.c.reviews.setGenres(id, input.genreIds);
    await this.c.reviews.setPlatforms(
      id,
      input.platforms.map((p) => ({
        platformId: p.platformId,
        url: p.url && p.url.length ? p.url : null,
        availability: p.availability,
        note: p.note ?? null,
      })),
    );

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'review.update',
      entityType: 'review',
      entityId: id,
      metadata: { slug, status: input.status },
    });

    // Invalidamos si estaba o pasa a estar publicada: en ambos casos cambia
    // lo que ve el público (o deja de verse).
    if (wasPublished || willPublish) await invalidatePublicContent(this.c.env);
  }

  async setStatus(id: string, status: 'DRAFT' | 'PUBLISHED', actor: SessionUser): Promise<void> {
    const existing = await this.c.reviews.getById(id, { includeDrafts: true });
    if (!existing) throw notFound('La reseña no existe');
    const now = Date.now();
    await this.c.reviews.update(id, {
      status,
      publishedAt: status === 'PUBLISHED' ? (existing.publishedAt ?? now) : null,
      updatedAt: now,
    });
    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: status === 'PUBLISHED' ? 'review.publish' : 'review.unpublish',
      entityType: 'review',
      entityId: id,
      metadata: { slug: existing.slug },
    });
    await invalidatePublicContent(this.c.env);
  }

  async duplicate(id: string, actor: SessionUser): Promise<string> {
    const source = await this.c.reviews.getById(id, { includeDrafts: true });
    if (!source) throw notFound('La reseña no existe');

    const newId = crypto.randomUUID();
    const now = Date.now();
    const slug = await uniqueSlug(`${source.slug}-copia`, (s) => this.c.reviews.slugIsFree(s));

    await this.c.reviews.insert({
      id: newId,
      slug,
      titleEs: `${source.titleEs} (copia)`,
      titleOriginal: source.titleOriginal,
      otherTitles: source.otherTitles.length ? JSON.stringify(source.otherTitles) : null,
      contentType: source.contentType,
      categoryId: source.categoryId,
      year: source.year,
      creator: source.creator,
      country: source.country,
      durationMin: source.durationMin,
      episodes: source.episodes,
      volumes: source.volumes,
      rating: source.rating,
      summary: source.summary,
      bodyHtml: source.bodyHtml,
      hasSpoilers: source.hasSpoilers,
      // Una copia nace SIEMPRE como borrador: publicar es un acto explícito.
      status: 'DRAFT',
      commentsMode: source.commentsMode,
      coverKey: source.coverKey,
      coverAlt: source.coverAlt,
      seoTitle: source.seoTitle,
      seoDescription: source.seoDescription,
      publishedAt: null,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    });

    await this.c.reviews.setGenres(newId, source.genres.map((g) => g.id));
    await this.c.reviews.setPlatforms(
      newId,
      source.platforms.map((p) => ({
        platformId: p.platformId,
        url: p.url,
        availability: p.availability,
        note: p.note,
      })),
    );

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'review.duplicate',
      entityType: 'review',
      entityId: newId,
      metadata: { sourceId: id },
    });
    return newId;
  }

  async remove(id: string, actor: SessionUser): Promise<void> {
    const existing = await this.c.reviews.getById(id, { includeDrafts: true });
    if (!existing) throw notFound('La reseña no existe');
    await this.c.reviews.softDelete(id);
    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'review.delete',
      entityType: 'review',
      entityId: id,
      metadata: { slug: existing.slug },
    });
    await invalidatePublicContent(this.c.env);
  }

  async restore(id: string, actor: SessionUser): Promise<void> {
    await this.c.reviews.restore(id);
    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'review.restore',
      entityType: 'review',
      entityId: id,
    });
    await invalidatePublicContent(this.c.env);
  }

  /** ¿Se admiten comentarios en esta reseña? Combina reseña + configuración. */
  async commentPolicy(review: Pick<ReviewDetail, 'commentsMode'>): Promise<'OPEN' | 'AUTH' | 'CLOSED'> {
    if (review.commentsMode !== 'INHERIT') return review.commentsMode;
    return this.c.settings.get('comments.mode');
  }

  assertValidPlatformSelection(ids: string[], known: Set<string>): void {
    for (const id of ids) {
      if (!known.has(id)) throw badRequest('unknown_platform', 'Plataforma desconocida');
    }
  }
}
