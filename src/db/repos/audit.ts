import { desc, eq, and, lt } from 'drizzle-orm';
import { getDb, type Db } from '../client';
import { auditLog, users } from '../schema';
import type { Bindings } from '../../types/env';

export type AuditAction =
  | 'auth.login.success' | 'auth.login.failure' | 'auth.logout' | 'auth.locked'
  | 'review.create' | 'review.update' | 'review.publish' | 'review.unpublish'
  | 'review.delete' | 'review.restore' | 'review.duplicate'
  | 'comment.create' | 'comment.moderate' | 'comment.delete' | 'comment.restore' | 'comment.purge'
  | 'report.create' | 'report.threshold'
  | 'watchlist.create' | 'watchlist.update' | 'watchlist.status' | 'watchlist.delete' | 'watchlist.convert'
  | 'recommendation.status' | 'recommendation.delete'
  | 'recommendation.to_review' | 'recommendation.to_watchlist'
  | 'media.upload' | 'media.delete'
  | 'document.upload' | 'document.update' | 'document.delete'
  | 'library.create' | 'library.update' | 'library.delete'
  | 'library.backup'
  | 'taxonomy.create' | 'taxonomy.update' | 'taxonomy.delete'
  | 'settings.update';

export class AuditRepository {
  private readonly db: Db;

  constructor(env: Pick<Bindings, 'DB'>) {
    this.db = getDb(env);
  }

  /**
   * Registra una acción. `metadata` NUNCA debe contener secretos, contraseñas,
   * tokens ni IP en claro (usar el hash pseudonimizado).
   */
  async record(entry: {
    actorId: string | null;
    actorRole: string | null;
    action: AuditAction;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
    ipHash?: string | null;
  }): Promise<void> {
    await this.db.insert(auditLog).values({
      id: crypto.randomUUID(),
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ? JSON.stringify(entry.metadata).slice(0, 4000) : null,
      ipHash: entry.ipHash ?? null,
      createdAt: Date.now(),
    });
  }

  recent(limit = 25) {
    return this.db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
        actorName: users.displayName,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .all();
  }

  /** Retención limitada (GDPR): borra entradas más antiguas que N días. */
  async purgeOlderThan(days: number): Promise<void> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    await this.db.delete(auditLog).where(and(lt(auditLog.createdAt, cutoff)));
  }
}
