import { and, asc, desc, eq, inArray, like, or, sql, count, ne } from 'drizzle-orm';
import { getDb, type Db } from '../client';
import { comments, commentReports, reviews, users } from '../schema';
import type { Bindings } from '../../types/env';
import type { CommentStatus, ReportReason } from '../../types/domain';

/**
 * Árbol de comentarios con **materialized path**.
 *
 * Cada nodo guarda `path = <seg padre>/<seg propio>/`, donde el segmento es
 * `<timestamp base36><8 hex del id>`. Consecuencias:
 *   - ordenar por `path` da directamente recorrido en profundidad y cronológico;
 *   - el subárbol de un nodo es `path LIKE '<su path>%'`, que **usa el índice**
 *     (idx_comments_thread) porque el comodín no va delante;
 *   - no hace falta CTE recursivo, que en D1 penalizaría cada lectura pública.
 */

export interface CommentRow {
  id: string;
  reviewId: string;
  parentId: string | null;
  path: string;
  depth: number;
  userId: string | null;
  authorAlias: string;
  body: string;
  status: CommentStatus;
  reportCount: number;
  isDeleted: number;
  replyCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CommentNode extends CommentRow {
  children: CommentNode[];
}

export interface AdminCommentRow extends CommentRow {
  reviewTitle: string | null;
  reviewSlug: string | null;
  moderatorName: string | null;
}

const PUBLIC_COLUMNS = {
  id: comments.id,
  reviewId: comments.reviewId,
  parentId: comments.parentId,
  path: comments.path,
  depth: comments.depth,
  userId: comments.userId,
  authorAlias: comments.authorAlias,
  body: comments.body,
  status: comments.status,
  reportCount: comments.reportCount,
  isDeleted: comments.isDeleted,
  replyCount: comments.replyCount,
  createdAt: comments.createdAt,
  updatedAt: comments.updatedAt,
};

export function buildSegment(id: string, createdAt: number): string {
  return `${createdAt.toString(36).padStart(9, '0')}${id.replace(/-/g, '').slice(0, 8)}`;
}

/** Reconstruye el árbol a partir de filas ya ordenadas por `path`. */
export function buildTree(rows: CommentRow[]): CommentNode[] {
  const byId = new Map<string, CommentNode>();
  const roots: CommentNode[] = [];
  for (const row of rows) byId.set(row.id, { ...row, children: [] });
  for (const row of rows) {
    const node = byId.get(row.id)!;
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export class CommentRepository {
  private readonly db: Db;

  constructor(env: Pick<Bindings, 'DB'>) {
    this.db = getDb(env);
  }

  /**
   * Hilo público de una reseña, paginado **por comentarios raíz**: se traen N
   * raíces y luego todos sus descendientes visibles.
   */
  async listThread(
    reviewId: string,
    opts: { page?: number; rootsPerPage?: number; includeModerationStates?: boolean } = {},
  ): Promise<{ nodes: CommentNode[]; totalRoots: number; page: number; totalPages: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const rootsPerPage = Math.min(50, Math.max(1, opts.rootsPerPage ?? 20));

    // Un comentario borrado sigue visible como tumba si tiene respuestas, para
    // no romper el hilo (ver `is_deleted`).
    const visible = opts.includeModerationStates
      ? undefined
      : or(eq(comments.status, 'APPROVED'), and(eq(comments.isDeleted, 1), sql`${comments.replyCount} > 0`));

    const rootWhere = and(eq(comments.reviewId, reviewId), eq(comments.depth, 0), ...(visible ? [visible] : []));

    const [totalRow, rootRows] = await Promise.all([
      this.db.select({ value: count() }).from(comments).where(rootWhere).get(),
      this.db
        .select({ path: comments.path })
        .from(comments)
        .where(rootWhere)
        .orderBy(asc(comments.path))
        .limit(rootsPerPage)
        .offset((page - 1) * rootsPerPage)
        .all(),
    ]);

    const totalRoots = totalRow?.value ?? 0;
    if (!rootRows.length) return { nodes: [], totalRoots, page, totalPages: Math.max(1, Math.ceil(totalRoots / rootsPerPage)) };

    // Prefijo de path: usa el índice (comodín sólo al final).
    const prefixes = rootRows.map((r) => like(comments.path, `${r.path}%`));
    const subtreeFilter = prefixes.length === 1 ? prefixes[0]! : or(...prefixes)!;

    const rows = await this.db
      .select(PUBLIC_COLUMNS)
      .from(comments)
      .where(and(eq(comments.reviewId, reviewId), subtreeFilter, ...(visible ? [visible] : [])))
      .orderBy(asc(comments.path))
      .limit(2000)
      .all();

    return {
      nodes: buildTree(rows),
      totalRoots,
      page,
      totalPages: Math.max(1, Math.ceil(totalRoots / rootsPerPage)),
    };
  }

  async getById(id: string): Promise<CommentRow | null> {
    const row = await this.db.select(PUBLIC_COLUMNS).from(comments).where(eq(comments.id, id)).get();
    return row ?? null;
  }

  /** Inserta un comentario calculando path y depth a partir del padre. */
  async create(input: {
    reviewId: string;
    parentId: string | null;
    parentPath: string | null;
    parentDepth: number | null;
    userId: string | null;
    authorAlias: string;
    body: string;
    status: CommentStatus;
    ipHash: string | null;
    uaHash: string | null;
  }): Promise<CommentRow> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const segment = buildSegment(id, now);
    const path = input.parentPath ? `${input.parentPath}${segment}/` : `${segment}/`;
    const depth = input.parentPath ? (input.parentDepth ?? 0) + 1 : 0;

    const values = {
      id,
      reviewId: input.reviewId,
      parentId: input.parentId,
      path,
      depth,
      userId: input.userId,
      authorAlias: input.authorAlias,
      body: input.body,
      status: input.status,
      reportCount: 0,
      isDeleted: 0,
      replyCount: 0,
      ipHash: input.ipHash,
      uaHash: input.uaHash,
      createdAt: now,
      updatedAt: now,
    } satisfies typeof comments.$inferInsert;

    await this.db.insert(comments).values(values);
    if (input.parentId) {
      await this.db
        .update(comments)
        .set({ replyCount: sql`${comments.replyCount} + 1` })
        .where(eq(comments.id, input.parentId));
    }
    return values;
  }

  async setStatus(id: string, status: CommentStatus, moderatorId: string | null): Promise<void> {
    await this.db
      .update(comments)
      .set({ status, moderatedBy: moderatorId, moderatedAt: Date.now(), updatedAt: Date.now() })
      .where(eq(comments.id, id));
  }

  /** Borrado lógico: el nodo permanece como "comentario eliminado". */
  async softDelete(id: string, moderatorId: string | null): Promise<void> {
    const now = Date.now();
    await this.db
      .update(comments)
      .set({ isDeleted: 1, body: '', status: 'HIDDEN', moderatedBy: moderatorId, moderatedAt: now, updatedAt: now })
      .where(eq(comments.id, id));
  }

  async restore(id: string, moderatorId: string | null): Promise<void> {
    const now = Date.now();
    await this.db
      .update(comments)
      .set({ isDeleted: 0, status: 'APPROVED', moderatedBy: moderatorId, moderatedAt: now, updatedAt: now })
      .where(eq(comments.id, id));
  }

  /** Borrado físico del subárbol completo. Sólo bajo petición explícita (GDPR). */
  async purgeSubtree(id: string): Promise<number> {
    const target = await this.db
      .select({ path: comments.path, parentId: comments.parentId })
      .from(comments)
      .where(eq(comments.id, id))
      .get();
    if (!target) return 0;
    const victims = await this.db
      .select({ id: comments.id })
      .from(comments)
      .where(like(comments.path, `${target.path}%`))
      .all();
    const ids = victims.map((v) => v.id);
    if (ids.length) await this.db.delete(comments).where(inArray(comments.id, ids));
    if (target.parentId) {
      await this.db
        .update(comments)
        .set({ replyCount: sql`MAX(0, ${comments.replyCount} - 1)` })
        .where(eq(comments.id, target.parentId));
    }
    return ids.length;
  }

  async setReportCount(id: string, value: number): Promise<void> {
    await this.db.update(comments).set({ reportCount: value, updatedAt: Date.now() }).where(eq(comments.id, id));
  }

  // ------------------------------------------------------------ moderación --

  async adminList(query: {
    status: CommentStatus | 'ALL';
    reviewId?: string;
    q?: string;
    page: number;
    perPage: number;
  }): Promise<{ items: AdminCommentRow[]; total: number; totalPages: number }> {
    const conditions = [];
    if (query.status !== 'ALL') conditions.push(eq(comments.status, query.status));
    if (query.reviewId) conditions.push(eq(comments.reviewId, query.reviewId));
    if (query.q) {
      const needle = `%${query.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      const search = or(like(comments.body, needle), like(comments.authorAlias, needle));
      if (search) conditions.push(search);
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [totalRow, rows] = await Promise.all([
      this.db.select({ value: count() }).from(comments).where(where).get(),
      this.db
        .select({
          ...PUBLIC_COLUMNS,
          reviewTitle: reviews.titleEs,
          reviewSlug: reviews.slug,
          moderatorName: users.displayName,
        })
        .from(comments)
        .leftJoin(reviews, eq(reviews.id, comments.reviewId))
        .leftJoin(users, eq(users.id, comments.moderatedBy))
        .where(where)
        .orderBy(desc(comments.reportCount), desc(comments.createdAt))
        .limit(query.perPage)
        .offset((query.page - 1) * query.perPage)
        .all(),
    ]);

    const total = totalRow?.value ?? 0;
    return { items: rows, total, totalPages: Math.max(1, Math.ceil(total / query.perPage)) };
  }

  async countByStatus(status: CommentStatus): Promise<number> {
    const row = await this.db.select({ value: count() }).from(comments).where(eq(comments.status, status)).get();
    return row?.value ?? 0;
  }

  async countAll(): Promise<number> {
    const row = await this.db.select({ value: count() }).from(comments).where(ne(comments.isDeleted, 1)).get();
    return row?.value ?? 0;
  }

  /** Cuántos comentarios de esta persona hay pendientes (anti-flood suave). */
  async countRecentByIpHash(ipHash: string, sinceMs: number): Promise<number> {
    const row = await this.db
      .select({ value: count() })
      .from(comments)
      .where(and(eq(comments.ipHash, ipHash), sql`${comments.createdAt} > ${sinceMs}`))
      .get();
    return row?.value ?? 0;
  }
}

// --------------------------------------------------------------- reportes --

export interface ReportRow {
  id: string;
  commentId: string;
  reason: ReportReason;
  details: string | null;
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED';
  createdAt: number;
  commentBody: string | null;
  commentStatus: CommentStatus | null;
  reviewSlug: string | null;
  reviewTitle: string | null;
}

export class ReportRepository {
  private readonly db: Db;

  constructor(env: Pick<Bindings, 'DB'>) {
    this.db = getDb(env);
  }

  /**
   * Inserta un reporte. El índice único (comment_id, reporter_hash) sigue siendo
   * la autoridad final anti-duplicado, pero no se detecta leyendo el texto de la
   * excepción: eso dependía del formato de error del driver y se rompió al
   * actualizar el ORM. Con `ON CONFLICT DO NOTHING` la escritura no lanza, y
   * después se comprueba qué fila quedó: si es la nuestra, la creamos nosotros.
   */
  async insert(input: {
    commentId: string;
    reporterHash: string;
    reason: ReportReason;
    details: string | null;
  }): Promise<{ created: boolean }> {
    const id = crypto.randomUUID();

    await this.db
      .insert(commentReports)
      .values({
        id,
        commentId: input.commentId,
        reporterHash: input.reporterHash,
        reason: input.reason,
        details: input.details,
        status: 'OPEN',
        createdAt: Date.now(),
      })
      .onConflictDoNothing();

    const fila = await this.db
      .select({ id: commentReports.id })
      .from(commentReports)
      .where(
        and(
          eq(commentReports.commentId, input.commentId),
          eq(commentReports.reporterHash, input.reporterHash),
        ),
      )
      .get();

    return { created: fila?.id === id };
  }

  async countForComment(commentId: string): Promise<number> {
    const row = await this.db
      .select({ value: count() })
      .from(commentReports)
      .where(eq(commentReports.commentId, commentId))
      .get();
    return row?.value ?? 0;
  }

  async recent(limit = 10): Promise<ReportRow[]> {
    return this.db
      .select({
        id: commentReports.id,
        commentId: commentReports.commentId,
        reason: commentReports.reason,
        details: commentReports.details,
        status: commentReports.status,
        createdAt: commentReports.createdAt,
        commentBody: comments.body,
        commentStatus: comments.status,
        reviewSlug: reviews.slug,
        reviewTitle: reviews.titleEs,
      })
      .from(commentReports)
      .leftJoin(comments, eq(comments.id, commentReports.commentId))
      .leftJoin(reviews, eq(reviews.id, comments.reviewId))
      .orderBy(desc(commentReports.createdAt))
      .limit(limit)
      .all();
  }

  async countOpen(): Promise<number> {
    const row = await this.db
      .select({ value: count() })
      .from(commentReports)
      .where(eq(commentReports.status, 'OPEN'))
      .get();
    return row?.value ?? 0;
  }

  async resolveForComment(commentId: string, resolvedBy: string, dismissed = false): Promise<void> {
    await this.db
      .update(commentReports)
      .set({ status: dismissed ? 'DISMISSED' : 'RESOLVED', resolvedAt: Date.now(), resolvedBy })
      .where(and(eq(commentReports.commentId, commentId), eq(commentReports.status, 'OPEN')));
  }
}
