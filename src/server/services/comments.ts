import type { Container } from './container';
import type { CommentInput, ReportInput } from '../../validation/schemas';
import type { SessionUser } from '../lib/auth';
import { pseudonymize, hmacHex } from '../lib/crypto';
import { badRequest, forbidden, notFound, conflict } from '../lib/http';
import { invalidatePublicContent } from '../lib/cache';
import type { CommentRow } from '../../db/repos/comments';
import type { CommentStatus } from '../../types/domain';

export interface CommentContext {
  ip: string | null;
  userAgent: string | null;
  user: SessionUser | null;
}

export interface CreateCommentResult {
  comment: CommentRow;
  /** true si queda a la espera de aprobación */
  pending: boolean;
}

export class CommentService {
  constructor(private readonly c: Container) {}

  /**
   * Publica un comentario aplicando la política configurada.
   * El cuerpo se guarda como **texto plano**; el HTML se genera al renderizar
   * (`renderCommentBody`), así que nunca se persiste markup del usuario.
   */
  async create(
    input: CommentInput,
    ctx: CommentContext,
    policy: 'OPEN' | 'AUTH' | 'CLOSED',
  ): Promise<CreateCommentResult> {
    if (policy === 'CLOSED') throw forbidden('Los comentarios están cerrados en esta reseña');
    if (policy === 'AUTH' && !ctx.user) throw forbidden('Debes iniciar sesión para comentar');

    const settings = await this.c.settings.all();
    const body = input.body.trim();
    if (body.length < settings['comments.min_length']) {
      throw badRequest('comment_too_short', 'El comentario es demasiado corto');
    }
    if (body.length > settings['comments.max_length']) {
      throw badRequest('comment_too_long', 'El comentario es demasiado largo');
    }

    const review = await this.c.reviews.getById(input.reviewId);
    if (!review) throw notFound('La reseña no existe o no está publicada');

    let parent: CommentRow | null = null;
    if (input.parentId) {
      parent = await this.c.comments.getById(input.parentId);
      if (!parent || parent.reviewId !== input.reviewId) {
        throw badRequest('invalid_parent', 'El comentario al que respondes no existe');
      }
      if (parent.isDeleted) throw badRequest('invalid_parent', 'No se puede responder a un comentario eliminado');
      if (parent.depth + 1 >= settings['comments.max_depth']) {
        throw badRequest('max_depth', 'No se pueden anidar más respuestas en este hilo');
      }
      // Sólo se responde a lo que es públicamente visible.
      if (parent.status !== 'APPROVED') throw badRequest('invalid_parent', 'Ese comentario no admite respuestas');
    }

    const status: CommentStatus = settings['comments.require_approval'] ? 'PENDING' : 'APPROVED';
    const [ipHash, uaHash] = await Promise.all([
      pseudonymize(ctx.ip, this.c.env.HASH_PEPPER),
      pseudonymize(ctx.userAgent, this.c.env.HASH_PEPPER),
    ]);

    const alias = ctx.user ? ctx.user.displayName : input.alias.trim().slice(0, settings['comments.alias_max_length']);

    const comment = await this.c.comments.create({
      reviewId: input.reviewId,
      parentId: parent?.id ?? null,
      parentPath: parent?.path ?? null,
      parentDepth: parent?.depth ?? null,
      userId: ctx.user?.id ?? null,
      authorAlias: alias,
      body,
      status,
      ipHash,
      uaHash,
    });

    await this.c.audit.record({
      actorId: ctx.user?.id ?? null,
      actorRole: ctx.user?.role ?? 'ANON',
      action: 'comment.create',
      entityType: 'comment',
      entityId: comment.id,
      metadata: { reviewId: input.reviewId, status, depth: comment.depth },
      ipHash,
    });

    if (status === 'APPROVED') {
      await this.c.reviews.refreshCommentCount(input.reviewId);
      await invalidatePublicContent(this.c.env);
    }

    return { comment, pending: status === 'PENDING' };
  }

  /**
   * Registra un reporte.
   *
   * Dos capas anti-duplicado:
   *   1. índice único (comment_id, reporter_hash) en D1 — durable;
   *   2. Durable Object por comentario — serializa la decisión de umbral para
   *      que dos reportes simultáneos no disparen la transición dos veces.
   */
  async report(
    input: ReportInput,
    ctx: { reporterId: string; ip: string | null; user: SessionUser | null },
  ): Promise<{ count: number; transitioned: boolean }> {
    const comment = await this.c.comments.getById(input.commentId);
    if (!comment) throw notFound('El comentario no existe');
    if (comment.isDeleted) throw badRequest('already_removed', 'Ese comentario ya no está visible');

    const settings = await this.c.settings.all();
    const pepper = this.c.env.HASH_PEPPER ?? 'dev-pepper-no-secret-configured';
    // Identidad del reportante: la sesión si la hay, y si no la cookie anónima.
    // La IP NO entra en el hash a propósito: combinarlas debilitaría la dedupe,
    // porque bastaría con cambiar de red para volver a reportar lo mismo. La IP
    // se usa donde corresponde, en el rate limiting del endpoint.
    const identity = ctx.user ? `u:${ctx.user.id}` : `r:${ctx.reporterId}`;
    const reporterHash = (await hmacHex(pepper, `${input.commentId}|${identity}`)).slice(0, 40);

    const inserted = await this.c.reports.insert({
      commentId: input.commentId,
      reporterHash,
      reason: input.reason,
      details: input.details ?? null,
    });
    if (!inserted.created) throw conflict('already_reported', 'Ya habías reportado este comentario');

    const stubId = this.c.env.MODERATION.idFromName(`comment:${input.commentId}`);
    const stub = this.c.env.MODERATION.get(stubId);
    const decision = await stub.report({
      reporterHash,
      seedCount: comment.reportCount,
      currentStatus: comment.status,
      threshold: settings['moderation.report_threshold'],
      autoHideThreshold: settings['moderation.auto_hide_threshold'],
    });

    await this.c.comments.setReportCount(input.commentId, decision.count);

    let transitioned = false;
    if (decision.nextStatus) {
      await this.c.comments.setStatus(input.commentId, decision.nextStatus, null);
      transitioned = true;
      await this.c.audit.record({
        actorId: null,
        actorRole: 'SYSTEM',
        action: 'report.threshold',
        entityType: 'comment',
        entityId: input.commentId,
        metadata: { count: decision.count, newStatus: decision.nextStatus },
      });
      // Sale de la vista pública: hay que invalidar caché.
      await this.c.reviews.refreshCommentCount(comment.reviewId);
      await invalidatePublicContent(this.c.env);
    }

    await this.c.audit.record({
      actorId: ctx.user?.id ?? null,
      actorRole: ctx.user?.role ?? 'ANON',
      action: 'report.create',
      entityType: 'comment',
      entityId: input.commentId,
      metadata: { reason: input.reason, count: decision.count },
    });

    return { count: decision.count, transitioned };
  }

  /** Acciones del panel de moderación. */
  async moderate(
    commentId: string,
    action: 'approve' | 'reject' | 'hide' | 'restore' | 'delete' | 'purge',
    actor: SessionUser,
  ): Promise<void> {
    const comment = await this.c.comments.getById(commentId);
    if (!comment) throw notFound('El comentario no existe');

    switch (action) {
      case 'approve':
        await this.c.comments.setStatus(commentId, 'APPROVED', actor.id);
        await this.c.reports.resolveForComment(commentId, actor.id, true);
        await this.clearModerationState(commentId);
        await this.c.comments.setReportCount(commentId, 0);
        break;
      case 'reject':
        await this.c.comments.setStatus(commentId, 'REJECTED', actor.id);
        await this.c.reports.resolveForComment(commentId, actor.id);
        break;
      case 'hide':
        await this.c.comments.setStatus(commentId, 'HIDDEN', actor.id);
        await this.c.reports.resolveForComment(commentId, actor.id);
        break;
      case 'restore':
        await this.c.comments.restore(commentId, actor.id);
        await this.c.reports.resolveForComment(commentId, actor.id, true);
        await this.clearModerationState(commentId);
        await this.c.comments.setReportCount(commentId, 0);
        break;
      case 'delete':
        // Borrado lógico: el nodo se conserva como tumba y el hilo no se rompe.
        await this.c.comments.softDelete(commentId, actor.id);
        await this.c.reports.resolveForComment(commentId, actor.id);
        break;
      case 'purge':
        await this.c.comments.purgeSubtree(commentId);
        await this.clearModerationState(commentId);
        break;
    }

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: action === 'delete' ? 'comment.delete' : action === 'restore' ? 'comment.restore' : action === 'purge' ? 'comment.purge' : 'comment.moderate',
      entityType: 'comment',
      entityId: commentId,
      metadata: { action, reviewId: comment.reviewId },
    });

    await this.c.reviews.refreshCommentCount(comment.reviewId);
    await invalidatePublicContent(this.c.env);
  }

  private async clearModerationState(commentId: string): Promise<void> {
    try {
      const stub = this.c.env.MODERATION.get(this.c.env.MODERATION.idFromName(`comment:${commentId}`));
      await stub.clear();
    } catch {
      /* no crítico: D1 sigue siendo la fuente durable */
    }
  }
}
