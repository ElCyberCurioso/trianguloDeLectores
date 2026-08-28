import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb, type Db } from '../client';
import { recommendations } from '../schema';
import type { Bindings } from '../../types/env';
import type {
  ContentType, RecommendationResolution, RecommendationStatus,
} from '../../types/domain';
import type { RecommendationQueryInput } from '../../validation/schemas';

export interface RecommendationRow {
  id: string;
  titleEs: string;
  contentType: ContentType;
  creator: string | null;
  year: number | null;
  note: string;
  sourceUrl: string | null;
  alias: string | null;
  status: RecommendationStatus;
  resolution: RecommendationResolution | null;
  reviewId: string | null;
  watchlistId: string | null;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

export interface RecommendationCounters {
  pending: number;
  accepted: number;
  rejected: number;
}

/**
 * Bandeja de recomendaciones del público.
 *
 * Ninguna consulta expone `ip_hash` ni `ua_hash`: existen sólo para el control
 * antiabuso del servicio, y no salen de aquí.
 */
export class RecommendationRepository {
  private readonly db: Db;

  constructor(env: Pick<Bindings, 'DB'>) {
    this.db = getDb(env);
  }

  private static readonly columns = {
    id: recommendations.id,
    titleEs: recommendations.titleEs,
    contentType: recommendations.contentType,
    creator: recommendations.creator,
    year: recommendations.year,
    note: recommendations.note,
    sourceUrl: recommendations.sourceUrl,
    alias: recommendations.alias,
    status: recommendations.status,
    resolution: recommendations.resolution,
    reviewId: recommendations.reviewId,
    watchlistId: recommendations.watchlistId,
    createdAt: recommendations.createdAt,
    updatedAt: recommendations.updatedAt,
    resolvedAt: recommendations.resolvedAt,
  };

  async list(query: RecommendationQueryInput): Promise<{ items: RecommendationRow[]; total: number; totalPages: number }> {
    const where = query.status === 'ALL' ? undefined : eq(recommendations.status, query.status);
    const [totalRow, rows] = await Promise.all([
      this.db.select({ value: count() }).from(recommendations).where(where).get(),
      this.db
        .select(RecommendationRepository.columns)
        .from(recommendations)
        .where(where)
        .orderBy(desc(recommendations.createdAt))
        .limit(query.perPage)
        .offset((query.page - 1) * query.perPage)
        .all(),
    ]);
    const total = totalRow?.value ?? 0;
    return { items: rows as RecommendationRow[], total, totalPages: Math.max(1, Math.ceil(total / query.perPage)) };
  }

  async getById(id: string): Promise<RecommendationRow | null> {
    const row = await this.db
      .select(RecommendationRepository.columns)
      .from(recommendations)
      .where(eq(recommendations.id, id))
      .get();
    return (row as RecommendationRow | undefined) ?? null;
  }

  async insert(values: typeof recommendations.$inferInsert): Promise<void> {
    await this.db.insert(recommendations).values(values).run();
  }

  async update(id: string, values: Partial<typeof recommendations.$inferInsert>): Promise<void> {
    await this.db.update(recommendations).set(values).where(eq(recommendations.id, id)).run();
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(recommendations).where(eq(recommendations.id, id)).run();
  }

  async counters(): Promise<RecommendationCounters> {
    const rows = await this.db
      .select({ status: recommendations.status, total: count() })
      .from(recommendations)
      .groupBy(recommendations.status)
      .all();
    const por = new Map(rows.map((r) => [r.status, r.total]));
    return {
      pending: por.get('PENDING') ?? 0,
      accepted: por.get('ACCEPTED') ?? 0,
      rejected: por.get('REJECTED') ?? 0,
    };
  }

  /**
   * Cuántas ha mandado la misma procedencia desde un momento dado. El límite por
   * IP lo aplica el Durable Object; esto cierra el caso de quien rota de IP pero
   * repite navegador, y se apoya en el índice `idx_recommendations_origen`.
   */
  async countFrom(ipHash: string | null, desde: number): Promise<number> {
    if (!ipHash) return 0;
    const row = await this.db
      .select({ value: count() })
      .from(recommendations)
      .where(and(eq(recommendations.ipHash, ipHash), gte(recommendations.createdAt, desde)))
      .get();
    return row?.value ?? 0;
  }

  /** ¿Ya hay una propuesta igual sin revisar? Evita duplicados del mismo título. */
  async pendingWithTitle(titleEs: string): Promise<boolean> {
    const row = await this.db
      .select({ value: count() })
      .from(recommendations)
      .where(and(eq(recommendations.status, 'PENDING'), sql`lower(${recommendations.titleEs}) = lower(${titleEs})`))
      .get();
    return (row?.value ?? 0) > 0;
  }
}
