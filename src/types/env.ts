import type { RateLimiter } from '../do/rate-limiter';
import type { ModerationCoordinator } from '../do/moderation';
import type { SessionUser } from '../server/lib/auth';
import type { ResolvedDevice } from '../db/repos/devices';

export interface Bindings {
  // --- Cloudflare resources -------------------------------------------------
  DB: D1Database;
  MEDIA: R2Bucket;
  CACHE: KVNamespace;
  CONFIG: KVNamespace;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  MODERATION: DurableObjectNamespace<ModerationCoordinator>;
  ASSETS: Fetcher;
  /**
   * Identificador único de la versión desplegada. Entra en la clave de caché,
   * así que cada despliegue deja inalcanzable el HTML del anterior: sin esto,
   * un cambio de plantilla o de estilos convivía hasta una hora con el marcado
   * viejo, y el sitio se veía distinto según la página que hubiera caducado.
   * Opcional: en desarrollo y en los tests no existe.
   */
  CF_VERSION?: { id: string; tag?: string };

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
  /**
   * Origen del subdominio privado de la biblioteca. Si falta se deduce como
   * `books.` + el host de `SITE_URL`. Existe para poder probarlo en local,
   * donde el host es `localhost:8787` y el prefijo no vale.
   */
  BOOKS_URL?: string;

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
  /**
   * Dispositivo móvil autenticado por token, cuando la petición viene de la
   * aplicación Android. Es `null` en todo lo demás: la API del móvil y el
   * navegador no comparten credencial ni por accidente.
   */
  device: ResolvedDevice | null;
  startedAt: number;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };
