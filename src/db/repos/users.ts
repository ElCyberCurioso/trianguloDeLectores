import { eq, sql, count, desc } from 'drizzle-orm';
import { getDb, type Db } from '../client';
import { users, type User } from '../schema';
import type { Bindings } from '../../types/env';

/** Normaliza el email para la unicidad (case-insensitive, sin espacios). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class UserRepository {
  private readonly db: Db;

  constructor(env: Pick<Bindings, 'DB'>) {
    this.db = getDb(env);
  }

  findByEmail(email: string): Promise<User | undefined> {
    return this.db.select().from(users).where(eq(users.emailNorm, normalizeEmail(email))).get();
  }

  findById(id: string): Promise<User | undefined> {
    return this.db.select().from(users).where(eq(users.id, id)).get();
  }

  async create(value: typeof users.$inferInsert): Promise<void> {
    await this.db.insert(users).values(value);
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.db.update(users).set({ passwordHash, updatedAt: Date.now() }).where(eq(users.id, id));
  }

  /** Contador de fallos + bloqueo temporal (defensa en profundidad junto al DO). */
  async registerFailedLogin(id: string, lockAfter: number, lockMs: number): Promise<void> {
    const now = Date.now();
    await this.db.run(sql`
      UPDATE users
      SET failed_logins = failed_logins + 1,
          locked_until = CASE WHEN failed_logins + 1 >= ${lockAfter} THEN ${now + lockMs} ELSE locked_until END,
          updated_at = ${now}
      WHERE id = ${id}
    `);
  }

  async registerSuccessfulLogin(id: string): Promise<void> {
    const now = Date.now();
    await this.db
      .update(users)
      .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now })
      .where(eq(users.id, id));
  }

  async countAll(): Promise<number> {
    const row = await this.db.select({ value: count() }).from(users).get();
    return row?.value ?? 0;
  }

  list(limit = 50) {
    return this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        status: users.status,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .all();
  }
}
