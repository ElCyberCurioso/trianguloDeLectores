import { and, eq, isNull, count, desc } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { reviews, users } from '../../db/schema';
import type { Container } from './container';

export interface DashboardStats {
  reviewsTotal: number;
  reviewsPublished: number;
  reviewsDrafts: number;
  commentsTotal: number;
  commentsPending: number;
  commentsReported: number;
  reportsOpen: number;
  usersTotal: number;
}

export interface DashboardData extends DashboardStats {
  recentReviews: Array<{
    id: string; slug: string; titleEs: string; status: string;
    updatedAt: number; commentCount: number;
  }>;
  recentReports: Awaited<ReturnType<Container['reports']['recent']>>;
  recentAudit: Awaited<ReturnType<Container['audit']['recent']>>;
}

export class StatsService {
  constructor(private readonly c: Container) {}

  async counters(): Promise<DashboardStats> {
    const db = getDb(this.c.env);
    const notDeleted = isNull(reviews.deletedAt);

    const [total, published, commentsTotal, pending, reported, reportsOpen, usersTotal] = await Promise.all([
      db.select({ value: count() }).from(reviews).where(notDeleted).get(),
      db.select({ value: count() }).from(reviews).where(and(notDeleted, eq(reviews.status, 'PUBLISHED'))).get(),
      this.c.comments.countAll(),
      this.c.comments.countByStatus('PENDING'),
      this.c.comments.countByStatus('REPORTED'),
      this.c.reports.countOpen(),
      db.select({ value: count() }).from(users).get(),
    ]);

    const reviewsTotal = total?.value ?? 0;
    const reviewsPublished = published?.value ?? 0;

    return {
      reviewsTotal,
      reviewsPublished,
      reviewsDrafts: Math.max(0, reviewsTotal - reviewsPublished),
      commentsTotal,
      commentsPending: pending,
      commentsReported: reported,
      reportsOpen,
      usersTotal: usersTotal?.value ?? 0,
    };
  }

  async dashboard(): Promise<DashboardData> {
    const db = getDb(this.c.env);
    const [counters, recentReviews, recentReports, recentAudit] = await Promise.all([
      this.counters(),
      db
        .select({
          id: reviews.id,
          slug: reviews.slug,
          titleEs: reviews.titleEs,
          status: reviews.status,
          updatedAt: reviews.updatedAt,
          commentCount: reviews.commentCount,
        })
        .from(reviews)
        .where(isNull(reviews.deletedAt))
        .orderBy(desc(reviews.updatedAt))
        .limit(8)
        .all(),
      this.c.reports.recent(8),
      this.c.audit.recent(12),
    ]);
    return { ...counters, recentReviews, recentReports, recentAudit };
  }

  /**
   * Contador de pendientes con caché corta en KV: el badge del panel se pinta
   * en cada página del admin y no necesita precisión al segundo.
   */
  async pendingBadge(): Promise<number> {
    const cached = await this.c.env.CACHE.get('stats:pending').catch(() => null);
    if (cached !== null) {
      const parsed = Number(cached);
      if (Number.isFinite(parsed)) return parsed;
    }
    const value = await this.c.comments.countByStatus('PENDING');
    await this.c.env.CACHE.put('stats:pending', String(value), { expirationTtl: 30 }).catch(() => undefined);
    return value;
  }
}
