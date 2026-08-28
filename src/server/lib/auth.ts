import { eq, and, lt } from 'drizzle-orm';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { getDb } from '../../db/client';
import { sessions, users } from '../../db/schema';
import type { AppEnv, Bindings } from '../../types/env';
import { randomToken, sha256Hex, timingSafeEqual, pseudonymize } from './crypto';

export const SESSION_COOKIE = 'tdl_session';

/**
 * Nombre real de la cookie de sesión.
 *
 * Fuera de desarrollo lleva el prefijo `__Host-`, que el navegador sólo acepta
 * si la cookie va con `Secure`, con `Path=/` y **sin `Domain`**. Eso la ata al
 * origen exacto: un subdominio comprometido —staging, por ejemplo— no puede
 * escribir la cookie de sesión del dominio principal. En desarrollo se sirve por
 * http, donde ese prefijo es inválido, así que allí se usa el nombre llano.
 */
export function sessionCookieName(env: Pick<Bindings, 'ENVIRONMENT'>): string {
  return env.ENVIRONMENT === 'development' ? SESSION_COOKIE : `__Host-${SESSION_COOKIE}`;
}
/** Identificador anónimo y rotativo para deduplicar reportes sin guardar PII. */
export const REPORTER_COOKIE = 'tdl_rid';

/** Inactividad máxima antes de caducar la sesión. */
export const IDLE_TTL_MS = 2 * 60 * 60 * 1000; // 2 h
/** Techo absoluto: no se renueva jamás, obliga a re-autenticar. */
export const ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000; // 12 h
const REPORTER_TTL_S = 180 * 24 * 60 * 60; // 180 días

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: 'ADMIN' | 'USER';
}

export interface EstablishedSession {
  token: string;
  csrfToken: string;
  sessionId: string;
  expiresAt: number;
}

function cookieOptions(env: Bindings) {
  const secure = env.ENVIRONMENT !== 'development';
  return {
    httpOnly: true,
    secure,
    sameSite: 'Strict' as const,
    path: '/',
  };
}

/**
 * Crea una sesión nueva. El identificador persistido es SHA-256(token): si
 * alguien lee la base de datos no obtiene cookies utilizables.
 * Llamar SIEMPRE después de autenticar (rotación de sesión anti session-fixation).
 */
export async function createSession(
  env: Bindings,
  userId: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<EstablishedSession> {
  const token = randomToken(32);
  const sessionId = await sha256Hex(token);
  const csrfToken = randomToken(32);
  const now = Date.now();

  await getDb(env).insert(sessions).values({
    id: sessionId,
    userId,
    csrfSecret: csrfToken,
    ipHash: await pseudonymize(meta.ip, env.HASH_PEPPER),
    uaHash: await pseudonymize(meta.userAgent, env.HASH_PEPPER),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + IDLE_TTL_MS,
    absoluteExp: now + ABSOLUTE_TTL_MS,
  });

  return { token, csrfToken, sessionId, expiresAt: now + IDLE_TTL_MS };
}

export interface ResolvedSession {
  user: SessionUser;
  sessionId: string;
  csrfSecret: string;
}

/** Resuelve la cookie a un usuario, aplicando caducidad deslizante y absoluta. */
export async function resolveSession(env: Bindings, token: string | undefined): Promise<ResolvedSession | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const sessionId = await sha256Hex(token);
  const db = getDb(env);

  const row = await db
    .select({
      sid: sessions.id,
      csrfSecret: sessions.csrfSecret,
      expiresAt: sessions.expiresAt,
      absoluteExp: sessions.absoluteExp,
      revokedAt: sessions.revokedAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .get();

  if (!row) return null;

  const now = Date.now();
  if (row.revokedAt || row.expiresAt < now || row.absoluteExp < now || row.status !== 'ACTIVE') {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  // Renovación deslizante perezosa: sólo se escribe si ha pasado >5 min,
  // para no hacer un write en D1 por cada petición.
  if (now - row.lastSeenAt > 5 * 60 * 1000) {
    const nextExpiry = Math.min(now + IDLE_TTL_MS, row.absoluteExp);
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: nextExpiry })
      .where(eq(sessions.id, sessionId));
  }

  return {
    sessionId,
    csrfSecret: row.csrfSecret,
    user: {
      id: row.userId,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
    },
  };
}

export async function revokeSession(env: Bindings, sessionId: string): Promise<void> {
  await getDb(env).delete(sessions).where(eq(sessions.id, sessionId));
}

export async function revokeAllUserSessions(env: Bindings, userId: string): Promise<void> {
  await getDb(env).delete(sessions).where(eq(sessions.userId, userId));
}

/** Limpieza de sesiones caducadas (cron/mantenimiento). */
export async function purgeExpiredSessions(env: Bindings): Promise<void> {
  await getDb(env).delete(sessions).where(and(lt(sessions.expiresAt, Date.now())));
}

export function writeSessionCookie(c: Context<AppEnv>, session: EstablishedSession): void {
  setCookie(c, sessionCookieName(c.env), session.token, {
    ...cookieOptions(c.env),
    maxAge: Math.floor(ABSOLUTE_TTL_MS / 1000),
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, sessionCookieName(c.env), { ...cookieOptions(c.env) });
}

export function readSessionCookie(c: Context<AppEnv>): string | undefined {
  return getCookie(c, sessionCookieName(c.env));
}

/**
 * Identidad anónima para deduplicar reportes. No es PII: es un valor aleatorio
 * que sólo sirve para "esta misma persona ya reportó este comentario".
 */
export function getOrCreateReporterId(c: Context<AppEnv>): string {
  const existing = getCookie(c, REPORTER_COOKIE);
  if (existing && /^[A-Za-z0-9_-]{20,64}$/.test(existing)) return existing;
  const fresh = randomToken(16);
  setCookie(c, REPORTER_COOKIE, fresh, { ...cookieOptions(c.env), sameSite: 'Lax', maxAge: REPORTER_TTL_S });
  return fresh;
}

/** Token CSRF sincronizador: se compara en tiempo constante con el de la sesión. */
export function verifyCsrf(provided: string | undefined | null, expected: string | null): boolean {
  if (!provided || !expected) return false;
  return timingSafeEqual(provided, expected);
}
