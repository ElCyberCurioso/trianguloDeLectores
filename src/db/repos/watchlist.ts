import { and, asc, desc, eq, inArray, isNull, like, or, sql, count } from 'drizzle-orm';
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
  yearEnd: number | null;
  yearOngoing: number;
  seasons: number | null;
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
  /** Slug de categoría, no id: es lo que viaja en la URL del filtro. */
  category?: string;
  /**
   * Periodo con el que tiene que solaparse el de la obra.
   *
   * Solaparse y no coincidir: buscando «2021» tiene que salir una serie de
   * 2020-2022, porque en 2021 se estaba emitiendo. Pedir coincidencia exacta
   * dejaría fuera justo lo que el periodo vino a representar.
   */
  yearFrom?: number;
  yearTo?: number;
  sort?: WatchlistSort;
  onlyPublic?: boolean;
  /** Sin él no se aplica filtro de visibilidad; `onlyPublic` sigue mandando. */
  visibility?: 'ALL' | 'PUBLIC' | 'PRIVATE';
  /** Excluye lo que ya tiene reseña. Implícito en `onlyPublic`. */
  withoutReview?: boolean;
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
  yearEnd: watchlistItems.yearEnd,
  yearOngoing: watchlistItems.yearOngoing,
  seasons: watchlistItems.seasons,
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

    if (query.onlyPublic) {
      conditions.push(eq(watchlistItems.isPublic, 1));
      /*
       * Lo que ya tiene reseña deja de ser un pendiente, esté en el estado que
       * esté. El filtro por estado no basta: un item convertido al que alguien
       * devuelve a «pendiente» volvería a la lista pública conviviendo con su
       * propia reseña, que es justo lo que no puede pasar. Manda el vínculo.
       */
      conditions.push(isNull(watchlistItems.reviewId));
    }

    const status = query.status ?? 'ACTIVE';
    if (status === 'ACTIVE') {
      conditions.push(inArray(watchlistItems.status, ['PENDING', 'IN_PROGRESS']));
    } else if (status !== 'ALL') {
      conditions.push(eq(watchlistItems.status, status));
    }

    if (query.type) conditions.push(eq(watchlistItems.contentType, query.type));
    if (query.priority) conditions.push(eq(watchlistItems.priority, query.priority));
    if (query.category) conditions.push(eq(categories.slug, query.category));
    if (query.withoutReview) conditions.push(isNull(watchlistItems.reviewId));

    if (query.visibility === 'PUBLIC') conditions.push(eq(watchlistItems.isPublic, 1));
    if (query.visibility === 'PRIVATE') conditions.push(eq(watchlistItems.isPublic, 0));

    /*
     * Solape de periodos.
     *
     * Dos rangos se solapan si cada uno empieza antes de que acabe el otro. El
     * final de la obra sale de tres sitios, en este orden: el año de fin, el
     * tope abierto cuando sigue en marcha, y el propio año de inicio cuando es
     * un año suelto. Sin el `COALESCE`, cualquier ficha sin año de fin —que son
     * casi todas— se quedaría fuera de cualquier búsqueda por años.
     */
    const finDeObra = sql`COALESCE(${watchlistItems.yearEnd},
      CASE WHEN ${watchlistItems.yearOngoing} = 1 THEN 9999 ELSE ${watchlistItems.year} END)`;
    if (query.yearFrom !== undefined) conditions.push(sql`${finDeObra} >= ${query.yearFrom}`);
    if (query.yearTo !== undefined) conditions.push(sql`${watchlistItems.year} <= ${query.yearTo}`);

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
      // El mismo JOIN que el listado: el filtro por categoría vive en
      // `categories.slug`, así que sin unir la tabla el COUNT no compila.
      this.db
        .select({ value: count() })
        .from(watchlistItems)
        .leftJoin(categories, eq(categories.id, watchlistItems.categoryId))
        .where(where)
        .get(),
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

  /**
   * Pendientes que todavía no tienen reseña, de un tipo de contenido.
   *
   * Se traen todos y se comparan los títulos **en el Worker**, no en SQL: hace
   * falta normalizar acentos y mayúsculas, y `LOWER()` de SQLite no toca los
   * acentos —«Amélie» y «amelie» no le parecen lo mismo—. Son unas decenas de
   * filas como mucho: la cola de pendientes de una persona, no un catálogo.
   */
  async activosSinResena(contentType: ContentType): Promise<Array<{ id: string; titleEs: string; status: WatchlistStatus }>> {
    return this.db
      .select({ id: watchlistItems.id, titleEs: watchlistItems.titleEs, status: watchlistItems.status })
      .from(watchlistItems)
      .where(
        and(
          eq(watchlistItems.contentType, contentType),
          isNull(watchlistItems.reviewId),
          inArray(watchlistItems.status, ['PENDING', 'IN_PROGRESS']),
        ),
      )
      .all();
  }

  /**
   * Todos los títulos dados de alta de un tipo, para no repetirlos.
   *
   * Aquí no se filtra por estado ni por reseña, al revés que en
   * `activosSinResena()`: lo que se busca es si la obra **ya está en la lista**,
   * y uno terminado o descartado también está. Los títulos se comparan en el
   * Worker por lo mismo de siempre —`LOWER()` de SQLite no toca los acentos—.
   */
  async titulosDelTipo(
    contentType: ContentType,
  ): Promise<Array<{ id: string; titleEs: string; status: WatchlistStatus; reviewId: string | null }>> {
    return this.db
      .select({
        id: watchlistItems.id,
        titleEs: watchlistItems.titleEs,
        status: watchlistItems.status,
        reviewId: watchlistItems.reviewId,
      })
      .from(watchlistItems)
      .where(eq(watchlistItems.contentType, contentType))
      .all();
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
        and(
          eq(watchlistItems.isPublic, 1),
          inArray(watchlistItems.status, ['PENDING', 'IN_PROGRESS']),
          // Mismo criterio que el listado: si contara los ya reseñados, los
          // números de las pestañas no cuadrarían con lo que se ve debajo.
          isNull(watchlistItems.reviewId),
        ),
      )
      .groupBy(watchlistItems.contentType)
      .all();
    return rows;
  }
}
