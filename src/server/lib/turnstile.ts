import type { Bindings } from '../../types/env';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult {
  success: boolean;
  /** true si Turnstile está desactivado por configuración (dev/local) */
  skipped: boolean;
  errorCodes: string[];
}

/**
 * Verificación **server-side** de Turnstile. El token del cliente no significa
 * nada hasta que Cloudflare lo valida aquí, y sólo se puede canjear una vez.
 * La clave privada vive en Cloudflare Secrets, nunca en el repositorio.
 */
export async function verifyTurnstile(
  env: Bindings,
  token: string | undefined | null,
  remoteIp: string | null,
  idempotencyKey?: string,
): Promise<TurnstileResult> {
  if (env.TURNSTILE_ENABLED !== 'true') return { success: true, skipped: true, errorCodes: [] };
  if (!env.TURNSTILE_SECRET_KEY) {
    // Configuración incompleta: se falla cerrado, nunca abierto.
    return { success: false, skipped: false, errorCodes: ['missing-secret'] };
  }
  if (!token || token.length > 2048) return { success: false, skipped: false, errorCodes: ['missing-input-response'] };

  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET_KEY);
  body.append('response', token);
  if (remoteIp) body.append('remoteip', remoteIp);
  if (idempotencyKey) body.append('idempotency_key', idempotencyKey);

  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body });
    if (!res.ok) return { success: false, skipped: false, errorCodes: [`http-${res.status}`] };
    const data = (await res.json()) as { success: boolean; 'error-codes'?: string[] };
    return { success: data.success === true, skipped: false, errorCodes: data['error-codes'] ?? [] };
  } catch {
    return { success: false, skipped: false, errorCodes: ['network-error'] };
  }
}
