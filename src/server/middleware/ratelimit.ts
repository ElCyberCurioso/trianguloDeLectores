import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../../types/env';
import { enforceRateLimit, rateLimitHeaders, RATE_RULES, type RateScope } from '../lib/ratelimit';
import { clientIp, tooMany } from '../lib/http';
import { pseudonymize } from '../lib/crypto';

/**
 * Rate limiting por endpoint apoyado en Durable Objects.
 * La identidad por defecto es la IP **pseudonimizada** (HMAC + pepper): limitamos
 * sin guardar ni propagar la IP en claro.
 */
export function rateLimit(scope: RateScope, identityFn?: (c: Context<AppEnv>) => string | null) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const raw = identityFn?.(c) ?? clientIp(c) ?? 'anonymous';
    const identity = (await pseudonymize(raw, c.env.HASH_PEPPER)) ?? raw;

    const decision = await enforceRateLimit(c.env, scope, identity);
    const headers = rateLimitHeaders(decision, RATE_RULES[scope]);
    for (const [k, v] of Object.entries(headers)) c.header(k, v);

    if (!decision.allowed) {
      c.get('container').log.warn('rate_limited', { scope, path: new URL(c.req.url).pathname });
      throw tooMany('Has hecho demasiadas peticiones. Inténtalo más tarde.', decision.retryAfterSeconds);
    }
    await next();
  });
}
