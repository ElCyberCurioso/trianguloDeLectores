import type { Context } from 'hono';
import type { AppEnv } from '../../types/env';

/** Error de aplicación con código HTTP y código estable para el cliente. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, msg: string, details?: Record<string, unknown>) =>
  new AppError(400, code, msg, details);
export const unauthorized = (msg = 'No autenticado') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Sin permisos') => new AppError(403, 'forbidden', msg);
export const notFound = (msg = 'No encontrado') => new AppError(404, 'not_found', msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);
export const tooLarge = (msg = 'Contenido demasiado grande') => new AppError(413, 'too_large', msg);
export const tooMany = (msg = 'Demasiadas peticiones', retryAfter?: number) =>
  new AppError(429, 'rate_limited', msg, retryAfter ? { retryAfter } : undefined);

export interface ApiOk<T> { ok: true; data: T }
export interface ApiErr { ok: false; error: { code: string; message: string; details?: unknown } }

export function ok<T>(c: Context<AppEnv>, data: T, status = 200) {
  return c.json<ApiOk<T>>({ ok: true, data }, status as 200);
}

/** Obtiene la IP real del visitante detrás de Cloudflare. */
export function clientIp(c: Context<AppEnv>): string | null {
  return (
    c.req.header('CF-Connecting-IP') ??
    c.req.header('X-Real-IP') ??
    null
  );
}

export function isSameOrigin(c: Context<AppEnv>): boolean {
  const origin = c.req.header('Origin');

  if (!origin) {
    // Sin cabecera Origin sólo se acepta si Sec-Fetch-Site dice que la petición
    // nace del propio sitio. Todos los navegadores actuales la envían; los que
    // no, siguen sujetos al token CSRF, que es obligatorio igualmente.
    const site = c.req.header('Sec-Fetch-Site');
    return site === 'same-origin' || site === 'none';
  }

  // El host se toma de la URL de la petición, no de la cabecera Host: es el
  // valor que el runtime considera autoritativo y no depende de que un
  // intermediario reenvíe Host.
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}
