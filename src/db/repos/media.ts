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
}
