import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { getDb, type Db } from '../client';
import { documents, documentProgress, documentAnnotations, documentBookmarks } from '../schema';
import type { Bindings } from '../../types/env';

export type AnnotationKind = 'HIGHLIGHT' | 'NOTE';
export type AnnotationColor = 'YELLOW' | 'RED' | 'GREEN' | 'BLUE';

export interface DocumentRecord {
  id: string;
  title: string;
  author: string | null;
  r2Key: string;
  sizeBytes: number;
  checksum: string;
  pageCount: number | null;
  coverKey: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  lastReadAt: number | null;
}

export interface DocumentWithProgress extends DocumentRecord {
  progressPage: number | null;
  progressScrollPct: number | null;
  annotationCount: number;
}

export interface AnnotationRecord {
  id: string;
  documentId: string;
  kind: AnnotationKind;
  page: number;
  /** Rectángulos normalizados 0..1. Vacío en una nota suelta. */
  rects: { x: number; y: number; w: number; h: number }[];
  quote: string | null;
  body: string | null;
  color: AnnotationColor;
  createdAt: number;
  updatedAt: number;
}

export interface NewDocument {
  id: string;
  title: string;
  author: string | null;
  r2Key: string;
  sizeBytes: number;
  checksum: string;
  addedBy: string | null;
}

export interface BookmarkRecord {
  id: string;
  documentId: string;
  page: number;
  label: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/**
 * Anotación tal y como llega de un dispositivo que ha estado sin red: trae sus
 * propias marcas de tiempo y, si allí se borró, su lápida. El servidor no las
 * reescribe -- son lo que decide quién gana al fusionar.
 */
export interface IncomingAnnotation {
  id: string;
  documentId: string;
  kind: AnnotationKind;
  page: number;
  rects: { x: number; y: number; w: number; h: number }[] | null;
  quote: string | null;
  body: string | null;
  color: AnnotationColor;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface IncomingBookmark {
  id: string;
  documentId: string;
  page: number;
  label: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface IncomingProgress {
  documentId: string;
  page: number;
  scrollPct: number;
  updatedAt: number;
}

export interface NewAnnotation {
  id: string;
  documentId: string;
  kind: AnnotationKind;
  page: number;
  rects: { x: number; y: number; w: number; h: number }[] | null;
  quote: string | null;
  body: string | null;
  color: AnnotationColor;
}

/**
 * Documentos PDF de la biblioteca privada, con su progreso de lectura y sus
 * anotaciones. Igual que el resto del proyecto, el SQL vive sólo aquí.
 */
export class DocumentRepository {
  private readonly db: Db;

  constructor(env: Pick<Bindings, 'DB'>) {
    this.db = getDb(env);
  }

  /** Estantería: lo leído hace poco primero, y lo nunca abierto al final. */
  async list(): Promise<DocumentWithProgress[]> {
    const rows = await this.db
      .select({
        id: documents.id,
        title: documents.title,
        author: documents.author,
        r2Key: documents.r2Key,
        sizeBytes: documents.sizeBytes,
        checksum: documents.checksum,
        pageCount: documents.pageCount,
        coverKey: documents.coverKey,
        notes: documents.notes,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
        lastReadAt: documents.lastReadAt,
        progressPage: documentProgress.page,
        progressScrollPct: documentProgress.scrollPct,
        annotationCount: sql<number>`(
          SELECT COUNT(*) FROM document_annotations a
          WHERE a.document_id = ${documents.id} AND a.deleted_at IS NULL
        )`,
      })
      .from(documents)
      .leftJoin(documentProgress, eq(documentProgress.documentId, documents.id))
      .orderBy(desc(documents.lastReadAt), desc(documents.createdAt))
      .all();
    return rows as DocumentWithProgress[];
  }

  async get(id: string): Promise<DocumentWithProgress | null> {
    const row = await this.db
      .select({
        id: documents.id,
        title: documents.title,
        author: documents.author,
        r2Key: documents.r2Key,
        sizeBytes: documents.sizeBytes,
        checksum: documents.checksum,
        pageCount: documents.pageCount,
        coverKey: documents.coverKey,
        notes: documents.notes,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
        lastReadAt: documents.lastReadAt,
        progressPage: documentProgress.page,
        progressScrollPct: documentProgress.scrollPct,
        annotationCount: sql<number>`(
          SELECT COUNT(*) FROM document_annotations a
          WHERE a.document_id = ${documents.id} AND a.deleted_at IS NULL
        )`,
      })
      .from(documents)
      .leftJoin(documentProgress, eq(documentProgress.documentId, documents.id))
      .where(eq(documents.id, id))
      .get();
    return (row as DocumentWithProgress | undefined) ?? null;
  }

  /** Busca por hash del contenido: mismo fichero subido dos veces. */
  async findByChecksum(checksum: string): Promise<{ id: string; title: string } | null> {
    const row = await this.db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(eq(documents.checksum, checksum))
      .get();
    return row ?? null;
  }

  async create(input: NewDocument): Promise<void> {
    const now = Date.now();
    await this.db.insert(documents).values({ ...input, createdAt: now, updatedAt: now }).run();
  }

  async update(id: string, patch: { title?: string; author?: string | null; notes?: string | null; coverKey?: string | null }): Promise<void> {
    await this.db.update(documents).set({ ...patch, updatedAt: Date.now() }).where(eq(documents.id, id)).run();
  }

  /**
   * El número de páginas lo cuenta el visor la primera vez que abre el PDF: en
   * el Worker no hay quién lo lea sin una librería de PDF entera.
   */
  async setPageCount(id: string, pageCount: number): Promise<void> {
    await this.db.update(documents).set({ pageCount }).where(eq(documents.id, id)).run();
  }

  async delete(id: string): Promise<void> {
    // El progreso y las anotaciones caen por ON DELETE CASCADE.
    await this.db.delete(documents).where(eq(documents.id, id)).run();
  }

  // ------------------------------------------------------------- progreso --
  /**
   * Guarda por dónde va la lectura. Una fila por documento, así que es un
   * upsert: `ON CONFLICT DO UPDATE`, nunca un SELECT previo.
   */
  async saveProgress(documentId: string, page: number, scrollPct: number): Promise<void> {
    const now = Date.now();
    await this.db
      .insert(documentProgress)
      .values({ documentId, page, scrollPct, updatedAt: now })
      .onConflictDoUpdate({
        target: documentProgress.documentId,
        set: { page, scrollPct, updatedAt: now },
      })
      .run();
    await this.db.update(documents).set({ lastReadAt: now }).where(eq(documents.id, documentId)).run();
  }

  async getProgress(documentId: string): Promise<{ page: number; scrollPct: number; updatedAt: number } | null> {
    const row = await this.db
      .select({ page: documentProgress.page, scrollPct: documentProgress.scrollPct, updatedAt: documentProgress.updatedAt })
      .from(documentProgress)
      .where(eq(documentProgress.documentId, documentId))
      .get();
    return row ?? null;
  }

  // ---------------------------------------------------------- anotaciones --
  async listAnnotations(documentId: string): Promise<AnnotationRecord[]> {
    const rows = await this.db
      .select()
      .from(documentAnnotations)
      .where(and(eq(documentAnnotations.documentId, documentId), isNull(documentAnnotations.deletedAt)))
      .orderBy(documentAnnotations.page, documentAnnotations.createdAt)
      .all();
    return rows.map(toAnnotation);
  }

  async createAnnotation(input: NewAnnotation): Promise<AnnotationRecord> {
    const now = Date.now();
    await this.db
      .insert(documentAnnotations)
      .values({
        id: input.id,
        documentId: input.documentId,
        kind: input.kind,
        page: input.page,
        rects: input.rects ? JSON.stringify(input.rects) : null,
        quote: input.quote,
        body: input.body,
        color: input.color,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return {
      id: input.id,
      documentId: input.documentId,
      kind: input.kind,
      page: input.page,
      rects: input.rects ?? [],
      quote: input.quote,
      body: input.body,
      color: input.color,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Editar una anotación sólo cambia su texto o su color, nunca su posición. */
  async updateAnnotation(
    documentId: string,
    id: string,
    patch: { body?: string | null; color?: AnnotationColor },
  ): Promise<boolean> {
    const result = await this.db
      .update(documentAnnotations)
      .set({ ...patch, updatedAt: Date.now() })
      .where(
        and(
          eq(documentAnnotations.id, id),
          eq(documentAnnotations.documentId, documentId),
          isNull(documentAnnotations.deletedAt),
        ),
      )
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  /**
   * Borrado **lógico**. El `document_id` va en el WHERE además del `id`: sin
   * él, conocer el identificador de una anotación bastaría para borrar la de
   * otro documento.
   *
   * No se borra la fila porque hay un segundo lector -- la aplicación del
   * móvil -- que puede llevar días sin red. Sin lápida, en su siguiente
   * sincronización volvería a subir lo que aquí ya no existe y el subrayado
   * resucitaría solo.
   */
  async deleteAnnotation(documentId: string, id: string): Promise<boolean> {
    const now = Date.now();
    const result = await this.db
      .update(documentAnnotations)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(documentAnnotations.id, id),
          eq(documentAnnotations.documentId, documentId),
          isNull(documentAnnotations.deletedAt),
        ),
      )
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  // ------------------------------------------------- páginas marcadas --
  async listBookmarks(documentId: string): Promise<BookmarkRecord[]> {
    const rows = await this.db
      .select()
      .from(documentBookmarks)
      .where(and(eq(documentBookmarks.documentId, documentId), isNull(documentBookmarks.deletedAt)))
      .orderBy(documentBookmarks.page)
      .all();
    return rows as BookmarkRecord[];
  }

  /**
   * Marca o desmarca una página. Una sola sentencia: la clave única
   * `(document_id, page)` decide si es alta o resurrección, y no hay SELECT
   * previo que pueda quedarse obsoleto entre la consulta y la escritura.
   */
  async setBookmark(documentId: string, page: number, label: string | null, marked: boolean): Promise<BookmarkRecord> {
    const now = Date.now();
    const id = crypto.randomUUID();
    await this.db
      .insert(documentBookmarks)
      .values({
        id,
        documentId,
        page,
        label,
        createdAt: now,
        updatedAt: now,
        deletedAt: marked ? null : now,
      })
      .onConflictDoUpdate({
        target: [documentBookmarks.documentId, documentBookmarks.page],
        set: { label, updatedAt: now, deletedAt: marked ? null : now },
      })
      .run();

    const row = await this.db
      .select()
      .from(documentBookmarks)
      .where(and(eq(documentBookmarks.documentId, documentId), eq(documentBookmarks.page, page)))
      .get();
    return row as BookmarkRecord;
  }

  // ------------------------------------------------- sincronización --
  /**
   * Fusión de lo que llega de un dispositivo.
   *
   * Gana la escritura más reciente, y la comparación la hace **SQLite** dentro
   * del propio `ON CONFLICT DO UPDATE`: leer primero y decidir en JavaScript
   * dejaría una ventana entre la lectura y la escritura en la que otra petición
   * puede colarse. Devuelve si el servidor se ha quedado con lo que llegaba.
   */
  async mergeAnnotation(input: IncomingAnnotation): Promise<boolean> {
    const result = await this.db
      .insert(documentAnnotations)
      .values({
        id: input.id,
        documentId: input.documentId,
        kind: input.kind,
        page: input.page,
        rects: input.rects && input.rects.length ? JSON.stringify(input.rects) : null,
        quote: input.quote,
        body: input.body,
        color: input.color,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        deletedAt: input.deletedAt,
      })
      .onConflictDoUpdate({
        target: documentAnnotations.id,
        set: {
          page: input.page,
          rects: input.rects && input.rects.length ? JSON.stringify(input.rects) : null,
          quote: input.quote,
          body: input.body,
          color: input.color,
          updatedAt: input.updatedAt,
          deletedAt: input.deletedAt,
        },
        setWhere: sql`excluded.updated_at > ${documentAnnotations.updatedAt}`,
      })
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async mergeBookmark(input: IncomingBookmark): Promise<boolean> {
    const result = await this.db
      .insert(documentBookmarks)
      .values({
        id: input.id,
        documentId: input.documentId,
        page: input.page,
        label: input.label,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        deletedAt: input.deletedAt,
      })
      .onConflictDoUpdate({
        target: [documentBookmarks.documentId, documentBookmarks.page],
        set: { label: input.label, updatedAt: input.updatedAt, deletedAt: input.deletedAt },
        setWhere: sql`excluded.updated_at > ${documentBookmarks.updatedAt}`,
      })
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  /**
   * Progreso que llega del móvil. Misma regla: gana el más reciente, decidido
   * en SQL. `last_read_at` del documento sólo se adelanta, nunca retrocede,
   * porque leer en el teléfono algo que se abrió antes en el navegador no debe
   * mandar el libro al fondo de la estantería.
   */
  async mergeProgress(input: IncomingProgress): Promise<boolean> {
    const result = await this.db
      .insert(documentProgress)
      .values({
        documentId: input.documentId,
        page: input.page,
        scrollPct: input.scrollPct,
        updatedAt: input.updatedAt,
      })
      .onConflictDoUpdate({
        target: documentProgress.documentId,
        set: { page: input.page, scrollPct: input.scrollPct, updatedAt: input.updatedAt },
        setWhere: sql`excluded.updated_at > ${documentProgress.updatedAt}`,
      })
      .run();

    if ((result.meta?.changes ?? 0) > 0) {
      await this.db
        .update(documents)
        .set({ lastReadAt: input.updatedAt })
        .where(
          and(
            eq(documents.id, input.documentId),
            sql`(${documents.lastReadAt} IS NULL OR ${documents.lastReadAt} < ${input.updatedAt})`,
          ),
        )
        .run();
      return true;
    }
    return false;
  }

  /**
   * Lo que ha cambiado desde un instante. Incluye las lápidas: el dispositivo
   * necesita enterarse de los borrados tanto como de las altas.
   */
  async changedSince(since: number): Promise<{
    progress: IncomingProgress[];
    annotations: IncomingAnnotation[];
    bookmarks: BookmarkRecord[];
  }> {
    const [progress, annotations, bookmarks] = await Promise.all([
      this.db
        .select({
          documentId: documentProgress.documentId,
          page: documentProgress.page,
          scrollPct: documentProgress.scrollPct,
          updatedAt: documentProgress.updatedAt,
        })
        .from(documentProgress)
        .where(gt(documentProgress.updatedAt, since))
        .all(),
      this.db
        .select()
        .from(documentAnnotations)
        .where(gt(documentAnnotations.updatedAt, since))
        .orderBy(documentAnnotations.updatedAt)
        .limit(2000)
        .all(),
      this.db
        .select()
        .from(documentBookmarks)
        .where(gt(documentBookmarks.updatedAt, since))
        .orderBy(documentBookmarks.updatedAt)
        .limit(2000)
        .all(),
    ]);

    return {
      progress: progress as IncomingProgress[],
      annotations: annotations.map((row) => ({ ...toAnnotation(row), deletedAt: row.deletedAt })),
      bookmarks: bookmarks as BookmarkRecord[],
    };
  }

  // ------------------------------------------------------------- respaldo --
  /**
   * Volcado íntegro para el backup diario. Las fichas, el progreso y las
   * anotaciones, no los ficheros: lo que cuesta rehacer es esto.
   */
  async exportAll(): Promise<{
    documents: (typeof documents.$inferSelect)[];
    progress: (typeof documentProgress.$inferSelect)[];
    annotations: (typeof documentAnnotations.$inferSelect)[];
    bookmarks: (typeof documentBookmarks.$inferSelect)[];
  }> {
    const [docs, progress, annotations, bookmarks] = await Promise.all([
      this.db.select().from(documents).orderBy(documents.createdAt).all(),
      this.db.select().from(documentProgress).all(),
      this.db.select().from(documentAnnotations).orderBy(documentAnnotations.createdAt).all(),
      this.db.select().from(documentBookmarks).orderBy(documentBookmarks.createdAt).all(),
    ]);
    return { documents: docs, progress, annotations, bookmarks };
  }
}

function toAnnotation(row: typeof documentAnnotations.$inferSelect): AnnotationRecord {
  return {
    id: row.id,
    documentId: row.documentId,
    kind: row.kind,
    page: row.page,
    rects: parseRects(row.rects),
    quote: row.quote,
    body: row.body,
    color: row.color,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Los rectángulos se guardan como JSON. Si la columna trae algo que no cuadra
 * —edición a mano, migración a medias— se devuelve vacío en vez de romper el
 * lector entero: una anotación sin rectángulos sigue siendo una nota legible.
 */
function parseRects(raw: string | null): { x: number; y: number; w: number; h: number }[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is { x: number; y: number; w: number; h: number } =>
        typeof r === 'object' && r !== null &&
        ['x', 'y', 'w', 'h'].every((k) => typeof (r as Record<string, unknown>)[k] === 'number'),
    );
  } catch {
    return [];
  }
}
