import type { Container } from './container';
import type { WatchlistInput } from '../../validation/schemas';
import type { SessionUser } from '../lib/auth';
import type { WatchlistRow } from '../../db/repos/watchlist';
import { notFound, badRequest, conflict } from '../lib/http';
import { invalidateWatchlist } from '../lib/cache';
import { uniqueSlug, slugify } from '../lib/slug';
import { escapeHtml } from '../lib/sanitize';
import type { ContentType, WatchlistStatus } from '../../types/domain';

export type WatchlistAction =
  | 'start'
  | 'complete'
  | 'drop'
  | 'reopen'
  | 'delete'
  | 'convert'
  | 'toggle-public';

/**
 * Cola de pendientes: lo que el administrador quiere ver, leer o jugar antes de
 * reseñarlo. Un item puede convertirse en reseña de un tirón, arrastrando los
 * datos que ya se conocen; la reseña nace como **borrador**, porque publicar
 * sigue siendo un acto explícito.
 */
export class WatchlistService {
  constructor(private readonly c: Container) {}

  async create(input: WatchlistInput, actor: SessionUser): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();

    /*
     * Si la obra ya está reseñada, el pendiente nace enlazado y terminado.
     *
     * No se rechaza el alta: quien lo escribe no tiene por qué acordarse de lo
     * que reseñó hace dos años, y un error que sólo dice «ya existe» obliga a
     * ir a buscarlo. Se guarda, se enlaza y desaparece de la cola, que es el
     * resultado que se quería. La lista pública no llega a verlo.
     */
    const yaResenada = await this.resenaDelMismoTitulo(input.titleEs, input.contentType);

    await this.c.watchlist.insert({
      id,
      titleEs: input.titleEs,
      titleOriginal: input.titleOriginal ?? null,
      contentType: input.contentType,
      categoryId: input.categoryId ?? null,
      year: input.year ?? null,
      creator: input.creator ?? null,
      note: input.note ?? null,
      sourceUrl: input.sourceUrl && input.sourceUrl.length ? input.sourceUrl : null,
      priority: input.priority,
      status: yaResenada ? 'DONE' : input.status,
      reviewId: yaResenada?.id ?? null,
      completedAt: yaResenada ? now : null,
      isPublic: input.isPublic ? 1 : 0,
      coverKey: input.coverKey ?? null,
      coverAlt: input.coverAlt ?? null,
      sortOrder: input.sortOrder,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    });

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'watchlist.create',
      entityType: 'watchlist',
      entityId: id,
      metadata: { titleEs: input.titleEs, priority: input.priority, isPublic: input.isPublic },
    });

    if (input.isPublic) await invalidateWatchlist(this.c.env);
    return id;
  }

  async update(id: string, input: WatchlistInput, actor: SessionUser): Promise<void> {
    const existing = await this.c.watchlist.getById(id);
    if (!existing) throw notFound('Ese pendiente no existe');

    await this.c.watchlist.update(id, {
      titleEs: input.titleEs,
      titleOriginal: input.titleOriginal ?? null,
      contentType: input.contentType,
      categoryId: input.categoryId ?? null,
      year: input.year ?? null,
      creator: input.creator ?? null,
      note: input.note ?? null,
      sourceUrl: input.sourceUrl && input.sourceUrl.length ? input.sourceUrl : null,
      priority: input.priority,
      status: input.status,
      isPublic: input.isPublic ? 1 : 0,
      coverKey: input.coverKey ?? null,
      coverAlt: input.coverAlt ?? null,
      sortOrder: input.sortOrder,
      updatedAt: Date.now(),
      completedAt: input.status === 'DONE' || input.status === 'DROPPED' ? (existing.completedAt ?? Date.now()) : null,
    });

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'watchlist.update',
      entityType: 'watchlist',
      entityId: id,
    });

    // Se invalida si era o pasa a ser público: en ambos casos cambia lo que se ve.
    if (existing.isPublic === 1 || input.isPublic) await invalidateWatchlist(this.c.env);
  }

  /** Acciones rápidas de la cola: no necesitan abrir el formulario completo. */
  async act(id: string, action: WatchlistAction, actor: SessionUser): Promise<{ redirectTo?: string }> {
    const item = await this.c.watchlist.getById(id);
    if (!item) throw notFound('Ese pendiente no existe');

    const now = Date.now();

    switch (action) {
      case 'start':
        await this.setStatus(id, 'IN_PROGRESS', null);
        break;
      case 'complete':
        await this.setStatus(id, 'DONE', now);
        break;
      case 'drop':
        await this.setStatus(id, 'DROPPED', now);
        break;
      case 'reopen':
        await this.setStatus(id, 'PENDING', null);
        break;
      case 'toggle-public':
        await this.c.watchlist.update(id, { isPublic: item.isPublic === 1 ? 0 : 1, updatedAt: now });
        break;
      case 'delete':
        await this.c.watchlist.remove(id);
        break;
      case 'convert':
        return { redirectTo: await this.convertToReview(item, actor) };
    }

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: action === 'delete' ? 'watchlist.delete' : 'watchlist.status',
      entityType: 'watchlist',
      entityId: id,
      metadata: { action },
    });

    await invalidateWatchlist(this.c.env);
    return {};
  }

  /**
   * Enlaza con su reseña el pendiente que trate de la misma obra.
   *
   * Se llama al crear una reseña. Sin esto, escribir la reseña «a mano» —sin
   * usar el botón de convertir— dejaba el pendiente en la cola conviviendo con
   * ella: la misma obra anunciada como «por ver» y publicada como reseña a la
   * vez, que es lo que no puede pasar.
   *
   * El pendiente no se borra: queda como terminado y apuntando a su reseña, que
   * es lo que permite saber de dónde salió y volver atrás si la reseña se
   * elimina.
   */
  async enlazarPendienteDe(
    reviewId: string,
    titleEs: string,
    contentType: ContentType,
    actor: SessionUser,
  ): Promise<string | null> {
    const candidatos = await this.c.watchlist.activosSinResena(contentType);
    const buscado = slugify(titleEs);
    const item = candidatos.find((c) => slugify(c.titleEs) === buscado);
    if (!item) return null;

    const now = Date.now();
    await this.c.watchlist.update(item.id, {
      status: 'DONE',
      reviewId,
      completedAt: now,
      updatedAt: now,
    });

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'watchlist.link',
      entityType: 'watchlist',
      entityId: item.id,
      metadata: { reviewId, titleEs: item.titleEs, automatico: true },
    });

    await invalidateWatchlist(this.c.env);
    return item.id;
  }

  /**
   * ¿Hay ya una reseña de esta obra? Se compara por título normalizado y tipo
   * de contenido, no por slug: el slug de una reseña puede llevar sufijo o
   * haberse editado a mano, y entonces dejaría de casar con su propio título.
   */
  private async resenaDelMismoTitulo(
    titleEs: string,
    contentType: ContentType,
  ): Promise<{ id: string } | null> {
    const buscado = slugify(titleEs);
    const vivas = await this.c.reviews.titulosVivos(contentType);
    return vivas.find((r) => slugify(r.titleEs) === buscado) ?? null;
  }

  private async setStatus(id: string, status: WatchlistStatus, completedAt: number | null): Promise<void> {
    await this.c.watchlist.update(id, { status, completedAt, updatedAt: Date.now() });
  }

  /**
   * Crea un borrador de reseña con los datos ya conocidos y enlaza ambos
   * registros. El pendiente queda como terminado: su trabajo ha acabado.
   */
  private async convertToReview(item: WatchlistRow, actor: SessionUser): Promise<string> {
    if (item.reviewId) throw conflict('already_converted', 'Ese pendiente ya tiene una reseña asociada');

    const reviewId = crypto.randomUUID();
    const now = Date.now();
    const slug = await uniqueSlug(item.titleEs, (candidate) => this.c.reviews.slugIsFree(candidate));

    // La nota del pendiente arranca el cuerpo de la reseña. Se escapa porque es
    // texto plano y el cuerpo de la reseña es HTML.
    const bodyHtml = item.note
      ? `<blockquote><p>${escapeHtml(item.note)}</p></blockquote><p></p>`
      : '<p></p>';

    await this.c.reviews.insert({
      id: reviewId,
      slug,
      titleEs: item.titleEs,
      titleOriginal: item.titleOriginal,
      otherTitles: null,
      contentType: item.contentType,
      categoryId: item.categoryId,
      year: item.year,
      creator: item.creator,
      country: null,
      durationMin: null,
      episodes: null,
      volumes: null,
      ratingHalf: 0,
      summary: null,
      bodyHtml,
      hasSpoilers: 0,
      // Nace como borrador: publicar es siempre un acto deliberado.
      status: 'DRAFT',
      commentsMode: 'INHERIT',
      coverKey: item.coverKey,
      coverAlt: item.coverAlt,
      seoTitle: null,
      seoDescription: null,
      publishedAt: null,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    });

    await this.c.watchlist.update(item.id, {
      status: 'DONE',
      reviewId,
      completedAt: now,
      updatedAt: now,
    });

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'watchlist.convert',
      entityType: 'watchlist',
      entityId: item.id,
      metadata: { reviewId, slug },
    });

    await invalidateWatchlist(this.c.env);
    return `/admin/resenas/${reviewId}`;
  }

  /** Añade de golpe varios títulos sueltos, uno por línea. */
  async createBatch(
    lines: string[],
    defaults: { contentType: WatchlistInput['contentType']; priority: WatchlistInput['priority']; isPublic: boolean },
    actor: SessionUser,
  ): Promise<number> {
    const titulos = lines
      .map((line) => line.trim())
      .filter((line) => line.length >= 2)
      .slice(0, 50);

    if (!titulos.length) throw badRequest('empty_batch', 'No hay títulos que añadir');

    const now = Date.now();
    for (const titleEs of titulos) {
      await this.c.watchlist.insert({
        id: crypto.randomUUID(),
        titleEs: titleEs.slice(0, 200),
        contentType: defaults.contentType,
        priority: defaults.priority,
        status: 'PENDING',
        isPublic: defaults.isPublic ? 1 : 0,
        sortOrder: 0,
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      });
    }

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'watchlist.create',
      entityType: 'watchlist',
      metadata: { batch: titulos.length },
    });

    if (defaults.isPublic) await invalidateWatchlist(this.c.env);
    return titulos.length;
  }
}
