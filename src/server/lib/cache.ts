import type { Context } from 'hono';
import type { AppEnv, Bindings } from '../../types/env';
import { buildCsp } from '../middleware/security';

/**
 * Estrategia de caché.
 *
 * 1) Cache API del borde (`caches.default`) para respuestas GET públicas.
 * 2) Invalidación por **versionado de cache key**: la clave incluye un sello de
 *    versión guardado en KV. Publicar/editar una reseña incrementa el sello, con
 *    lo que todas las entradas antiguas quedan inalcanzables al instante. Es la
 *    alternativa correcta a purgar por tag, que requiere plan Enterprise.
 * 3) Nada autenticado o privado entra jamás en caché (ver `isCacheable`).
 */

export const CACHE_NS = {
  reviews: 'reviews',
  taxonomy: 'taxonomy',
  comments: 'comments',
  watchlist: 'watchlist',
} as const;

export type CacheNamespace = (typeof CACHE_NS)[keyof typeof CACHE_NS];

const versionMemo = new Map<string, string>();

export async function getCacheVersion(env: Bindings, ns: CacheNamespace): Promise<string> {
  const memoKey = `${env.ENVIRONMENT}:${ns}`;
  const memo = versionMemo.get(memoKey);
  if (memo) return memo;
  const value = (await env.CACHE.get(`cachever:${ns}`).catch(() => null)) ?? '1';
  versionMemo.set(memoKey, value);
  return value;
}

/** Invalida todo el contenido cacheado de un namespace. */
export async function bumpCacheVersion(env: Bindings, ns: CacheNamespace): Promise<void> {
  const next = String(Date.now());
  versionMemo.set(`${env.ENVIRONMENT}:${ns}`, next);
  await env.CACHE.put(`cachever:${ns}`, next).catch(() => undefined);
}

export async function invalidatePublicContent(env: Bindings): Promise<void> {
  await Promise.all([
    bumpCacheVersion(env, CACHE_NS.reviews),
    bumpCacheVersion(env, CACHE_NS.comments),
  ]);
}

/** La lista de pendientes tiene su propio sello: cambia por su cuenta. */
export async function invalidateWatchlist(env: Bindings): Promise<void> {
  await bumpCacheVersion(env, CACHE_NS.watchlist);
}

/** Una petición sólo es cacheable si es GET público y sin credenciales. */
export function isCacheable(c: Context<AppEnv>): boolean {
  if (c.req.method !== 'GET') return false;
  if (c.get('user')) return false;
  const cookie = c.req.header('Cookie') ?? '';
  if (cookie.includes('tdl_session')) return false;
  if (c.req.header('Authorization')) return false;
  const path = new URL(c.req.url).pathname;
  return !path.startsWith('/admin') && !path.startsWith('/api/admin');
}

export interface EdgeCacheOptions {
  ns: CacheNamespace;
  /** TTL en el borde (s-maxage) */
  edgeTtl: number;
  /** TTL en el navegador (max-age) */
  browserTtl: number;
  /** stale-while-revalidate en segundos */
  swr?: number;
}

export function cacheControlFor(o: EdgeCacheOptions): string {
  return [
    'public',
    `max-age=${o.browserTtl}`,
    `s-maxage=${o.edgeTtl}`,
    `stale-while-revalidate=${o.swr ?? o.edgeTtl}`,
  ].join(', ');
}

export const NO_STORE = 'no-store, no-cache, must-revalidate, private';

/**
 * Envuelve un handler GET público con la Cache API del borde.
 * Devuelve `null` cuando la petición no es cacheable (el llamante sigue normal).
 */
export async function edgeCached(
  c: Context<AppEnv>,
  opts: EdgeCacheOptions,
  produce: () => Promise<Response>,
): Promise<Response> {
  if (!isCacheable(c)) {
    const res = await produce();
    res.headers.set('Cache-Control', NO_STORE);
    return res;
  }

  const version = await getCacheVersion(c.env, opts.ns);
  const url = new URL(c.req.url);
  // La clave normaliza el orden de los query params: evita envenenar/duplicar
  // caché con permutaciones equivalentes y con parámetros desconocidos.
  const params = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const keyUrl = new URL(url.origin + url.pathname);
  for (const [k, v] of params) keyUrl.searchParams.append(k, v);
  keyUrl.searchParams.set('__v', version);

  const cacheKey = new Request(keyUrl.toString(), { method: 'GET' });
  const cache = caches.default;

  const hit = await cache.match(cacheKey);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set('X-Cache', 'HIT');
    return res;
  }

  const fresh = await produce();
  if (fresh.status === 200) {
    // La CSP se adjunta AQUÍ, antes de guardar: cabecera y cuerpo entran juntos
    // en la caché, así que el nonce del HTML siempre casa con el de la política.
    // El precio es que una página cacheada comparte nonce durante su TTL; a
    // cambio, el sitio público puede servirse desde el borde con una CSP
    // estricta y sin `unsafe-inline`. Las páginas privadas (panel, peticiones
    // autenticadas) nunca se cachean y conservan un nonce por petición.
    if ((fresh.headers.get('Content-Type') ?? '').includes('text/html')) {
      fresh.headers.set('Content-Security-Policy', buildCsp(c.get('nonce'), c.env));
    }
    fresh.headers.set('Cache-Control', cacheControlFor(opts));
    fresh.headers.set('X-Cache', 'MISS');
    // Vary: sin él, un cambio de tema o idioma podría servir la variante errónea.
    fresh.headers.append('Vary', 'Accept-Encoding');
    const write = cache.put(cacheKey, fresh.clone()).catch(() => undefined);
    if (c.env.ENVIRONMENT === 'development') {
      // En desarrollo y en los tests se espera la escritura: Miniflare no cierra
      // el worker mientras haya trabajo de `waitUntil` sin resolver, y además
      // así las aserciones sobre la caché son deterministas.
      await write;
    } else {
      // En staging y producción la persona no debe esperar a que se guarde la
      // copia en caché: se hace después de responder.
      c.executionCtx.waitUntil(write);
    }
  } else {
    fresh.headers.set('Cache-Control', NO_STORE);
  }
  return fresh;
}
