import { asc, eq, sql, count, and, isNull } from 'drizzle-orm';
import { getDb, type Db } from '../client';
import { categories, genres, platforms, reviews, reviewGenres } from '../schema';
import type { Bindings } from '../../types/env';
import type { Category, Genre, Platform } from '../schema';

export interface CategoryWithCount extends Category { reviewCount: number }
export interface GenreWithCount extends Genre { reviewCount: number }

export class TaxonomyRepository {
  private readonly db: Db;

  constructor(env: Pick<Bindings, 'DB'>) {
    this.db = getDb(env);
  }

  // ------------------------------------------------------------ categorías --
  listCategories(onlyActive = true): Promise<Category[]> {
    const where = onlyActive ? eq(categories.isActive, 1) : undefined;
    return this.db.select().from(categories).where(where).orderBy(asc(categories.sortOrder), asc(categories.name)).all();
  }

  /** Categorías con número de reseñas publicadas (para los filtros del catálogo). */
  async listCategoriesWithCounts(): Promise<CategoryWithCount[]> {
    const rows = await this.db
      .select({
        id: categories.id,
        slug: categories.slug,
        name: categories.name,
        description: categories.description,
        sortOrder: categories.sortOrder,
        isActive: categories.isActive,
        createdAt: categories.createdAt,
        updatedAt: categories.updatedAt,
        /*
         * La columna de fuera se nombra **cualificada y a mano**.
         *
         * Interpolando `${categories.id}` en la plantilla, Drizzle emite
         * `"id"` a secas, y dentro del subselect `FROM reviews r` eso resuelve
         * contra `reviews`: la condición se convertía en `r.category_id = r.id`
         * y no se cumplía nunca. El resultado era que **todas las categorías
         * contaban cero**, en los filtros del catálogo y en todas partes, sin
         * que nada fallara. Escrito así correlaciona con la tabla de fuera, que
         * es lo que se quería.
         */
        reviewCount: sql<number>`(
          SELECT COUNT(*) FROM reviews r
          WHERE r.category_id = categories.id
            AND r.status = 'PUBLISHED' AND r.deleted_at IS NULL
        )`,
      })
      .from(categories)
      .where(eq(categories.isActive, 1))
      .orderBy(asc(categories.sortOrder), asc(categories.name))
      .all();
    return rows;
  }

  getCategoryBySlug(slug: string): Promise<Category | undefined> {
    return this.db.select().from(categories).where(eq(categories.slug, slug)).get();
  }

  /** Un género por su slug. Lo pide la página propia de cada género. */
  getGenreBySlug(slug: string): Promise<Genre | undefined> {
    return this.db.select().from(genres).where(eq(genres.slug, slug)).get();
  }

  getCategoryById(id: string): Promise<Category | undefined> {
    return this.db.select().from(categories).where(eq(categories.id, id)).get();
  }

  async upsertCategory(value: typeof categories.$inferInsert): Promise<void> {
    await this.db
      .insert(categories)
      .values(value)
      .onConflictDoUpdate({ target: categories.id, set: { ...value, id: undefined } as never });
  }

  async createCategory(value: typeof categories.$inferInsert): Promise<void> {
    await this.db.insert(categories).values(value);
  }

  async updateCategory(id: string, value: Partial<typeof categories.$inferInsert>): Promise<void> {
    await this.db.update(categories).set(value).where(eq(categories.id, id));
  }

  async deleteCategory(id: string): Promise<void> {
    await this.db.delete(categories).where(eq(categories.id, id));
  }

  async categorySlugIsFree(slug: string, exceptId?: string): Promise<boolean> {
    const row = await this.db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).get();
    return !row || row.id === exceptId;
  }

  // -------------------------------------------------------------- géneros --
  listGenres(): Promise<Genre[]> {
    return this.db.select().from(genres).orderBy(asc(genres.name)).all();
  }

  async listGenresWithCounts(): Promise<GenreWithCount[]> {
    return this.db
      .select({
        id: genres.id,
        slug: genres.slug,
        name: genres.name,
        createdAt: genres.createdAt,
        updatedAt: genres.updatedAt,
        // Mismo caso que en las categorías: `${genres.id}` salía como `"id"`
        // sin cualificar y dentro del subselect resolvía contra otra tabla.
        reviewCount: sql<number>`(
          SELECT COUNT(*) FROM review_genres rg
          JOIN reviews r ON r.id = rg.review_id
          WHERE rg.genre_id = genres.id
            AND r.status = 'PUBLISHED' AND r.deleted_at IS NULL
        )`,
      })
      .from(genres)
      .orderBy(asc(genres.name))
      .all();
  }

  async createGenre(value: typeof genres.$inferInsert): Promise<void> {
    await this.db.insert(genres).values(value);
  }

  async updateGenre(id: string, value: Partial<typeof genres.$inferInsert>): Promise<void> {
    await this.db.update(genres).set(value).where(eq(genres.id, id));
  }

  async deleteGenre(id: string): Promise<void> {
    await this.db.delete(reviewGenres).where(eq(reviewGenres.genreId, id));
    await this.db.delete(genres).where(eq(genres.id, id));
  }

  async genreSlugIsFree(slug: string, exceptId?: string): Promise<boolean> {
    const row = await this.db.select({ id: genres.id }).from(genres).where(eq(genres.slug, slug)).get();
    return !row || row.id === exceptId;
  }

  // ----------------------------------------------------------- plataformas --
  listPlatforms(onlyActive = false): Promise<Platform[]> {
    const where = onlyActive ? eq(platforms.isActive, 1) : undefined;
    return this.db.select().from(platforms).where(where).orderBy(asc(platforms.sortOrder), asc(platforms.name)).all();
  }

  getPlatformById(id: string): Promise<Platform | undefined> {
    return this.db.select().from(platforms).where(eq(platforms.id, id)).get();
  }

  async createPlatform(value: typeof platforms.$inferInsert): Promise<void> {
    await this.db.insert(platforms).values(value);
  }

  async updatePlatform(id: string, value: Partial<typeof platforms.$inferInsert>): Promise<void> {
    await this.db.update(platforms).set(value).where(eq(platforms.id, id));
  }

  async deletePlatform(id: string): Promise<void> {
    await this.db.delete(platforms).where(eq(platforms.id, id));
  }

  async platformSlugIsFree(slug: string, exceptId?: string): Promise<boolean> {
    const row = await this.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.slug, slug)).get();
    return !row || row.id === exceptId;
  }

  /** Tipos de contenido presentes en reseñas publicadas (filtros dinámicos). */
  async usedContentTypes(): Promise<Array<{ type: string; total: number }>> {
    const rows = await this.db
      .select({ type: reviews.contentType, total: count() })
      .from(reviews)
      .where(and(eq(reviews.status, 'PUBLISHED'), isNull(reviews.deletedAt)))
      .groupBy(reviews.contentType)
      .all();
    return rows.map((r) => ({ type: r.type, total: r.total }));
  }

  /**
   * Volcado completo para la copia diaria.
   *
   * Sin filtros ni paginación a propósito: una copia parcial es una copia que
   * engaña. Se ordena por fecha de creación para que dos volcados del mismo día
   * salgan iguales y se puedan comparar.
   */
  async exportAll(): Promise<{
    categories: Category[];
    genres: Genre[];
    platforms: Platform[];
  }> {
    const [cats, gens, plats] = await Promise.all([
      this.db.select().from(categories).orderBy(categories.sortOrder).all(),
      this.db.select().from(genres).orderBy(genres.name).all(),
      this.db.select().from(platforms).orderBy(platforms.name).all(),
    ]);
    return { categories: cats, genres: gens, platforms: plats };
  }
}
