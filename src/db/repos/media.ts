import { desc, eq } from 'drizzle-orm';
import { getDb, type Db } from '../client';
import { mediaObjects } from '../schema';
import type { Bindings } from '../../types/env';

export class MediaRepository {
  private readonly db: Db;

  constructor(env: Pick<Bindings, 'DB'>) {
    this.db = getDb(env);
  }

  async register(value: typeof mediaObjects.$inferInsert): Promise<void> {
    await this.db.insert(mediaObjects).values(value);
  }

  get(key: string) {
    return this.db.select().from(mediaObjects).where(eq(mediaObjects.key, key)).get();
  }

  async remove(key: string): Promise<void> {
    await this.db.delete(mediaObjects).where(eq(mediaObjects.key, key));
  }

  list(limit = 60) {
    return this.db.select().from(mediaObjects).orderBy(desc(mediaObjects.createdAt)).limit(limit).all();
  }

  /**
   * Volcado completo para la copia diaria.
   *
   * Sin filtros ni paginación a propósito: una copia parcial es una copia que
   * engaña. Se ordena por fecha de creación para que dos volcados del mismo día
   * salgan iguales y se puedan comparar.
   */
  exportAll(): Promise<(typeof mediaObjects.$inferSelect)[]> {
    return this.db.select().from(mediaObjects).orderBy(mediaObjects.createdAt).all();
  }
}
