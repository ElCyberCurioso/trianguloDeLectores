import { Hono } from 'hono';
import type { AppEnv, Bindings } from '../types/env';
import { securityHeaders, booksSecurityHeaders } from './middleware/security';
import { requestContext, accessLog } from './middleware/context';
import { publicRoutes } from './routes/public';
import { booksRoutes } from './routes/books';
import { publicApi } from './routes/api-public';
import { adminRoutes } from './routes/admin';
import { AppError } from './lib/http';
import { NO_STORE } from './lib/cache';
import { Layout } from './views/layout';
import { ErrorPage } from './views/pages/static';
import { Logger } from './lib/logger';
import { createContainer } from './services/container';
import { purgeExpiredSessions } from './lib/auth';
import { isBooksRequest } from './lib/books';
import { runLibraryBackup } from './services/backup';
import { rateLimit } from './middleware/ratelimit';

const app = new Hono<AppEnv>();

app.use('*', securityHeaders);
app.use('*', requestContext);
app.use('*', accessLog);

app.route('/admin', adminRoutes);
app.use('/api/*', rateLimit('publicApi'));
app.route('/api', publicApi);
app.route('/', publicRoutes);

/**
 * Fallback a los assets estáticos del Worker.
 * Sólo se llega aquí si ninguna ruta ha respondido; el binding ASSETS sirve
 * /assets/* con sus propias cabeceras de caché.
 */
/**
 * Aplicación del subdominio privado `books.`.
 *
 * Comparte proceso y bindings con el sitio público, pero no su cadena de
 * middleware: cabeceras distintas (CSP con WASM para el escáner, cámara
 * permitida, nada cacheable, nada indexable) y ninguna ruta pública montada.
 * Que sean dos aplicaciones y no un prefijo de rutas es lo que garantiza que
 * una cabecera del sitio público no se cuele aquí ni al revés.
 */
const booksApp = new Hono<AppEnv>();
booksApp.use('*', booksSecurityHeaders);
booksApp.use('*', requestContext);
booksApp.use('*', accessLog);
booksApp.route('/', booksRoutes);

/**
 * Estáticos del subdominio: la hoja de estilos, la tipografía, los bundles y
 * pdf.js salen del mismo binding ASSETS que en el sitio público. Sin esto la
 * biblioteca se pintaba sin estilos y el visor no llegaba a cargar.
 */
booksApp.notFound(async (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/assets/') || path === '/favicon.ico' || path === '/apple-touch-icon.png') {
    const asset = await c.env.ASSETS.fetch(c.req.raw);
    if (asset.status !== 404) return asset;
  }
  return c.text('No encontrado', 404);
});

/**
 * Errores del subdominio. No se reutiliza la página de error del sitio público
 * porque arrastraría su cabecera y su navegación, que aquí no pintan nada. El
 * detalle interno se queda en los logs, como en el resto del sitio.
 */
booksApp.onError((err, c) => {
  const isApp = err instanceof AppError;
  const status = isApp ? err.status : 500;
  const requestId = c.get('requestId') ?? 'unknown';

  const payload = {
    status,
    code: isApp ? err.code : 'internal_error',
    path: new URL(c.req.url).pathname,
    method: c.req.method,
    message: err.message,
    stack: status >= 500 ? err.stack?.slice(0, 2000) : undefined,
  };
  const log = c.get('container')?.log ?? new Logger(c.env, { requestId });
  if (status >= 500) log.error('books_unhandled_error', payload);
  else log.warn('books_handled_error', payload);

  if (!(c.req.header('Accept') ?? '').includes('text/html')) {
    return c.json(
      {
        ok: false,
        error: {
          code: isApp ? err.code : 'internal_error',
          message: isApp ? err.message : 'Se ha producido un error inesperado.',
        },
        requestId,
      },
      status as 400,
      { 'Cache-Control': NO_STORE },
    );
  }
  return c.text(
    isApp ? err.message : 'Se ha producido un error inesperado.',
    status as 400,
    { 'Cache-Control': NO_STORE },
  );
});

app.notFound(async (c) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.ico') {
    const asset = await c.env.ASSETS.fetch(c.req.raw);
    if (asset.status !== 404) return asset;
  }
  c.status(404);
  return c.html(
    <Layout
      env={c.env}
      nonce={c.get('nonce')}
      path={new URL(c.req.url).pathname}
      seo={{
        title: `Página no encontrada · ${c.env.SITE_NAME}`,
        description: 'La página que buscas no existe.',
        canonical: `${c.env.SITE_URL.replace(/\/$/, '')}${url.pathname}`,
        noindex: true,
      }}
    >
      <ErrorPage
        status={404}
        title="Página no encontrada"
        message="El enlace puede haber caducado o la reseña ya no está publicada."
      />
    </Layout>,
  );
});

/**
 * Manejador global de errores.
 * Los detalles internos nunca llegan al cliente: se registran en Workers Logs
 * con el requestId para poder correlacionarlos.
 */
app.onError((err, c) => {
  const container = c.get('container');
  const requestId = c.get('requestId') ?? 'unknown';
  const isApp = err instanceof AppError;
  const status = isApp ? err.status : 500;

  const logPayload = {
    status,
    code: isApp ? err.code : 'internal_error',
    path: new URL(c.req.url).pathname,
    method: c.req.method,
    message: err.message,
    stack: status >= 500 ? err.stack?.slice(0, 2000) : undefined,
  };
  if (container) {
    if (status >= 500) container.log.error('unhandled_error', logPayload);
    else container.log.warn('handled_error', logPayload);
  } else {
    new Logger(c.env, { requestId }).error('unhandled_error', logPayload);
  }

  const headers: Record<string, string> = { 'Cache-Control': NO_STORE };
  if (isApp && err.details?.retryAfter) headers['Retry-After'] = String(err.details.retryAfter);

  const wantsHtml = (c.req.header('Accept') ?? '').includes('text/html');
  if (!wantsHtml) {
    return c.json(
      {
        ok: false,
        error: {
          code: isApp ? err.code : 'internal_error',
          message: isApp ? err.message : 'Se ha producido un error inesperado.',
          details: isApp ? err.details : undefined,
        },
        requestId,
      },
      status as 400,
      headers,
    );
  }

  c.status(status as 400);
  for (const [k, v] of Object.entries(headers)) c.header(k, v);
  return c.html(
    <Layout
      env={c.env}
      nonce={c.get('nonce') ?? ''}
      seo={{
        title: `Error ${status} · ${c.env.SITE_NAME}`,
        description: 'Se ha producido un error.',
        canonical: c.env.SITE_URL,
        noindex: true,
      }}
    >
      <ErrorPage
        status={status}
        title={errorTitle(status)}
        message={isApp ? err.message : 'Se ha producido un error inesperado. Ya estamos al tanto.'}
      />
    </Layout>,
  );
});

function errorTitle(status: number): string {
  switch (status) {
    case 400: return 'Petición no válida';
    case 401: return 'Necesitas iniciar sesión';
    case 403: return 'Sin permisos';
    case 404: return 'Página no encontrada';
    case 409: return 'Conflicto';
    case 413: return 'Contenido demasiado grande';
    case 429: return 'Demasiadas peticiones';
    default: return 'Error del servidor';
  }
}

export default {
  /**
   * Punto de entrada único, con reparto por host.
   *
   * `books.<dominio>` va a la aplicación privada y todo lo demás al sitio
   * público. Se hace aquí, antes de cualquier middleware, para que las dos
   * cadenas queden completamente separadas: ninguna cabecera, ninguna caché y
   * ninguna ruta de una alcanza a la otra.
   */
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Response | Promise<Response> {
    if (isBooksRequest(request, env)) return booksApp.fetch(request, env, ctx);
    return app.fetch(request, env, ctx);
  },

  /**
   * Mantenimiento programado (Cron Triggers).
   * Nunca ejecuta migraciones ni borra contenido de usuario: sólo higiene.
   */
  async scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
    const container = createContainer(env, `cron-${crypto.randomUUID()}`);
    ctx.waitUntil(
      (async () => {
        try {
          await purgeExpiredSessions(env);
          const retention = await container.settings.get('privacy.audit_retention_days');
          await container.audit.purgeOlderThan(retention);

          // Copia diaria del catálogo de la biblioteca. Va dentro del mismo
          // cron que ya existía: un único disparo a las 4:00 hace la higiene y
          // el respaldo, sin añadir otro trigger que mantener.
          const backup = await runLibraryBackup(env, `cron-${crypto.randomUUID()}`);

          container.log.info('cron_maintenance_ok', { retention, backup: backup.key, backupBytes: backup.bytes });
        } catch (error) {
          container.log.error('cron_maintenance_failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })(),
    );
  },
} satisfies ExportedHandler<Bindings>;

export { RateLimiter } from '../do/rate-limiter';
export { ModerationCoordinator } from '../do/moderation';
