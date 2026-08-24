import { DurableObject } from 'cloudflare:workers';

/**
 * Rate limiter con ventana deslizante, un Durable Object por clave lógica
 * (p.ej. `login:<ipHash>`, `comment:<ipHash>`, `upload:<userId>`).
 *
 * Por qué DO y no KV: KV es eventualmente consistente y sus escrituras están
 * limitadas a ~1/s por clave, así que dos peticiones simultáneas pueden ver el
 * mismo contador. Un DO da ejecución serializada y estado fuerte por clave, que
 * es exactamente lo que un limitador necesita. No hace falta Redis externo.
 */

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** epoch ms en el que la ventana se vacía del todo */
  resetAt: number;
  retryAfterSeconds: number;
}

interface Bucket {
  /** timestamps (ms) de las peticiones dentro de la ventana */
  hits: number[];
  blockedUntil: number;
}

const MAX_TRACKED_HITS = 512;

export class RateLimiter extends DurableObject {
  /**
   * @param limit      peticiones permitidas por ventana
   * @param windowMs   tamaño de la ventana
   * @param penaltyMs  bloqueo extra al superar el límite (backoff duro)
   */
  async check(limit: number, windowMs: number, penaltyMs = 0): Promise<RateLimitDecision> {
    const now = Date.now();
    const stored = (await this.ctx.storage.get<Bucket>('bucket')) ?? { hits: [], blockedUntil: 0 };

    if (stored.blockedUntil > now) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: stored.blockedUntil,
        retryAfterSeconds: Math.ceil((stored.blockedUntil - now) / 1000),
      };
    }

    const cutoff = now - windowMs;
    const hits = stored.hits.filter((t) => t > cutoff);

    if (hits.length >= limit) {
      const blockedUntil = penaltyMs > 0 ? now + penaltyMs : (hits[0] ?? now) + windowMs;
      await this.ctx.storage.put('bucket', { hits, blockedUntil });
      await this.ctx.storage.setAlarm(blockedUntil + windowMs);
      return {
        allowed: false,
        remaining: 0,
        resetAt: blockedUntil,
        retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1000)),
      };
    }

    hits.push(now);
    if (hits.length > MAX_TRACKED_HITS) hits.splice(0, hits.length - MAX_TRACKED_HITS);
    await this.ctx.storage.put('bucket', { hits, blockedUntil: 0 });
    await this.ctx.storage.setAlarm(now + windowMs * 2);

    return {
      allowed: true,
      remaining: Math.max(0, limit - hits.length),
      resetAt: now + windowMs,
      retryAfterSeconds: 0,
    };
  }

  /** Limpia el contador (p.ej. tras un login correcto). */
  async reset(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  /** Consulta sin consumir cuota. */
  async peek(limit: number, windowMs: number): Promise<RateLimitDecision> {
    const now = Date.now();
    const stored = (await this.ctx.storage.get<Bucket>('bucket')) ?? { hits: [], blockedUntil: 0 };
    const hits = stored.hits.filter((t) => t > now - windowMs);
    const blocked = stored.blockedUntil > now;
    return {
      allowed: !blocked && hits.length < limit,
      remaining: Math.max(0, limit - hits.length),
      resetAt: blocked ? stored.blockedUntil : now + windowMs,
      retryAfterSeconds: blocked ? Math.ceil((stored.blockedUntil - now) / 1000) : 0,
    };
  }

  /** El alarm libera el almacenamiento de objetos inactivos. */
  override async alarm(): Promise<void> {
    const stored = await this.ctx.storage.get<Bucket>('bucket');
    const now = Date.now();
    if (!stored || (stored.blockedUntil < now && stored.hits.every((t) => t < now - 3_600_000))) {
      await this.ctx.storage.deleteAll();
    }
  }
}
