import type { RateLimiter } from '../do/rate-limiter';
import type { ModerationCoordinator } from '../do/moderation';
import type { SessionUser } from '../server/lib/auth';

export interface Bindings {
  // --- Cloudflare resources -------------------------------------------------
  DB: D1Database;
  MEDIA: R2Bucket;
  CACHE: KVNamespace;
  CONFIG: KVNamespace;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  MODERATION: DurableObjectNamespace<ModerationCoordinator>;
  ASSETS: Fetcher;

  // --- vars (wrangler.jsonc, no secretas) -----------------------------------
  ENVIRONMENT: 'development' | 'staging' | 'production';
  SITE_NAME: string;
  SITE_URL: string;
  SITE_LOCALE: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_ENABLED: string;
  IMAGE_RESIZING: string;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  /** Dominio público opcional del bucket R2. Vacío => se sirve por el Worker. */
  MEDIA_PUBLIC_BASE?: string;

  // --- secrets (wrangler secret put, NUNCA en el repo) -----------------------
  /** Clave privada de Turnstile. */
  TURNSTILE_SECRET_KEY?: string;
  /** Pepper HMAC para pseudonimizar IP/UA (GDPR: no guardamos IP en claro). */
  HASH_PEPPER?: string;
}

export interface Variables {
  requestId: string;
  nonce: string;
  user: SessionUser | null;
  sessionId: string | null;
  csrfToken: string | null;
  startedAt: number;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };
