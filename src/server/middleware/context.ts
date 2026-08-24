import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../../types/env';
import { readSessionCookie, resolveSession } from '../lib/auth';
import { createContainer, type Container } from '../services/container';

declare module 'hono' {
  interface ContextVariableMap {
    container: Container;
  }
}

/** Inyecta requestId + contenedor y resuelve la sesión (si existe cookie). */
export const requestContext = createMiddleware<AppEnv>(async (c, next) => {
  const requestId = c.req.header('CF-Ray') ?? crypto.randomUUID();
  c.set('requestId', requestId);
  c.set('startedAt', Date.now());
  c.set('container', createContainer(c.env, requestId));
  c.set('user', null);
  c.set('sessionId', null);
  c.set('csrfToken', null);

  const token = readSessionCookie(c);
  if (token) {
    const resolved = await resolveSession(c.env, token);
    if (resolved) {
      c.set('user', resolved.user);
      c.set('sessionId', resolved.sessionId);
      c.set('csrfToken', resolved.csrfSecret);
    }
  }

  await next();
  c.res.headers.set('X-Request-Id', requestId);
});

/** Log estructurado de acceso. Nunca incluye cookies, tokens ni cuerpos. */
export const accessLog = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  const container = c.get('container');
  const duration = Date.now() - c.get('startedAt');
  const status = c.res.status;
  const payload = {
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status,
    durationMs: duration,
    country: c.req.raw.cf?.country as string | undefined,
    userId: c.get('user')?.id,
  };
  if (status >= 500) container.log.error('request', payload);
  else if (status >= 400) container.log.warn('request', payload);
  else container.log.info('request', payload);
});
