import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../../types/env';
import { forbidden, unauthorized, isSameOrigin } from '../lib/http';
import { verifyCsrf } from '../lib/auth';

/**
 * Sólo ADMIN. El rol se lee de la **sesión en base de datos**, jamás de nada que
 * envíe el cliente (cabeceras, campos ocultos, JWT sin verificar).
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user) {
    if (c.req.header('Accept')?.includes('text/html')) {
      const target = new URL(c.req.url);
      return c.redirect(`/admin/login?next=${encodeURIComponent(target.pathname + target.search)}`, 302);
    }
    throw unauthorized();
  }
  if (user.role !== 'ADMIN') throw forbidden('Esta sección requiere permisos de administrador');
  await next();
});

/**
 * CSRF en dos capas para toda operación con efectos:
 *   1. comprobación de origen (Origin / Sec-Fetch-Site);
 *   2. token sincronizador ligado a la sesión, comparado en tiempo constante.
 * Las cookies son además SameSite=Strict.
 */
export const requireCsrf = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  if (!isSameOrigin(c)) throw forbidden('Origen no permitido');

  const expected = c.get('csrfToken');
  if (!expected) throw unauthorized('Sesión no válida');

  let provided = c.req.header('X-CSRF-Token') ?? null;
  if (!provided) {
    const contentType = c.req.header('Content-Type') ?? '';
    if (contentType.includes('form')) {
      // `all: true` en todas partes: Hono cachea el cuerpo ya parseado, así que
      // las opciones deben coincidir con las de los handlers o se perderían los
      // campos repetidos (géneros, filas de plataformas).
      const body = await c.req.parseBody({ all: true });
      const field = body['_csrf'];
      provided = typeof field === 'string' ? field : Array.isArray(field) && typeof field[0] === 'string' ? field[0] : null;
    }
  }

  if (!verifyCsrf(provided, expected)) throw forbidden('Token CSRF inválido o ausente');
  await next();
});
