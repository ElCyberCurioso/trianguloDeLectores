import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import { getDb, type Db } from '../client';
import { libraryBooks } from '../schema';
import type { Bindings } from '../../types/env';

export type LibraryStatus = 'OWNED' | 'READING' | 'READ' | 'LENT' | 'WISHLIST';
export type LibrarySource = 'MANUAL' | 'OPENLIBRARY';

export interface LibraryRecord {
  id: string;
  isbn13: string | null;
  isbn10: string | null;
  title: string;
  subtitle: string | null;
  authors: string | null;
  publisher: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  language: string | null;
  coverKey: string | null;
  location: string | null;
  status: LibraryStatus;
  rating: number | null;
  notes: string | null;
  source: LibrarySource;
  createdAt: number;
  updatedAt: number;
}

export type NewLibraryBook = Omit<LibraryRecord, 'createdAt' | 'updatedAt'> & { addedBy: string | null };
export type LibraryPatch = Partial<Omit<LibraryRecord, 'id' | 'createdAt' | 'updatedAt'>>;

export interface LibraryQuery {
  q?: string;
  status?: LibraryStatus | 'ALL';
}

export interface LibraryCounters {
  total: number;
  owned: number;
  reading: number;
  read: number;
  lent: number;
  wishlist: number;
}

/** Catálogo de los libros en papel. */
export class LibraryRepository {
  private readonly db: Db;

  constructor(env: Pick<Bindings, 'DB'>) {
    this.db = getDb(env);
  }

  async list(query: LibraryQuery = {}): Promise<LibraryRecord[]> {
    const filters = [];
    if (query.status && query.status !== 'ALL') filters.push(eq(libraryBooks.status, query.status));
    if (query.q) {
      // Búsqueda sencilla sobre título, autor e ISBN. El `%` va en el
      // parámetro, no concatenado en el SQL: lo escapa el driver.
      const needle = `%${query.q}%`;
      filters.push(
        or(
          like(libraryBooks.title, needle),
          like(libraryBooks.authors, needle),
          like(libraryBooks.isbn13, needle),
        ),
      );
    }
    return this.db
      .select()
      .from(libraryBooks)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(libraryBooks.createdAt))
      .all() as Promise<LibraryRecord[]>;
  }

  async get(id: string): Promise<LibraryRecord | null> {
    const row = await this.db.select().from(libraryBooks).where(eq(libraryBooks.id, id)).get();
    return (row as LibraryRecord | undefined) ?? null;
  }

  async findByIsbn13(isbn13: string): Promise<LibraryRecord | null> {
    const row = await this.db.select().from(libraryBooks).where(eq(libraryBooks.isbn13, isbn13)).get();
    return (row as LibraryRecord | undefined) ?? null;
  }

  async create(input: NewLibraryBook): Promise<void> {
    const now = Date.now();
    await this.db.insert(libraryBooks).values({ ...input, createdAt: now, updatedAt: now }).run();
  }

  async update(id: string, patch: LibraryPatch): Promise<void> {
    await this.db.update(libraryBooks).set({ ...patch, updatedAt: Date.now() }).where(eq(libraryBooks.id, id)).run();
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(libraryBooks).where(eq(libraryBooks.id, id)).run();
  }

  async counters(): Promise<LibraryCounters> {
    const rows = await this.db
      .select({ status: libraryBooks.status, total: sql<number>`COUNT(*)` })
      .from(libraryBooks)
      .groupBy(libraryBooks.status)
      .all();
    const by = (s: LibraryStatus) => rows.find((r) => r.status === s)?.total ?? 0;
    return {
      total: rows.reduce((sum, r) => sum + r.total, 0),
      owned: by('OWNED'),
      reading: by('READING'),
      read: by('READ'),
      lent: by('LENT'),
      wishlist: by('WISHLIST'),
    };
  }

  /** Volcado íntegro para el backup diario. */
  async exportAll(): Promise<LibraryRecord[]> {
    return this.db.select().from(libraryBooks).orderBy(libraryBooks.createdAt).all() as Promise<LibraryRecord[]>;
  }
}
