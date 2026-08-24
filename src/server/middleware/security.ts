import { createMiddleware } from 'hono/factory';
import type { AppEnv, Bindings } from '../../types/env';
import { randomToken } from '../lib/crypto';

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/**
 * Cabeceras de seguridad.
 *
 * La CSP es estricta de verdad: **sin `unsafe-inline` y sin `unsafe-eval`**.
 * Es posible porque el frontend se renderiza en el servidor y el único JS del
 * cliente son ficheros externos con `nonce`; no hay estilos en línea (los
 * valores dinámicos viajan por clases y atributos `data-*`).
 */
export function buildCsp(nonce: string, env: Bindings): string {
  const mediaOrigin = env.MEDIA_PUBLIC_BASE ? new URL(env.MEDIA_PUBLIC_BASE).origin : '';
  const imgSources = ["'self'", 'data:', mediaOrigin].filter(Boolean).join(' ');

  const directives = [
    "default-src 'none'",
    "base-uri 'none'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' ${TURNSTILE_ORIGIN}`,
    "style-src 'self'",
    `img-src ${imgSources}`,
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `frame-src ${TURNSTILE_ORIGIN}`,
    "object-src 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ];
  if (env.ENVIRONMENT !== 'development') directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  const nonce = randomToken(16);
  c.set('nonce', nonce);

  await next();

  const h = c.res.headers;
  const isHtml = (h.get('Content-Type') ?? '').includes('text/html');

  // Si la respuesta ya trae CSP viene de la caché del borde, donde cabecera y
  // cuerpo se guardaron juntos con el mismo nonce. Regenerarla aquí rompería la
  // correspondencia y el navegador bloquearía nuestros propios scripts.
  if (isHtml && !h.has('Content-Security-Policy')) {
    h.set('Content-Security-Policy', buildCsp(nonce, c.env));
  }

  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('X-Frame-Options', 'DENY');
  h.set(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()',
  );
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  h.set('X-Permitted-Cross-Domain-Policies', 'none');

  if (c.env.ENVIRONMENT !== 'development') {
    // HSTS: sólo tiene sentido sobre TLS. Cloudflare SSL/TLS debe estar en
    // modo Full (Strict) para que esto sea honesto (ver README).
    h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Nunca revelamos la pila.
  h.delete('X-Powered-By');
  h.delete('Server');
});
