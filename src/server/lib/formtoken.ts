import type { Bindings } from '../../types/env';
import { hmacHex, timingSafeEqual } from './crypto';

/**
 * Token anti-CSRF **sin estado** para formularios públicos (comentarios y
 * reportes anónimos). No hay sesión donde anclar un token sincronizador, así que
 * se firma con HMAC + pepper y caduca. Se combina siempre con:
 *   - comprobación de Origin/Sec-Fetch-Site,
 *   - Turnstile,
 *   - rate limiting por Durable Object.
 */

const TTL_MS = 6 * 60 * 60 * 1000; // 6 h

function secret(env: Bindings): string {
  return env.HASH_PEPPER ?? 'dev-pepper-no-secret-configured';
}

export async function issueFormToken(env: Bindings, scope: string): Promise<string> {
  const exp = Date.now() + TTL_MS;
  const mac = await hmacHex(secret(env), `${scope}|${exp}`);
  return `${exp}.${mac.slice(0, 32)}`;
}

export async function verifyFormToken(env: Bindings, scope: string, token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const [expPart, mac] = token.split('.');
  if (!expPart || !mac) return false;
  const exp = Number(expPart);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = (await hmacHex(secret(env), `${scope}|${exp}`)).slice(0, 32);
  return timingSafeEqual(mac, expected);
}
