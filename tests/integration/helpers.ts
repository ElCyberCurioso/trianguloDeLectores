import { env, SELF } from 'cloudflare:test';
import { hashPassword, pseudonymize } from '../../src/server/lib/crypto';
import { issueFormToken } from '../../src/server/lib/formtoken';
import { scoreToHalf } from '../../src/types/domain';

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
  /** La nota tal como se escribe: de 0 a 10, admite medio punto. */
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
    ratingHalf: String(scoreToHalf(options.rating ?? 9)),
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

// ------------------------------------------------- biblioteca privada --
export const BOOKS_ORIGIN = 'http://books.localhost:8787';

/**
 * Login en el subdominio de la biblioteca.
 *
 * Es una sesión distinta de la del panel a propósito: la cookie lleva prefijo
 * `__Host-`, que la ata al host exacto. Que haga falta este helper aparte es
 * justo la propiedad que se quiere.
 */
export async function loginAsBooks(): Promise<AdminSession> {
  await seedBaseData();

  const body = new URLSearchParams({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const response = await SELF.fetch(`${BOOKS_ORIGIN}/login`, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: BOOKS_ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
      'CF-Connecting-IP': `192.0.2.${Math.floor(Math.random() * 250) + 1}`,
    },
    redirect: 'manual',
  });

  if (response.status !== 303) {
    throw new Error(`Login de biblioteca fallido: ${response.status} ${await response.text()}`);
  }

  const match = /tdl_session=([^;]+)/.exec(response.headers.get('Set-Cookie') ?? '');
  if (!match) throw new Error('No se ha recibido la cookie de sesión de la biblioteca');
  const cookie = `tdl_session=${match[1]}`;

  const page = await SELF.fetch(`${BOOKS_ORIGIN}/`, { headers: { Cookie: cookie, Accept: 'text/html' } });
  const csrf = /name="_csrf" value="([^"]+)"/.exec(await page.text())?.[1];
  if (!csrf) throw new Error('No se ha encontrado el token CSRF en la biblioteca');
  return { cookie, csrf };
}

/** Cabeceras de una petición autenticada dentro del subdominio. */
export function booksHeaders(session: AdminSession, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Cookie: session.cookie,
    Origin: BOOKS_ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    'X-CSRF-Token': session.csrf,
    Accept: 'application/json',
    ...extra,
  };
}

/** PDF mínimo pero válido: cabecera, un objeto y el tráiler. */
export function pdfBytes(marker = 'test'): Uint8Array {
  const source =
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n` +
    `2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n% ${marker}\n` +
    `trailer<</Root 1 0 R>>\n%%EOF\n`;
  const padded = source.padEnd(1024, ' ');
  return new TextEncoder().encode(padded);
}

/** PNG mínimo válido, con las dimensiones escritas en la cabecera IHDR. */
export function pngBytes(width = 400, height = 600): Uint8Array {
  const bytes = new Uint8Array(512);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
