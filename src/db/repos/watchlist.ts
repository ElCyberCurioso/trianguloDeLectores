import { and, asc, desc, eq, inArray, like, or, sql, count } from 'drizzle-orm';
import { getDb, type Db } from '../client';
import { watchlistItems, categories, reviews } from '../schema';
import type { Bindings } from '../../types/env';
import type { ContentType, Priority, WatchlistSort, WatchlistStatus } from '../../types/domain';

export interface WatchlistRow {
  id: string;
  titleEs: string;
  titleOriginal: string | null;
  contentType: ContentType;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  year: number | null;
  creator: string | null;
  note: string | null;
  sourceUrl: string | null;
  priority: Priority;
  status: WatchlistStatus;
  isPublic: number;
  coverKey: string | null;
  coverAlt: string | null;
  sortOrder: number;
  reviewId: string | null;
  reviewSlug: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface WatchlistQuery {
  status?: WatchlistStatus | 'ALL' | 'ACTIVE';
  type?: ContentType;
  priority?: Priority;
  q?: string;
  sort?: WatchlistSort;
  onlyPublic?: boolean;
  page?: number;
  perPage?: number;
}

export interface WatchlistCounters {
  pending: number;
  inProgress: number;
  done: number;
  dropped: number;
  /** pendientes + en curso: la cola real */
  active: number;
}

const columns = {
  id: watchlistItems.id,
  titleEs: watchlistItems.titleEs,
  titleOriginal: watchlistItems.titleOriginal,
  contentType: watchlistItems.contentType,
  categoryId: watchlistItems.categoryId,
  categoryName: categories.name,
  categorySlug: categories.slug,
  year: watchlistItems.year,
  creator: watchlistItems.creator,
  note: watchlistItems.note,
  sourceUrl: watchlistItems.sourceUrl,
  priority: watchlistItems.priority,
  status: watchlistItems.status,
  isPublic: watchlistItems.isPublic,
  coverKey: watchlistItems.coverKey,
  coverAlt: watchlistItems.coverAlt,
  sortOrder: watchlistItems.sortOrder,
  reviewId: watchlistItems.reviewId,
  reviewSlug: reviews.slug,
  createdAt: watchlistItems.createdAt,
  updatedAt: watchlistItems.updatedAt,
  completedAt: watchlistItems.completedAt,
};

/**
 * La prioridad se guarda como texto legible, pero ordenarla alfabéticamente
 * daría HIGH < LOW < MEDIUM. Se traduce a peso numérico en el ORDER BY.
 */
const priorityWeight = sql`CASE ${watchlistItems.priority}
  WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END`;

function orderFor(sort: WatchlistSort) {
  switch (sort) {
    case 'recent':
      return [desc(watchlistItems.createdAt)];
    case 'oldest':
      return [asc(watchlistItems.createdAt)];
    case 'title':
      return [asc(watchlistItems.titleEs)];
    case 'priority':
    default:
      return [asc(priorityWeight), asc(watchlistItems.sortOrder), desc(watchlistItems.createdAt)];
  }
}

export class WatchlistRepository {
  private readonly db: Db;

  constructor(env: Pick<Bindings, 'DB'>) {
    this.db = getDb(env);
  }

  async list(query: WatchlistQuery = {}): Promise<{ items: WatchlistRow[]; total: number; totalPages: number; page: number }> {
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.min(100, Math.max(1, query.perPage ?? 50));
    const conditions = [];

    if (query.onlyPublic) conditions.push(eq(watchlistItems.isPublic, 1));

    const status = query.status ?? 'ACTIVE';
    if (status === 'ACTIVE') {
      conditions.push(inArray(watchlistItems.status, ['PENDING', 'IN_PROGRESS']));
    } else if (status !== 'ALL') {
      conditions.push(eq(watchlistItems.status, status));
    }

    if (query.type) conditions.push(eq(watchlistItems.contentType, query.type));
    if (query.priority) conditions.push(eq(watchlistItems.priority, query.priority));

    if (query.q) {
      // Parametrizado por Drizzle; se escapan además los comodines de LIKE.
      const needle = `%${query.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      const search = or(
        like(watchlistItems.titleEs, needle),
        like(watchlistItems.titleOriginal, needle),
        like(watchlistItems.creator, needle),
        like(watchlistItems.note, needle),
      );
      if (search) conditions.push(search);
    }

    const where = conditions.length ? and(...conditions) : undefined;

    const [totalRow, rows] = await Promise.all([
      this.db.select({ value: count() }).from(watchlistItems).where(where).get(),
      this.db
        .select(columns)
        .from(watchlistItems)
        .leftJoin(categories, eq(categories.id, watchlistItems.categoryId))
        .leftJoin(reviews, eq(reviews.id, watchlistItems.reviewId))
        .where(where)
        .orderBy(...orderFor(query.sort ?? 'priority'))
        .limit(perPage)
        .offset((page - 1) * perPage)
        .all(),
    ]);

    const total = totalRow?.value ?? 0;
    return { items: rows, total, page, totalPages: Math.max(1, Math.ceil(total / perPage)) };
  }

  async getById(id: string): Promise<WatchlistRow | null> {
    const row = await this.db
      .select(columns)
      .from(watchlistItems)
      .leftJoin(categories, eq(categories.id, watchlistItems.categoryId))
      .leftJoin(reviews, eq(reviews.id, watchlistItems.reviewId))
      .where(eq(watchlistItems.id, id))
      .get();
    return row ?? null;
  }

  async insert(values: typeof watchlistItems.$inferInsert): Promise<void> {
    await this.db.insert(watchlistItems).values(values);
  }

  async update(id: string, values: Partial<typeof watchlistItems.$inferInsert>): Promise<void> {
    await this.db.update(watchlistItems).set(values).where(eq(watchlistItems.id, id));
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(watchlistItems).where(eq(watchlistItems.id, id));
  }

  async counters(): Promise<WatchlistCounters> {
    const rows = await this.db
      .select({ status: watchlistItems.status, total: count() })
      .from(watchlistItems)
      .groupBy(watchlistItems.status)
      .all();

    const byStatus = new Map(rows.map((r) => [r.status, r.total]));
    const pending = byStatus.get('PENDING') ?? 0;
    const inProgress = byStatus.get('IN_PROGRESS') ?? 0;

    return {
      pending,
      inProgress,
      done: byStatus.get('DONE') ?? 0,
      dropped: byStatus.get('DROPPED') ?? 0,
      active: pending + inProgress,
    };
  }

  /** ¿Alguna entrada sigue usando esta portada? (evita borrar de R2 algo en uso) */
  async coverUsageCount(key: string): Promise<number> {
    const row = await this.db
      .select({ value: count() })
      .from(watchlistItems)
      .where(eq(watchlistItems.coverKey, key))
      .get();
    return row?.value ?? 0;
  }

  /** Tipos de contenido presentes en la lista pública (filtros dinámicos). */
  async publicTypes(): Promise<Array<{ type: ContentType; total: number }>> {
    const rows = await this.db
      .select({ type: watchlistItems.contentType, total: count() })
      .from(watchlistItems)
      .where(
        and(eq(watchlistItems.isPublic, 1), inArray(watchlistItems.status, ['PENDING', 'IN_PROGRESS'])),
      )
      .groupBy(watchlistItems.contentType)
      .all();
    return rows;
  }
}
