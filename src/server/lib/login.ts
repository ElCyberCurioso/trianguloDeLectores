import type { Context } from 'hono';
import type { AppEnv } from '../../types/env';
import { clientIp } from './http';
import { verifyPassword, hashPassword, pseudonymize, PBKDF2_ITERATIONS } from './crypto';
import { createSession, writeSessionCookie, revokeAllUserSessions } from './auth';
import { verifyTurnstile } from './turnstile';
import { enforceRateLimit, resetRateLimit } from './ratelimit';
import { loginSchema } from '../../validation/schemas';
import * as F from './form';

/**
 * Autenticación por contraseña, compartida por el panel y por el subdominio de
 * la biblioteca. Está aquí y no duplicada en cada ruta porque cada copia sería
 * una oportunidad de que a una se le olvide el señuelo, el bloqueo o la
 * rotación de sesión.
 *
 * Lo que hace, en orden:
 *   1. límite global además del límite por IP (frena credential stuffing
 *      distribuido, que el límite por IP no ve);
 *   2. Turnstile si está activado en los ajustes;
 *   3. hash señuelo cuando la cuenta no existe, para que el tiempo de respuesta
 *      no diga si el email está registrado;
 *   4. bloqueo temporal por intentos fallidos;
 *   5. rehash transparente si suben los parámetros de coste;
 *   6. revocación de las sesiones previas antes de crear la nueva
 *      (anti session fixation).
 */

/** Hash inválido con los parámetros reales: iguala el coste del login fallido. */
const DUMMY_HASH = `pbkdf2$sha256$${PBKDF2_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;

export const LOCK_AFTER_FAILURES = 5;
export const LOCK_MS = 15 * 60 * 1000;

export type LoginOutcome =
  | { ok: true; userId: string }
  | { ok: false; message: string };

export interface LoginOptions {
  /**
   * Exigir la comprobación anti-bot cuando esté activada en los ajustes. Por
   * omisión sí.
   *
   * El subdominio de la biblioteca pasa `false` porque **su formulario no pinta
   * el widget**: se dejó fuera para no meter un tercero en su CSP. Con el valor
   * por omisión, ese login exigía un token que nadie podía generar y devolvía
   * 401 siempre, con un mensaje que hablaba de un recuadro inexistente.
   *
   * Quitarlo no lo deja a la intemperie: siguen el límite de 5 intentos por IP
   * cada 15 minutos, el límite global de 50 por hora, el bloqueo de la cuenta
   * tras 5 fallos y `SameSite=Strict` en la cookie.
   */
  requireTurnstile?: boolean;

  /**
   * Cerrar el resto de sesiones de esa persona al entrar. Por omisión sí: en el
   * panel es la política deseada, porque entrar desde un sitio nuevo debe dejar
   * fuera al anterior.
   *
   * El subdominio de la biblioteca pasa `false`. Comparte la tabla de usuarios
   * con el panel, así que con la política de siempre abrir uno cerraba el otro,
   * y son dos aplicaciones distintas que se usan a la vez. La protección contra
   * session fixation no depende de esto: la da crear una sesión nueva con
   * identificador nuevo al autenticar, que se hace en los dos casos.
   */
  revokeOtherSessions?: boolean;

  /**
   * Crear la sesión de navegador y escribir su cookie. Por omisión sí.
   *
   * La API de la aplicación Android pasa `false`: allí la credencial no es una
   * cookie sino un token de dispositivo, con otra caducidad y revocable por
   * separado. Lo que sí quiere es **todo lo demás** de esta función —límite
   * global, hash señuelo, bloqueo por intentos, rehash, registro de auditoría—,
   * que es justo el motivo de que la autenticación viva en un sitio y no
   * copiada en cada ruta.
   */
  establishSession?: boolean;
}

export async function attemptLogin(
  c: Context<AppEnv>,
  body: Record<string, string | File | (string | File)[]>,
  options: LoginOptions = {},
): Promise<LoginOutcome> {
  const container = c.get('container');
  const ip = clientIp(c);

  const globalDecision = await enforceRateLimit(c.env, 'loginGlobal', 'all');
  if (!globalDecision.allowed) {
    container.log.warn('login_global_limit');
    return { ok: false, message: 'Demasiados intentos de acceso. Inténtalo dentro de unos minutos.' };
  }

  const parsed = loginSchema.safeParse({
    email: F.strOrEmpty(body, 'email', 254),
    password: F.strOrEmpty(body, 'password', 200),
    turnstileToken: F.str(body, 'cf-turnstile-response', 2048),
  });
  if (!parsed.success) return { ok: false, message: 'Revisa el email y la contraseña.' };

  const settings = await container.settings.all();
  if (shouldCheckTurnstile(options, settings['security.turnstile_login'])) {
    const verdict = await verifyTurnstile(c.env, parsed.data.turnstileToken, ip, c.get('requestId'));
    if (!verdict.success) {
      container.log.warn('login_turnstile_failed', { errorCodes: verdict.errorCodes });
      return { ok: false, message: turnstileMessageForCodes(verdict.errorCodes) };
    }
  }

  const ipHash = await pseudonymize(ip, c.env.HASH_PEPPER);
  const user = await container.users.findByEmail(parsed.data.email);

  if (!user || user.status !== 'ACTIVE') {
    await verifyPassword(parsed.data.password, DUMMY_HASH);
    await container.audit.record({
      actorId: null, actorRole: null, action: 'auth.login.failure',
      metadata: { reason: 'unknown_user' }, ipHash,
    });
    return { ok: false, message: 'Credenciales incorrectas.' };
  }

  if (user.lockedUntil && user.lockedUntil > Date.now()) {
    await container.audit.record({ actorId: user.id, actorRole: user.role, action: 'auth.locked', ipHash });
    return { ok: false, message: 'Cuenta bloqueada temporalmente por intentos fallidos. Prueba en unos minutos.' };
  }

  const check = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!check.valid) {
    await container.users.registerFailedLogin(user.id, LOCK_AFTER_FAILURES, LOCK_MS);
    await container.audit.record({
      actorId: user.id, actorRole: user.role, action: 'auth.login.failure',
      metadata: { reason: 'bad_password' }, ipHash,
    });
    return { ok: false, message: 'Credenciales incorrectas.' };
  }

  if (check.needsRehash) {
    await container.users.updatePasswordHash(user.id, await hashPassword(parsed.data.password));
  }

  if (options.establishSession !== false) {
    if (options.revokeOtherSessions !== false) await revokeAllUserSessions(c.env, user.id);
    const session = await createSession(c.env, user.id, { ip, userAgent: c.req.header('User-Agent') ?? null });
    writeSessionCookie(c, session);
  }

  await container.users.registerSuccessfulLogin(user.id);
  await resetRateLimit(c.env, 'login', (await pseudonymize(ip, c.env.HASH_PEPPER)) ?? ip ?? 'anonymous');
  await container.audit.record({
    actorId: user.id, actorRole: user.role, action: 'auth.login.success', ipHash,
  });

  return { ok: true, userId: user.id };
}

/**
 * ¿Hay que exigir la comprobación anti-bot en este login?
 *
 * Dos condiciones, y las dos importan: que esté activada en los ajustes y que
 * el formulario que la envía pinte de verdad el widget. La segunda se olvidó al
 * montar el subdominio de la biblioteca, cuyo formulario no lo pinta, y el
 * resultado fue un 401 en cada intento contra un recuadro inexistente.
 */
export function shouldCheckTurnstile(options: LoginOptions, enabledInSettings: boolean): boolean {
  return options.requireTurnstile !== false && enabledInSettings;
}

/**
 * Qué contarle a quien no ha pasado la comprobación.
 *
 * Antes todo desembocaba en «no hemos podido verificar la comprobación
 * anti-bot», que ante el caso más frecuente —el recuadro ni siquiera aparece
 * porque una extensión bloquea el script de Cloudflare— es un callejón sin
 * salida: no se ve nada, no se puede entrar y el mensaje no dice qué hacer.
 * Los códigos vienen de la verificación en servidor, así que no son un dato del
 * cliente y se pueden usar para afinar el mensaje.
 */
export function turnstileMessageForCodes(errorCodes: string[]): string {
  if (errorCodes.includes('missing-input-response')) {
    return (
      'No se ha completado la comprobación anti-bot. Si no ves el recuadro de Cloudflare, ' +
      'lo más probable es que lo bloquee una extensión del navegador o el bloqueo de rastreadores: ' +
      'desactívalo para este sitio y recarga la página.'
    );
  }
  if (errorCodes.includes('timeout-or-duplicate')) {
    return 'La comprobación anti-bot ha caducado. Recarga la página e inténtalo de nuevo.';
  }
  if (errorCodes.includes('missing-secret') || errorCodes.includes('invalid-input-secret')) {
    // Configuración del servidor, no culpa de quien entra. El detalle va al log.
    return 'La comprobación anti-bot está mal configurada en el servidor. Avisa al administrador.';
  }
  return 'No hemos podido verificar la comprobación anti-bot. Recarga la página e inténtalo de nuevo.';
}
