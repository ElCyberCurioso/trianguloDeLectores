import { and, asc, eq, inArray, count } from 'drizzle-orm';
import { getDb, type Db } from '../client';
import { reviewEpisodes } from '../schema';
import type { Bindings } from '../../types/env';

/**
 * Una fila de `review_episodes`: un capítulo, o una temporada entera.
 *
 * `episode` a 0 significa «la temporada completa». Ver el comentario de la
 * migración `0006`: es un cero y no un nulo porque con nulos el índice único
 * dejaría meter dos veces la misma temporada.
 */
export interface EpisodeRow {
  id: string;
  reviewId: string;
  season: number;
  episode: number;
  title: string | null;
  ratingHalf: number | null;
  note: string | null;
  hasSpoilers: number;
  createdAt: number;
  updatedAt: number;
}

const columns = {
  id: reviewEpisodes.id,
  reviewId: reviewEpisodes.reviewId,
  season: reviewEpisodes.season,
  episode: reviewEpisodes.episode,
  title: reviewEpisodes.title,
  ratingHalf: reviewEpisodes.ratingHalf,
  note: reviewEpisodes.note,
  hasSpoilers: reviewEpisodes.hasSpoilers,
  createdAt: reviewEpisodes.createdAt,
  updatedAt: reviewEpisodes.updatedAt,
};

export class EpisodeRepository {
  private readonly db: Db;

  constructor(env: Pick<Bindings, 'DB'>) {
    this.db = getDb(env);
  }

  /** Los de una reseña, en orden de emisión. */
  byReview(reviewId: string): Promise<EpisodeRow[]> {
    return this.db
      .select(columns)
      .from(reviewEpisodes)
      .where(eq(reviewEpisodes.reviewId, reviewId))
      .orderBy(asc(reviewEpisodes.season), asc(reviewEpisodes.episode))
      .all();
  }

  /**
   * Uno concreto, **con el id de la reseña en el WHERE**.
   *
   * El id de la fila no basta y no es un detalle: sin el de la reseña, conocer
   * un identificador permitiría editar o borrar el episodio de otra reseña. Es
   * la misma regla que en las anotaciones del lector.
   */
  async getById(reviewId: string, id: string): Promise<EpisodeRow | null> {
    const row = await this.db
      .select(columns)
      .from(reviewEpisodes)
      .where(and(eq(reviewEpisodes.reviewId, reviewId), eq(reviewEpisodes.id, id)))
      .get();
    return row ?? null;
  }

  /** ¿Ya hay una fila para esa temporada y ese capítulo? */
  async find(reviewId: string, season: number, episode: number): Promise<EpisodeRow | null> {
    const row = await this.db
      .select(columns)
      .from(reviewEpisodes)
      .where(
        and(
          eq(reviewEpisodes.reviewId, reviewId),
          eq(reviewEpisodes.season, season),
          eq(reviewEpisodes.episode, episode),
        ),
      )
      .get();
    return row ?? null;
  }

  async insert(values: typeof reviewEpisodes.$inferInsert): Promise<void> {
    await this.db.insert(reviewEpisodes).values(values);
  }

  async update(reviewId: string, id: string, values: Partial<typeof reviewEpisodes.$inferInsert>): Promise<void> {
    await this.db
      .update(reviewEpisodes)
      .set(values)
      .where(and(eq(reviewEpisodes.reviewId, reviewId), eq(reviewEpisodes.id, id)));
  }

  async remove(reviewId: string, id: string): Promise<void> {
    await this.db
      .delete(reviewEpisodes)
      .where(and(eq(reviewEpisodes.reviewId, reviewId), eq(reviewEpisodes.id, id)));
  }

  /**
   * Cuántos episodios tiene cada reseña de una tanda.
   *
   * Una consulta para todas y no una por cada una: el listado del panel pinta
   * veinte filas y hacer veinte viajes a D1 por un número se nota.
   */
  async countsFor(reviewIds: string[]): Promise<Map<string, number>> {
    if (!reviewIds.length) return new Map();
    const rows = await this.db
      .select({ reviewId: reviewEpisodes.reviewId, total: count() })
      .from(reviewEpisodes)
      .where(inArray(reviewEpisodes.reviewId, reviewIds))
      .groupBy(reviewEpisodes.reviewId)
      .all();
    return new Map(rows.map((r) => [r.reviewId, r.total]));
  }
}
