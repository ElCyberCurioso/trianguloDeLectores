import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb, type Db } from '../client';
import { deviceTokens, users } from '../schema';
import type { Bindings } from '../../types/env';

export interface DeviceRecord {
  id: string;
  userId: string;
  deviceName: string;
  platform: 'ANDROID';
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface ResolvedDevice {
  deviceId: string;
  deviceName: string;
  userId: string;
  role: 'ADMIN' | 'USER';
  displayName: string;
  expiresAt: number;
  lastSeenAt: number;
}

export interface NewDevice {
  id: string;
  userId: string;
  tokenHash: string;
  deviceName: string;
  ipHash: string | null;
  expiresAt: number;
}

/**
 * Credenciales de los dispositivos móviles.
 *
 * La tabla guarda el SHA-256 del token, así que aquí nunca entra ni sale un
 * token en claro: quien llama hashea primero. Es la misma política que con las
 * contraseñas, y por el mismo motivo -- un volcado de la base no sirve para
 * entrar.
 */
export class DeviceRepository {
  private readonly db: Db;

  constructor(env: Pick<Bindings, 'DB'>) {
    this.db = getDb(env);
  }

  async create(input: NewDevice): Promise<void> {
    const now = Date.now();
    await this.db
      .insert(deviceTokens)
      .values({ ...input, platform: 'ANDROID', createdAt: now, lastSeenAt: now })
      .run();
  }

  /**
   * Resuelve el token a la persona que hay detrás.
   *
   * El rol se lee de la tabla `users` en cada petición, no se copia en la fila
   * del dispositivo: degradar a alguien tiene que surtir efecto sin esperar a
   * que caduque su teléfono.
   */
  async resolve(tokenHash: string): Promise<ResolvedDevice | null> {
    const now = Date.now();
    const row = await this.db
      .select({
        deviceId: deviceTokens.id,
        deviceName: deviceTokens.deviceName,
        userId: deviceTokens.userId,
        expiresAt: deviceTokens.expiresAt,
        lastSeenAt: deviceTokens.lastSeenAt,
        revokedAt: deviceTokens.revokedAt,
        role: users.role,
        displayName: users.displayName,
        status: users.status,
      })
      .from(deviceTokens)
      .innerJoin(users, eq(users.id, deviceTokens.userId))
      .where(eq(deviceTokens.tokenHash, tokenHash))
      .get();

    if (!row) return null;
    if (row.revokedAt !== null) return null;
    if (row.expiresAt <= now) return null;
    if (row.status !== 'ACTIVE') return null;

    return {
      deviceId: row.deviceId,
      deviceName: row.deviceName,
      userId: row.userId,
      role: row.role,
      displayName: row.displayName,
      expiresAt: row.expiresAt,
      lastSeenAt: row.lastSeenAt,
    };
  }

  /**
   * Marca actividad. Se llama sólo cuando ha pasado un rato desde la última
   * vez: escribir en cada petición convertiría cada lectura en una escritura de
   * D1 sin ganar nada.
   */
  async touch(deviceId: string, expiresAt: number): Promise<void> {
    await this.db
      .update(deviceTokens)
      .set({ lastSeenAt: Date.now(), expiresAt })
      .where(eq(deviceTokens.id, deviceId))
      .run();
  }

  async revoke(deviceId: string, userId: string): Promise<boolean> {
    // El `user_id` va en el WHERE además del id, igual que en las anotaciones:
    // conocer un identificador no puede bastar para tocar lo de otra persona.
    const result = await this.db
      .update(deviceTokens)
      .set({ revokedAt: Date.now() })
      .where(and(eq(deviceTokens.id, deviceId), eq(deviceTokens.userId, userId), isNull(deviceTokens.revokedAt)))
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.db
      .update(deviceTokens)
      .set({ revokedAt: Date.now() })
      .where(and(eq(deviceTokens.userId, userId), isNull(deviceTokens.revokedAt)))
      .run();
    return result.meta?.changes ?? 0;
  }

  /** Los dispositivos vivos de una persona, para poder echarlos desde el panel. */
  async listForUser(userId: string): Promise<DeviceRecord[]> {
    const rows = await this.db
      .select({
        id: deviceTokens.id,
        userId: deviceTokens.userId,
        deviceName: deviceTokens.deviceName,
        platform: deviceTokens.platform,
        createdAt: deviceTokens.createdAt,
        lastSeenAt: deviceTokens.lastSeenAt,
        expiresAt: deviceTokens.expiresAt,
        revokedAt: deviceTokens.revokedAt,
      })
      .from(deviceTokens)
      .where(eq(deviceTokens.userId, userId))
      .orderBy(desc(deviceTokens.lastSeenAt))
      .all();
    return rows as DeviceRecord[];
  }

  async countActiveForUser(userId: string): Promise<number> {
    const row = await this.db
      .select({ total: sql<number>`COUNT(*)` })
      .from(deviceTokens)
      .where(
        and(
          eq(deviceTokens.userId, userId),
          isNull(deviceTokens.revokedAt),
          sql`${deviceTokens.expiresAt} > ${Date.now()}`,
        ),
      )
      .get();
    return row?.total ?? 0;
  }

  /**
   * Limpieza de lo caducado y lo revocado hace tiempo. Cuelga del cron diario,
   * igual que la purga de sesiones.
   */
  async purgeExpired(retentionMs: number): Promise<void> {
    const cutoff = Date.now() - retentionMs;
    await this.db
      .delete(deviceTokens)
      .where(or(lt(deviceTokens.expiresAt, cutoff), lt(deviceTokens.revokedAt, cutoff)))
      .run();
  }
}
