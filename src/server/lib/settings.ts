import { z } from 'zod';
import type { Bindings } from '../../types/env';
import { settings as settingsTable } from '../../db/schema';
import { getDb } from '../../db/client';

/**
 * Configuración de la aplicación.
 *
 * Fuente de verdad: tabla `settings` en D1 (transaccional, auditable).
 * KV se usa **solo como caché de lectura** delante de D1 — es el caso de uso
 * correcto para KV: lecturas muy frecuentes, escrituras raras, consistencia
 * eventual aceptable. Toda escritura invalida la clave en KV.
 */

export const SettingsSchema = z.object({
  'comments.mode': z.enum(['OPEN', 'AUTH', 'CLOSED']).default('OPEN'),
  'comments.require_approval': z.boolean().default(true),
  'comments.max_depth': z.number().int().min(1).max(10).default(4),
  'comments.min_length': z.number().int().min(1).max(500).default(2),
  'comments.max_length': z.number().int().min(50).max(10000).default(2000),
  'comments.alias_max_length': z.number().int().min(3).max(60).default(40),
  'moderation.report_threshold': z.number().int().min(1).max(100).default(3),
  'moderation.auto_hide_threshold': z.number().int().min(1).max(1000).default(10),
  'security.turnstile_login': z.boolean().default(true),
  'security.turnstile_comments': z.boolean().default(true),
  'security.turnstile_reports': z.boolean().default(true),
  'site.tagline': z.string().max(200).default('Reseñas de libros, cine, series, anime, cómic y videojuegos'),
  'site.description': z
    .string()
    .max(400)
    .default('Reseñas honestas de libros, novelas, películas, series, anime, cómics, manga y videojuegos.'),
  'privacy.audit_retention_days': z.number().int().min(7).max(3650).default(365),
});

export type AppSettings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof AppSettings;

export const DEFAULT_SETTINGS: AppSettings = SettingsSchema.parse({});

const KV_KEY = 'settings:v1';
const KV_TTL_SECONDS = 60;

export class SettingsService {
  private memo: AppSettings | null = null;

  constructor(private readonly env: Bindings) {}

  async all(): Promise<AppSettings> {
    if (this.memo) return this.memo;

    const cached = await this.env.CACHE.get(KV_KEY, 'json').catch(() => null);
    if (cached) {
      const parsed = SettingsSchema.safeParse(cached);
      if (parsed.success) {
        this.memo = parsed.data;
        return parsed.data;
      }
    }

    const rows = await getDb(this.env).select().from(settingsTable).all();
    const raw: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        raw[row.key] = JSON.parse(row.value);
      } catch {
        /* fila corrupta: se ignora y gana el default */
      }
    }
    const parsed = SettingsSchema.safeParse(raw);
    const value = parsed.success ? parsed.data : DEFAULT_SETTINGS;
    this.memo = value;
    await this.env.CACHE.put(KV_KEY, JSON.stringify(value), { expirationTtl: KV_TTL_SECONDS }).catch(
      () => undefined,
    );
    return value;
  }

  async get<K extends SettingKey>(key: K): Promise<AppSettings[K]> {
    return (await this.all())[key];
  }

  /** Escribe un subconjunto de settings validado y purga la caché KV. */
  async update(patch: Partial<AppSettings>, actorId: string): Promise<AppSettings> {
    const current = await this.all();
    const merged = SettingsSchema.parse({ ...current, ...patch });
    const now = Date.now();
    const db = getDb(this.env);

    const statements = (Object.keys(patch) as SettingKey[]).map((key) =>
      db
        .insert(settingsTable)
        .values({ key, value: JSON.stringify(merged[key]), updatedAt: now, updatedBy: actorId })
        .onConflictDoUpdate({
          target: settingsTable.key,
          set: { value: JSON.stringify(merged[key]), updatedAt: now, updatedBy: actorId },
        }),
    );
    if (statements.length) await db.batch(statements as [typeof statements[number], ...typeof statements]);

    this.memo = merged;
    await this.env.CACHE.delete(KV_KEY).catch(() => undefined);
    await this.env.CACHE.put(KV_KEY, JSON.stringify(merged), { expirationTtl: KV_TTL_SECONDS }).catch(
      () => undefined,
    );
    return merged;
  }
}
