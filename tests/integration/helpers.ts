import { env, SELF } from 'cloudflare:test';
import { hashPassword, pseudonymize } from '../../src/server/lib/crypto';
import { issueFormToken } from '../../src/server/lib/formtoken';

export const ORIGIN = 'http://localhost:8787';
export const ADMIN_EMAIL = 'admin@test.local';
export const ADMIN_PASSWORD = 'ClaveDePruebas123';

export const CATEGORY_ID = '11111111-1111-4111-8111-000000000002';
export const GENRE_ID = '22222222-2222-4222-8222-000000000001';
export const PLATFORM_ID = '33333333-3333-4333-8333-000000000001';

let adminId: string | null = null;

/** Crea el usuario administrador y la taxonomía mínima. Idempotente. */
export async function seedBaseData(): Promise<string> {
  const now = Date.now();

  if (!adminId) adminId = crypto.randomUUID();
  // Iteraciones bajas: en los tests interesa la lógica, no el coste del KDF.
  const hash = await hashPassword(ADMIN_PASSWORD, 1000);

  await env.DB.prepare(
    `INSERT OR REPLACE INTO users
       (id, email, email_norm, password_hash, display_name, role, status,
        failed_logins, locked_until, last_login_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Administración', 'ADMIN', 'ACTIVE', 0, NULL, NULL, ?, ?)`,
  )
    .bind(adminId, ADMIN_EMAIL, ADMIN_EMAIL, hash, now, now)
    .run();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO categories (id, slug, name, sort_order, is_active, created_at, updated_at)
       VALUES (?, 'peliculas', 'Películas', 10, 1, ?, ?)`,
    ).bind(CATEGORY_ID, now, now),
    env.DB.prepare(
      `INSERT OR IGNORE INTO genres (id, slug, name, created_at, updated_at)
       VALUES (?, 'ciencia-ficcion', 'Ciencia ficción', ?, ?)`,
    ).bind(GENRE_ID, now, now),
    env.DB.prepare(
      `INSERT OR IGNORE INTO platforms (id, slug, name, kind, base_url, is_active, sort_order, created_at, updated_at)
       VALUES (?, 'netflix', 'Netflix', 'STREAMING', 'https://www.netflix.com', 1, 10, ?, ?)`,
    ).bind(PLATFORM_ID, now, now),
  ]);

  return adminId;
}

export interface AdminSession {
  cookie: string;
  csrf: string;
}

/** Hace login real por HTTP y devuelve la cookie de sesión y el token CSRF. */
export async function loginAsAdmin(): Promise<AdminSession> {
  await seedBaseData();

  const body = new URLSearchParams({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const response = await SELF.fetch(`${ORIGIN}/admin/login`, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
      // Cada login de test viene de una IP distinta: el rate limit de login es
      // real (5 intentos / 15 min por IP) y si no, la propia suite lo dispararia.
      'CF-Connecting-IP': `192.0.2.${Math.floor(Math.random() * 250) + 1}`,
    },
    redirect: 'manual',
  });

  if (response.status !== 303) {
    throw new Error(`Login fallido: ${response.status} ${await response.text()}`);
  }

  const setCookie = response.headers.get('Set-Cookie') ?? '';
  const match = /tdl_session=([^;]+)/.exec(setCookie);
  if (!match) throw new Error('No se ha recibido la cookie de sesión');
  const cookie = `tdl_session=${match[1]}`;

  const csrf = await readCsrfToken(cookie);
  return { cookie, csrf };
}

/** Extrae el token CSRF de cualquier formulario del panel. */
export async function readCsrfToken(cookie: string): Promise<string> {
  const page = await SELF.fetch(`${ORIGIN}/admin`, {
    headers: { Cookie: cookie, Accept: 'text/html' },
  });
  const html = await page.text();
  const match = /name="_csrf" value="([^"]+)"/.exec(html);
  if (!match) throw new Error('No se ha encontrado el token CSRF en el panel');
  return match[1]!;
}

export interface CreateReviewOptions {
  title?: string;
  status?: 'DRAFT' | 'PUBLISHED';
  rating?: number;
  hasSpoilers?: boolean;
  extra?: Record<string, string>;
}

/** Crea una reseña a través del panel (misma ruta que usa una persona). */
export async function createReview(
  session: AdminSession,
  options: CreateReviewOptions = {},
): Promise<{ id: string; slug: string }> {
  const body = new URLSearchParams({
    _csrf: session.csrf,
    titleEs: options.title ?? 'Dune',
    contentType: 'MOVIE',
    categoryId: CATEGORY_ID,
    year: '2021',
    creator: 'Denis Villeneuve',
    rating: String(options.rating ?? 9),
    status: options.status ?? 'PUBLISHED',
    commentsMode: 'INHERIT',
    summary: 'Una adaptación monumental.',
    bodyHtml: '<p>Texto de la reseña</p>',
    genreIds: GENRE_ID,
    platform_id: PLATFORM_ID,
    platform_availability: 'SUBSCRIPTION',
    platform_url: 'https://www.netflix.com/title/1',
    platform_note: '',
    ...(options.hasSpoilers ? { hasSpoilers: '1' } : {}),
    ...(options.extra ?? {}),
  });

  const response = await SELF.fetch(`${ORIGIN}/admin/resenas/nueva`, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: session.cookie,
      Origin: ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
    },
    redirect: 'manual',
  });

  if (response.status !== 303) {
    throw new Error(`No se ha creado la reseña: ${response.status} ${await response.text()}`);
  }

  const location = response.headers.get('Location') ?? '';
  const id = /\/admin\/resenas\/([0-9a-f-]{36})/.exec(location)?.[1];
  if (!id) throw new Error(`Location inesperada: ${location}`);

  const row = await env.DB.prepare('SELECT slug FROM reviews WHERE id = ?').bind(id).first<{ slug: string }>();
  return { id, slug: row!.slug };
}

/** Token de formulario público (comentarios/reportes) leído de la página. */
export async function readFormToken(slug: string): Promise<string> {
  const page = await SELF.fetch(`${ORIGIN}/resena/${slug}`, { headers: { Accept: 'text/html' } });
  const html = await page.text();
  const match = /name="_form" value="([^"]+)"/.exec(html);
  if (!match) throw new Error('No se ha encontrado el token del formulario público');
  return match[1]!;
}

/**
 * Emite un token de formulario válido sin pasar por la página.
 * Necesario cuando la reseña tiene los comentarios cerrados: entonces la página
 * no pinta formulario, pero seguimos queriendo probar la política de servidor.
 */
export function mintFormToken(reviewId: string): Promise<string> {
  return issueFormToken(env, `comment:${reviewId}`);
}

/**
 * Vacía el limitador de escrituras del panel.
 *
 * La suite hace en segundos lo que una persona haría en horas, y todos los
 * ficheros comparten el mismo administrador. El límite real (120 escrituras por
 * minuto) tiene su propio test; aquí sólo estorbaría.
 */
export async function resetAdminRateLimit(): Promise<void> {
  const identidad = (await pseudonymize(adminId ?? '', env.HASH_PEPPER)) ?? adminId ?? 'anonymous';
  const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(`adminWrite:${identidad}`));
  await stub.reset();
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
  )
    .bind(key, JSON.stringify(value), Date.now())
    .run();
  // La caché de ajustes vive en KV: se purga para que el cambio surta efecto.
  await env.CACHE.delete('settings:v1');
}
