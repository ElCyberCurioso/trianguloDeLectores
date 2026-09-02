import type { Bindings } from '../../types/env';
import type { RateLimitDecision } from '../../do/rate-limiter';

export interface RateRule {
  limit: number;
  windowMs: number;
  /** bloqueo adicional al superar el límite */
  penaltyMs?: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Reglas por endpoint. Complementan (no sustituyen) a las Rate Limiting Rules
 * configuradas en el dashboard de Cloudflare, que actúan en el borde antes de
 * llegar al Worker. Ver README > WAF.
 */
export const RATE_RULES: Record<string, RateRule> & {
  login: RateRule; loginGlobal: RateRule; comment: RateRule; report: RateRule;
  upload: RateRule; adminWrite: RateRule; publicApi: RateRule; import: RateRule;
  recommendation: RateRule;
} = {
  login: { limit: 5, windowMs: 15 * MINUTE, penaltyMs: 15 * MINUTE },
  loginGlobal: { limit: 50, windowMs: HOUR, penaltyMs: 10 * MINUTE },
  comment: { limit: 5, windowMs: 10 * MINUTE, penaltyMs: 10 * MINUTE },
  report: { limit: 10, windowMs: HOUR, penaltyMs: HOUR },
  upload: { limit: 30, windowMs: HOUR },
  /*
   * Importación masiva del catálogo. El límite de subida son 30 por hora, y
   * traer 229 libros con sus portadas lo agotaría en el primer minuto. Es una
   * ruta sólo para administradores y con techo igualmente: 1.500 por hora deja
   * hacer la importación entera de una vez y sigue siendo un límite.
   */
  import: { limit: 1500, windowMs: HOUR },
  adminWrite: { limit: 120, windowMs: MINUTE },
  publicApi: { limit: 120, windowMs: MINUTE },
  // Recomendar es un acto ocasional: cinco por hora sobran de largo.
  recommendation: { limit: 5, windowMs: HOUR, penaltyMs: HOUR },
};

export type RateScope =
  | 'login' | 'loginGlobal' | 'comment' | 'report' | 'upload' | 'adminWrite' | 'publicApi'
  | 'recommendation' | 'import';

function stubFor(env: Bindings, scope: RateScope, identity: string) {
  const id = env.RATE_LIMITER.idFromName(`${scope}:${identity}`);
  return env.RATE_LIMITER.get(id);
}

/** Consume una unidad de cuota. */
export async function enforceRateLimit(
  env: Bindings,
  scope: RateScope,
  identity: string,
): Promise<RateLimitDecision> {
  const rule = RATE_RULES[scope];
  try {
    return await stubFor(env, scope, identity).check(rule.limit, rule.windowMs, rule.penaltyMs ?? 0);
  } catch {
    // Fail-open controlado: si el DO no responde no tumbamos el sitio, pero el
    // WAF y las Rate Limiting Rules del borde siguen activos.
    return { allowed: true, remaining: rule.limit, resetAt: Date.now() + rule.windowMs, retryAfterSeconds: 0 };
  }
}

export async function resetRateLimit(env: Bindings, scope: RateScope, identity: string): Promise<void> {
  try {
    await stubFor(env, scope, identity).reset();
  } catch {
    /* no crítico */
  }
}

export function rateLimitHeaders(d: RateLimitDecision, rule: RateRule): Record<string, string> {
  const headers: Record<string, string> = {
    'RateLimit-Limit': String(rule.limit),
    'RateLimit-Remaining': String(d.remaining),
    'RateLimit-Reset': String(Math.max(0, Math.ceil((d.resetAt - Date.now()) / 1000))),
  };
  if (!d.allowed) headers['Retry-After'] = String(Math.max(1, d.retryAfterSeconds));
  return headers;
}
