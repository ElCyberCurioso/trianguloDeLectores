import { and, asc, desc, eq, inArray, isNull, like, or, sql, count } from 'drizzle-orm';
import { getDb, type Db } from '../client';
import {
  reviews, reviewGenres, reviewPlatforms, categories, genres, platforms,
  type Review,
} from '../schema';
import type { Bindings } from '../../types/env';
import type { ReviewQuery } from '../../validation/schemas';
import type { Availability, ContentType, ReviewSort } from '../../types/domain';

export interface ReviewGenre { id: string; slug: string; name: string }

export interface ReviewPlatformView {
  id: string;
  platformId: string;
  name: string;
  slug: string;
  kind: string;
  color: string | null;
  url: string | null;
  availability: Availability;
  note: string | null;
}

export interface ReviewListItem {
  id: string;
  slug: string;
  titleEs: string;
  titleOriginal: string | null;
  contentType: ContentType;
  year: number | null;
  creator: string | null;
  rating: number;
  commentCount: number;
  publishedAt: number | null;
  updatedAt: number;
  coverKey: string | null;
  coverAlt: string | null;
  summary: string | null;
  hasSpoilers: number;
  status: Review['status'];
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  genres: ReviewGenre[];
}

export interface ReviewDetail extends ReviewListItem {
  otherTitles: string[];
  country: string | null;
  durationMin: number | null;
  episodes: number | null;
  volumes: number | null;
  bodyHtml: string;
  commentsMode: Review['commentsMode'];
  seoTitle: string | null;
  seoDescription: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  createdAt: number;
  platforms: ReviewPlatformView[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface PlatformLink {
  platformId: string;
  url: string | null;
  availability: Availability;
  note: string | null;
}

const listColumns = {
  id: reviews.id,
  slug: reviews.slug,
  titleEs: reviews.titleEs,
  titleOriginal: reviews.titleOriginal,
  contentType: reviews.contentType,
  year: reviews.year,
  creator: reviews.creator,
  rating: reviews.rating,
  commentCount: reviews.commentCount,
  publishedAt: reviews.publishedAt,
  updatedAt: reviews.updatedAt,
  coverKey: reviews.coverKey,
  coverAlt: reviews.coverAlt,
  summary: reviews.summary,
  hasSpoilers: reviews.hasSpoilers,
  status: reviews.status,
  categoryId: reviews.categoryId,
  categoryName: categories.name,
  categorySlug: categories.slug,
};

/** COALESCE(published_at, created_at): los borradores nunca pierden su orden. */
const publishedOrCreated = sql`COALESCE(${reviews.publishedAt}, ${reviews.createdAt})`;

function orderFor(sort: ReviewSort) {
  switch (sort) {
    case 'oldest':
      return [asc(publishedOrCreated)];
    case 'rating':
      return [desc(reviews.rating), desc(publishedOrCreated)];
    case 'comments':
      return [desc(reviews.commentCount), desc(publishedOrCreated)];
    case 'recent':
    default:
      return [desc(publishedOrCreated)];
  }
}

/** Carga los géneros de un lote de reseñas en una sola query (evita N+1). */
async function loadGenres(db: Db, reviewIds: string[]): Promise<Map<string, ReviewGenre[]>> {
  const map = new Map<string, ReviewGenre[]>();
  if (!reviewIds.length) return map;
  const rows = await db
    .select({
      reviewId: reviewGenres.reviewId,
      id: genres.id,
      slug: genres.slug,
      name: genres.name,
    })
    .from(reviewGenres)
    .innerJoin(genres, eq(genres.id, reviewGenres.genreId))
    .where(inArray(reviewGenres.reviewId, reviewIds))
    .orderBy(asc(genres.name))
    .all();
  for (const row of rows) {
    const list = map.get(row.reviewId) ?? [];
    list.push({ id: row.id, slug: row.slug, name: row.name });
    map.set(row.reviewId, list);
  }
  return map;
}

async function loadPlatforms(db: Db, reviewId: string): Promise<ReviewPlatformView[]> {
  const rows = await db
    .select({
      id: reviewPlatforms.id,
      platformId: reviewPlatforms.platformId,
      name: platforms.name,
      slug: platforms.slug,
      kind: platforms.kind,
      color: platforms.color,
      url: reviewPlatforms.url,
      availability: reviewPlatforms.availability,
      note: reviewPlatforms.note,
    })
    .from(reviewPlatforms)
    .innerJoin(platforms, eq(platforms.id, reviewPlatforms.platformId))
    .where(eq(reviewPlatforms.reviewId, reviewId))
    .orderBy(asc(reviewPlatforms.sortOrder), asc(platforms.name))
    .all();
  return rows;
}

function parseOtherTitles(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string').slice(0, 10)
      : [];
  } catch {
    return [];
  }
}

export class ReviewRepository {
  private readonly db: Db;

  constructor(env: Pick<Bindings, 'DB'>) {
    this.db = getDb(env);
  }

  async listPublished(query: ReviewQuery): Promise<Paginated<ReviewListItem>> {
    return this.list({ ...query, includeDrafts: false });
  }

  async list(
    query: ReviewQuery & { includeDrafts?: boolean; statusFilter?: 'DRAFT' | 'PUBLISHED' | 'ALL' },
  ): Promise<Paginated<ReviewListItem>> {
    const conditions = [isNull(reviews.deletedAt)];

    if (!query.includeDrafts) {
      conditions.push(eq(reviews.status, 'PUBLISHED'));
    } else if (query.statusFilter && query.statusFilter !== 'ALL') {
      conditions.push(eq(reviews.status, query.statusFilter));
    }

    if (query.type) conditions.push(eq(reviews.contentType, query.type));

    if (query.q) {
      // Drizzle parametriza el valor: el texto del usuario nunca se concatena
      // dentro del SQL. Se escapan además los comodines de LIKE.
      const needle = `%${query.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      const search = or(
        like(reviews.titleEs, needle),
        like(reviews.titleOriginal, needle),
        like(reviews.creator, needle),
        like(reviews.summary, needle),
        like(reviews.otherTitles, needle),
      );
      if (search) conditions.push(search);
    }

    if (query.category) {
      conditions.push(sql`${reviews.categoryId} IN (SELECT id FROM categories WHERE slug = ${query.category})`);
    }
    if (query.genre) {
      conditions.push(sql`${reviews.id} IN (
        SELECT rg.review_id FROM review_genres rg
        JOIN genres g ON g.id = rg.genre_id
        WHERE g.slug = ${query.genre}
      )`);
    }

    const where = and(...conditions);
    const perPage = query.perPage;
    const offset = (query.page - 1) * perPage;

    const [totalRow, rows] = await Promise.all([
      this.db.select({ value: count() }).from(reviews).where(where).get(),
      this.db
        .select(listColumns)
        .from(reviews)
        .leftJoin(categories, eq(categories.id, reviews.categoryId))
        .where(where)
        .orderBy(...orderFor(query.sort))
        .limit(perPage)
        .offset(offset)
        .all(),
    ]);

    const total = totalRow?.value ?? 0;
    const genreMap = await loadGenres(this.db, rows.map((r) => r.id));

    return {
      items: rows.map((r) => ({ ...r, genres: genreMap.get(r.id) ?? [] })),
      total,
      page: query.page,
      perPage,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  private async hydrate(
    row: Review & { categoryName: string | null; categorySlug: string | null },
  ): Promise<ReviewDetail> {
    const [genreMap, platformList] = await Promise.all([
      loadGenres(this.db, [row.id]),
      loadPlatforms(this.db, row.id),
    ]);
    return {
      id: row.id,
      slug: row.slug,
      titleEs: row.titleEs,
      titleOriginal: row.titleOriginal,
      otherTitles: parseOtherTitles(row.otherTitles),
      contentType: row.contentType,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      categorySlug: row.categorySlug,
      year: row.year,
      creator: row.creator,
      country: row.country,
      durationMin: row.durationMin,
      episodes: row.episodes,
      volumes: row.volumes,
      rating: row.rating,
      summary: row.summary,
      bodyHtml: row.bodyHtml,
      hasSpoilers: row.hasSpoilers,
      status: row.status,
      commentsMode: row.commentsMode,
      coverKey: row.coverKey,
      coverAlt: row.coverAlt,
      coverWidth: row.coverWidth,
      coverHeight: row.coverHeight,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      commentCount: row.commentCount,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      genres: genreMap.get(row.id) ?? [],
      platforms: platformList,
    };
  }

  private async findOne(
    condition: ReturnType<typeof eq>,
    includeDrafts: boolean,
  ): Promise<ReviewDetail | null> {
    const conditions = [condition, isNull(reviews.deletedAt)];
    if (!includeDrafts) conditions.push(eq(reviews.status, 'PUBLISHED'));
    const row = await this.db
      .select({ review: reviews, categoryName: categories.name, categorySlug: categories.slug })
      .from(reviews)
      .leftJoin(categories, eq(categories.id, reviews.categoryId))
      .where(and(...conditions))
      .get();
    if (!row) return null;
    return this.hydrate({ ...row.review, categoryName: row.categoryName, categorySlug: row.categorySlug });
  }

  getBySlug(slug: string, opts: { includeDrafts?: boolean } = {}): Promise<ReviewDetail | null> {
    return this.findOne(eq(reviews.slug, slug), opts.includeDrafts === true);
  }

  getById(id: string, opts: { includeDrafts?: boolean } = {}): Promise<ReviewDetail | null> {
    return this.findOne(eq(reviews.id, id), opts.includeDrafts === true);
  }

  async slugIsFree(slug: string, exceptId?: string): Promise<boolean> {
    const row = await this.db.select({ id: reviews.id }).from(reviews).where(eq(reviews.slug, slug)).get();
    return !row || row.id === exceptId;
  }

  async insert(values: typeof reviews.$inferInsert): Promise<void> {
    await this.db.insert(reviews).values(values);
  }

  async update(id: string, values: Partial<typeof reviews.$inferInsert>): Promise<void> {
    await this.db.update(reviews).set(values).where(eq(reviews.id, id));
  }

  async setGenres(reviewId: string, genreIds: string[]): Promise<void> {
    await this.db.delete(reviewGenres).where(eq(reviewGenres.reviewId, reviewId));
    const unique = [...new Set(genreIds)];
    if (!unique.length) return;
    await this.db.insert(reviewGenres).values(unique.map((genreId) => ({ reviewId, genreId })));
  }

  async setPlatforms(reviewId: string, entries: PlatformLink[]): Promise<void> {
    await this.db.delete(reviewPlatforms).where(eq(reviewPlatforms.reviewId, reviewId));
    if (!entries.length) return;
    const now = Date.now();
    const seen = new Set<string>();
    const values: (typeof reviewPlatforms.$inferInsert)[] = [];
    for (const entry of entries) {
      const key = `${entry.platformId}:${entry.availability}`;
      if (seen.has(key)) continue;
      seen.add(key);
      values.push({
        id: crypto.randomUUID(),
        reviewId,
        platformId: entry.platformId,
        url: entry.url,
        availability: entry.availability,
        note: entry.note,
        sortOrder: values.length,
        createdAt: now,
      });
    }
    if (values.length) await this.db.insert(reviewPlatforms).values(values);
  }

  /** Borrado lógico: preserva comentarios y auditoría. */
  async softDelete(id: string): Promise<void> {
    const now = Date.now();
    await this.db
      .update(reviews)
      .set({ deletedAt: now, status: 'DRAFT', updatedAt: now })
      .where(eq(reviews.id, id));
  }

  async restore(id: string): Promise<void> {
    await this.db.update(reviews).set({ deletedAt: null, updatedAt: Date.now() }).where(eq(reviews.id, id));
  }

  /** Recalcula el contador de comentarios aprobados: idempotente y autoreparable. */
  async refreshCommentCount(reviewId: string): Promise<void> {
    await this.db.run(sql`
      UPDATE reviews
      SET comment_count = (
        SELECT COUNT(*) FROM comments
        WHERE comments.review_id = ${reviewId}
          AND comments.status = 'APPROVED'
          AND comments.is_deleted = 0
      )
      WHERE reviews.id = ${reviewId}
    `);
  }

  /** URLs publicadas para el sitemap. */
  allPublishedForSitemap(limit = 5000) {
    return this.db
      .select({ slug: reviews.slug, updatedAt: reviews.updatedAt, publishedAt: reviews.publishedAt })
      .from(reviews)
      .where(and(eq(reviews.status, 'PUBLISHED'), isNull(reviews.deletedAt)))
      .orderBy(desc(reviews.updatedAt))
      .limit(limit)
      .all();
  }

  /** ¿Alguna reseña sigue usando esta portada? (evita borrar R2 en uso) */
  async coverUsageCount(key: string): Promise<number> {
    const row = await this.db
      .select({ value: count() })
      .from(reviews)
      .where(eq(reviews.coverKey, key))
      .get();
    return row?.value ?? 0;
  }
}
