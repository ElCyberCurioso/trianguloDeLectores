import type { Context } from 'hono';
import { Hono } from 'hono';
import type { AppEnv } from '../../types/env';
import { Layout } from '../views/layout';
import { LoginPage } from '../views/admin/login';
import { DashboardPage } from '../views/admin/dashboard';
import { AdminReviewsPage } from '../views/admin/reviews-list';
import { ReviewEditorPage } from '../views/admin/review-editor';
import { AdminCommentsPage } from '../views/admin/comments';
import { TaxonomyPage } from '../views/admin/taxonomy';
import { SettingsPage } from '../views/admin/settings';
import { RecommendationsPage } from '../views/admin/recommendations';
import { AdminWatchlistPage, WatchlistEditorPage } from '../views/admin/watchlist';
import { requireAdmin, requireCsrf } from '../middleware/auth';
import { rateLimit } from '../middleware/ratelimit';
import { NO_STORE } from '../lib/cache';
import { badRequest, forbidden, notFound, ok } from '../lib/http';
import {
  reviewInputSchema, adminReviewQuerySchema, adminCommentQuerySchema,
  moderationActionSchema, categoryInputSchema, genreInputSchema, platformInputSchema,
  watchlistInputSchema, watchlistQuerySchema, watchlistActionSchema,
  recommendationQuerySchema, recommendationActionSchema,
  fieldErrors,
} from '../../validation/schemas';
import { attemptLogin } from '../lib/login';
import { clearSessionCookie, revokeSession } from '../lib/auth';
import { ReviewService } from '../services/reviews';
import { CommentService } from '../services/comments';
import { MediaService } from '../services/media';
import { StatsService } from '../services/stats';
import { WatchlistService, type WatchlistAction } from '../services/watchlist';
import { RecommendationService } from '../services/recommendations';
import { SettingsSchema, type AppSettings } from '../lib/settings';
import { slugify, uniqueSlug } from '../lib/slug';
import { variantUrl } from '../lib/images';
import * as F from '../lib/form';
import type { CommentStatus, ContentType, Priority } from '../../types/domain';

export const adminRoutes = new Hono<AppEnv>();

/** El panel jamás se cachea ni se indexa. */
adminRoutes.use('*', async (c, next) => {
  await next();
  c.res.headers.set('Cache-Control', NO_STORE);
  c.res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
});

async function adminShell(
  c: Context<AppEnv>,
  title: string,
  node: unknown,
) {
  const stats = new StatsService(c.get('container'));
  const badge = await stats.pendingBadge();
  const user = c.get('user');
  return c.html(
    <Layout
      env={c.env}
      nonce={c.get('nonce')}
      path={new URL(c.req.url).pathname}
      isAdmin
      adminBadge={badge}
      user={user}
      csrfToken={c.get('csrfToken')}
      scripts={['/assets/admin.js']}
      bodyClass="body--admin"
      seo={{
        title: `${title} · ${c.env.SITE_NAME}`,
        description: 'Panel de administración',
        canonical: `${c.env.SITE_URL.replace(/\/$/, '')}/admin`,
        noindex: true,
      }}
    >
      {node as never}
    </Layout>,
  );
}

// =============================================================== LOGIN =====
adminRoutes.get('/login', async (c) => {
  if (c.get('user')?.role === 'ADMIN') return c.redirect('/admin', 302);
  const settings = await c.get('container').settings.all();
  const siteKey =
    c.env.TURNSTILE_ENABLED === 'true' && settings['security.turnstile_login'] ? c.env.TURNSTILE_SITE_KEY : null;

  return c.html(
    <Layout
      env={c.env}
      nonce={c.get('nonce')}
      path={new URL(c.req.url).pathname}
      bodyClass="body--login"
      seo={{
        title: `Acceso · ${c.env.SITE_NAME}`,
        description: 'Acceso al panel de administración',
        canonical: `${c.env.SITE_URL.replace(/\/$/, '')}/admin/login`,
        noindex: true,
      }}
    >
      <LoginPage
        siteName={c.env.SITE_NAME}
        turnstileSiteKey={siteKey}
        next={c.req.query('next')}
        error={c.req.query('error') === '1' ? 'Credenciales incorrectas.' : null}
      />
    </Layout>,
  );
});

adminRoutes.post('/login', rateLimit('login'), async (c) => {
  const body = await c.req.parseBody({ all: true });
  const outcome = await attemptLogin(c, body);
  if (!outcome.ok) return renderLoginError(c, outcome.message);

  const next = F.str(body, 'next', 300);
  const target = next && next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin';
  return c.redirect(target, 303);
});

async function renderLoginError(c: Context<AppEnv>, message: string) {
  const settings = await c.get('container').settings.all();
  const siteKey =
    c.env.TURNSTILE_ENABLED === 'true' && settings['security.turnstile_login'] ? c.env.TURNSTILE_SITE_KEY : null;
  c.status(401);
  return c.html(
    <Layout
      env={c.env}
      nonce={c.get('nonce')}
      path={new URL(c.req.url).pathname}
      bodyClass="body--login"
      seo={{
        title: `Acceso · ${c.env.SITE_NAME}`,
        description: 'Acceso al panel de administración',
        canonical: `${c.env.SITE_URL.replace(/\/$/, '')}/admin/login`,
        noindex: true,
      }}
    >
      <LoginPage siteName={c.env.SITE_NAME} turnstileSiteKey={siteKey} error={message} />
    </Layout>,
  );
}

adminRoutes.post('/logout', requireAdmin, requireCsrf, async (c) => {
  const sessionId = c.get('sessionId');
  const user = c.get('user')!;
  if (sessionId) await revokeSession(c.env, sessionId);
  clearSessionCookie(c);
  await c.get('container').audit.record({
    actorId: user.id, actorRole: user.role, action: 'auth.logout',
  });
  return c.redirect('/admin/login', 303);
});

// ================================================= ZONA AUTENTICADA =======
adminRoutes.use('/*', requireAdmin);
adminRoutes.use('/*', requireCsrf);
adminRoutes.use('/*', rateLimit('adminWrite', {
  identity: (c) => c.get('user')?.id ?? null,
  onlyUnsafeMethods: true,
}));

adminRoutes.get('/', async (c) => {
  const data = await new StatsService(c.get('container')).dashboard();
  return adminShell(c, 'Dashboard', <DashboardPage data={data} />);
});

// ------------------------------------------------------------- reseñas ----
adminRoutes.get('/resenas', async (c) => {
  const container = c.get('container');
  const parsed = adminReviewQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  const query = parsed.success ? parsed.data : adminReviewQuerySchema.parse({});

  const [results, categories] = await Promise.all([
    container.reviews.list({ ...query, includeDrafts: true, statusFilter: query.status }),
    container.taxonomy.listCategories(false),
  ]);

  return adminShell(
    c,
    'Reseñas',
    <AdminReviewsPage
      results={results}
      categories={categories}
      csrfToken={c.get('csrfToken')!}
      query={{ q: query.q, status: query.status, type: query.type, category: query.category, sort: query.sort }}
    />,
  );
});

adminRoutes.get('/resenas/nueva', async (c) => {
  const container = c.get('container');
  const [categories, genres, platforms] = await Promise.all([
    container.taxonomy.listCategories(false),
    container.taxonomy.listGenres(),
    container.taxonomy.listPlatforms(false),
  ]);
  return adminShell(
    c,
    'Nueva reseña',
    <ReviewEditorPage
      env={c.env}
      review={null}
      categories={categories}
      genres={genres}
      platforms={platforms}
      csrfToken={c.get('csrfToken')!}
    />,
  );
});

adminRoutes.get('/resenas/:id', async (c) => {
  const container = c.get('container');
  const review = await container.reviews.getById(c.req.param('id'), { includeDrafts: true });
  if (!review) throw notFound('La reseña no existe');
  const [categories, genres, platforms] = await Promise.all([
    container.taxonomy.listCategories(false),
    container.taxonomy.listGenres(),
    container.taxonomy.listPlatforms(false),
  ]);
  return adminShell(
    c,
    'Editar reseña',
    <ReviewEditorPage
      env={c.env}
      review={review}
      categories={categories}
      genres={genres}
      platforms={platforms}
      csrfToken={c.get('csrfToken')!}
      flash={c.req.query('ok') === '1' ? { kind: 'ok', message: 'Cambios guardados.' } : null}
    />,
  );
});

/** Normaliza el formulario del editor al esquema de dominio. */
async function readReviewForm(c: Context<AppEnv>) {
  const body = await c.req.parseBody({ all: true });

  // Los campos repetidos del bloque "plataformas" llegan alineados por posición.
  // Se usan listas en bruto (con huecos) para no desalinear las columnas, y se
  // descarta cualquier fila sin plataforma seleccionada.
  const ids = F.rawList(body, 'platform_id', 20);
  const urls = F.rawList(body, 'platform_url', 20);
  const availabilities = F.rawList(body, 'platform_availability', 20);
  const notes = F.rawList(body, 'platform_note', 20);

  const platformRows = ids
    .map((platformId, index) => ({
      platformId,
      url: urls[index] ?? '',
      availability: availabilities[index] ?? 'OTHER',
      note: notes[index] ?? '',
    }))
    .filter((row) => row.platformId.length > 0);

  return reviewInputSchema.safeParse({
    titleEs: F.strOrEmpty(body, 'titleEs', 200),
    titleOriginal: F.str(body, 'titleOriginal', 200),
    otherTitles: F.splitList(F.str(body, 'otherTitles', 600)),
    contentType: F.str(body, 'contentType', 20),
    categoryId: F.str(body, 'categoryId', 40) ?? null,
    year: F.num(body, 'year') ?? null,
    creator: F.str(body, 'creator', 200),
    country: F.str(body, 'country', 100),
    durationMin: F.num(body, 'durationMin') ?? null,
    episodes: F.num(body, 'episodes') ?? null,
    volumes: F.num(body, 'volumes') ?? null,
    // La nota viaja en medios puntos: 0..20 son 0,0 a 10,0.
    ratingHalf: F.num(body, 'ratingHalf') ?? 0,
    summary: F.str(body, 'summary', 600),
    bodyHtml: F.strOrEmpty(body, 'bodyHtml', 400_000),
    hasSpoilers: F.bool(body, 'hasSpoilers'),
    status: F.str(body, 'status', 20) ?? 'DRAFT',
    commentsMode: F.str(body, 'commentsMode', 20) ?? 'INHERIT',
    coverKey: F.str(body, 'coverKey', 120) ?? null,
    coverAlt: F.str(body, 'coverAlt', 200),
    seoTitle: F.str(body, 'seoTitle', 70),
    seoDescription: F.str(body, 'seoDescription', 180),
    slug: F.str(body, 'slug', 90),
    genreIds: F.strArray(body, 'genreIds', 20),
    platforms: platformRows.map((row) => ({
      platformId: row.platformId,
      url: row.url,
      availability: row.availability,
      note: row.note || undefined,
    })),
  });
}

adminRoutes.post('/resenas/nueva', async (c) => {
  const container = c.get('container');
  const parsed = await readReviewForm(c);
  if (!parsed.success) {
    const [categories, genres, platforms] = await Promise.all([
      container.taxonomy.listCategories(false),
      container.taxonomy.listGenres(),
      container.taxonomy.listPlatforms(false),
    ]);
    c.status(400);
    return adminShell(
      c,
      'Nueva reseña',
      <ReviewEditorPage
        env={c.env}
        review={null}
        categories={categories}
        genres={genres}
        platforms={platforms}
        csrfToken={c.get('csrfToken')!}
        errors={fieldErrors(parsed.error)}
        flash={{ kind: 'error', message: 'Revisa los campos marcados.' }}
      />,
    );
  }
  const id = await new ReviewService(container).create(parsed.data, c.get('user')!);
  return c.redirect(`/admin/resenas/${id}?ok=1`, 303);
});

adminRoutes.post('/resenas/:id', async (c) => {
  const container = c.get('container');
  const id = c.req.param('id');
  const parsed = await readReviewForm(c);
  if (!parsed.success) {
    const review = await container.reviews.getById(id, { includeDrafts: true });
    if (!review) throw notFound('La reseña no existe');
    const [categories, genres, platforms] = await Promise.all([
      container.taxonomy.listCategories(false),
      container.taxonomy.listGenres(),
      container.taxonomy.listPlatforms(false),
    ]);
    c.status(400);
    return adminShell(
      c,
      'Editar reseña',
      <ReviewEditorPage
        env={c.env}
        review={review}
        categories={categories}
        genres={genres}
        platforms={platforms}
        csrfToken={c.get('csrfToken')!}
        errors={fieldErrors(parsed.error)}
        flash={{ kind: 'error', message: 'Revisa los campos marcados.' }}
      />,
    );
  }
  await new ReviewService(container).update(id, parsed.data, c.get('user')!);
  return c.redirect(`/admin/resenas/${id}?ok=1`, 303);
});

adminRoutes.post('/resenas/:id/estado', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const status = F.str(body, 'status', 20);
  if (status !== 'DRAFT' && status !== 'PUBLISHED') throw badRequest('bad_status', 'Estado no válido');
  await new ReviewService(c.get('container')).setStatus(c.req.param('id'), status, c.get('user')!);
  return c.redirect(c.req.header('Referer')?.includes('/admin/resenas') ? '/admin/resenas' : '/admin', 303);
});

adminRoutes.post('/resenas/:id/duplicar', async (c) => {
  const newId = await new ReviewService(c.get('container')).duplicate(c.req.param('id'), c.get('user')!);
  return c.redirect(`/admin/resenas/${newId}`, 303);
});

adminRoutes.post('/resenas/:id/eliminar', async (c) => {
  await new ReviewService(c.get('container')).remove(c.req.param('id'), c.get('user')!);
  return c.redirect('/admin/resenas', 303);
});

adminRoutes.post('/resenas/:id/restaurar', async (c) => {
  await new ReviewService(c.get('container')).restore(c.req.param('id'), c.get('user')!);
  return c.redirect('/admin/resenas', 303);
});

// --------------------------------------------------------- comentarios ----
adminRoutes.get('/comentarios', async (c) => {
  const container = c.get('container');
  const parsed = adminCommentQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  const query = parsed.success ? parsed.data : adminCommentQuerySchema.parse({});

  const [list, pendingCount, settings] = await Promise.all([
    container.comments.adminList({
      status: query.status as CommentStatus | 'ALL',
      reviewId: query.reviewId,
      q: query.q,
      page: query.page,
      perPage: query.perPage,
    }),
    container.comments.countByStatus('PENDING'),
    container.settings.all(),
  ]);

  return adminShell(
    c,
    'Moderación',
    <AdminCommentsPage
      items={list.items}
      total={list.total}
      page={query.page}
      totalPages={list.totalPages}
      status={query.status}
      q={query.q}
      csrfToken={c.get('csrfToken')!}
      pendingCount={pendingCount}
      reportThreshold={settings['moderation.report_threshold']}
    />,
  );
});

adminRoutes.post('/comentarios/:id/accion', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const parsed = moderationActionSchema.safeParse({
    action: F.str(body, 'action', 20),
    commentId: c.req.param('id'),
  });
  if (!parsed.success) throw badRequest('bad_action', 'Acción no válida');

  await new CommentService(c.get('container')).moderate(parsed.data.commentId, parsed.data.action, c.get('user')!);
  const referer = c.req.header('Referer');
  const target = referer && referer.includes('/admin/comentarios') ? new URL(referer).pathname + new URL(referer).search : '/admin/comentarios';
  return c.redirect(target, 303);
});


// --------------------------------------------------------- pendientes -----
adminRoutes.get('/pendientes', async (c) => {
  const container = c.get('container');
  const parsed = watchlistQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  const query = parsed.success ? parsed.data : watchlistQuerySchema.parse({});

  const [resultado, counters, categories] = await Promise.all([
    container.watchlist.list(query),
    container.watchlist.counters(),
    container.taxonomy.listCategories(false),
  ]);

  return adminShell(
    c,
    'Pendientes',
    <AdminWatchlistPage
      items={resultado.items}
      counters={counters}
      categories={categories}
      csrfToken={c.get('csrfToken')!}
      query={{
        status: query.status,
        type: query.type,
        priority: query.priority,
        q: query.q,
        sort: query.sort,
      }}
      page={resultado.page}
      totalPages={resultado.totalPages}
      total={resultado.total}
      flash={
        c.req.query('ok') === '1'
          ? { kind: 'ok', message: 'Lista actualizada.' }
          : c.req.query('added')
            ? { kind: 'ok', message: `${c.req.query('added')} títulos añadidos a la lista.` }
            : null
      }
    />,
  );
});

adminRoutes.get('/pendientes/:id', async (c) => {
  const container = c.get('container');
  const item = await container.watchlist.getById(c.req.param('id'));
  if (!item) throw notFound('Ese pendiente no existe');
  const categories = await container.taxonomy.listCategories(false);

  return adminShell(
    c,
    'Editar pendiente',
    <WatchlistEditorPage
      env={c.env}
      item={item}
      categories={categories}
      csrfToken={c.get('csrfToken')!}
      flash={c.req.query('ok') === '1' ? { kind: 'ok', message: 'Cambios guardados.' } : null}
    />,
  );
});

/** Normaliza el formulario de pendientes al esquema de dominio. */
async function readWatchlistForm(c: Context<AppEnv>) {
  const body = await c.req.parseBody({ all: true });
  return watchlistInputSchema.safeParse({
    titleEs: F.strOrEmpty(body, 'titleEs', 200),
    titleOriginal: F.str(body, 'titleOriginal', 200),
    contentType: F.str(body, 'contentType', 20),
    categoryId: F.str(body, 'categoryId', 40) ?? null,
    year: F.num(body, 'year') ?? null,
    creator: F.str(body, 'creator', 200),
    note: F.str(body, 'note', 500),
    sourceUrl: F.str(body, 'sourceUrl', 500) ?? '',
    priority: F.str(body, 'priority', 10) ?? 'MEDIUM',
    status: F.str(body, 'status', 20) ?? 'PENDING',
    isPublic: F.bool(body, 'isPublic'),
    coverKey: F.str(body, 'coverKey', 120) ?? null,
    coverAlt: F.str(body, 'coverAlt', 200),
    sortOrder: F.num(body, 'sortOrder') ?? 0,
  });
}

adminRoutes.post('/pendientes', async (c) => {
  const parsed = await readWatchlistForm(c);
  if (!parsed.success) throw badRequest('validation', 'Revisa los datos del pendiente', fieldErrors(parsed.error));
  await new WatchlistService(c.get('container')).create(parsed.data, c.get('user')!);
  return c.redirect('/admin/pendientes?ok=1', 303);
});

adminRoutes.post('/pendientes/lote', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const bruto = F.str(body, 'titles', 6000) ?? '';
  const service = new WatchlistService(c.get('container'));
  const total = await service.createBatch(
    bruto.split('\n'),
    {
      contentType: (F.str(body, 'contentType', 20) ?? 'OTHER') as ContentType,
      priority: (F.str(body, 'priority', 10) ?? 'MEDIUM') as Priority,
      isPublic: F.bool(body, 'isPublic'),
    },
    c.get('user')!,
  );
  return c.redirect(`/admin/pendientes?added=${total}`, 303);
});

adminRoutes.post('/pendientes/:id', async (c) => {
  const parsed = await readWatchlistForm(c);
  if (!parsed.success) throw badRequest('validation', 'Revisa los datos del pendiente', fieldErrors(parsed.error));
  await new WatchlistService(c.get('container')).update(c.req.param('id'), parsed.data, c.get('user')!);
  return c.redirect(`/admin/pendientes/${c.req.param('id')}?ok=1`, 303);
});

adminRoutes.post('/pendientes/:id/accion', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const parsed = watchlistActionSchema.safeParse({ action: F.str(body, 'action', 20) });
  if (!parsed.success) throw badRequest('bad_action', 'Acción no válida');

  const resultado = await new WatchlistService(c.get('container')).act(
    c.req.param('id'),
    parsed.data.action as WatchlistAction,
    c.get('user')!,
  );
  return c.redirect(resultado.redirectTo ?? '/admin/pendientes?ok=1', 303);
});

// --------------------------------------------------------- taxonomías -----
adminRoutes.get('/taxonomias', async (c) => {
  const container = c.get('container');
  const [categories, genres, platforms] = await Promise.all([
    container.taxonomy.listCategories(false),
    container.taxonomy.listGenres(),
    container.taxonomy.listPlatforms(false),
  ]);
  return adminShell(
    c,
    'Taxonomías',
    <TaxonomyPage
      categories={categories}
      genres={genres}
      platforms={platforms}
      csrfToken={c.get('csrfToken')!}
      flash={c.req.query('ok') === '1' ? { kind: 'ok', message: 'Guardado.' } : null}
    />,
  );
});

adminRoutes.post('/taxonomias/categorias', async (c) => {
  const container = c.get('container');
  const body = await c.req.parseBody({ all: true });
  const parsed = categoryInputSchema.safeParse({
    name: F.strOrEmpty(body, 'name', 80),
    slug: F.str(body, 'slug', 90),
    description: F.str(body, 'description', 300),
    sortOrder: F.num(body, 'sortOrder') ?? 0,
    isActive: F.bool(body, 'isActive') || F.str(body, 'isActive') === undefined,
  });
  if (!parsed.success) throw badRequest('validation', 'Nombre no válido');

  const now = Date.now();
  const slug = await uniqueSlug(parsed.data.slug ?? parsed.data.name, (s) => container.taxonomy.categorySlugIsFree(s));
  await container.taxonomy.createCategory({
    id: crypto.randomUUID(),
    slug,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    sortOrder: parsed.data.sortOrder,
    isActive: parsed.data.isActive ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  });
  await container.audit.record({
    actorId: c.get('user')!.id, actorRole: 'ADMIN', action: 'taxonomy.create',
    entityType: 'category', metadata: { slug },
  });
  return c.redirect('/admin/taxonomias?ok=1', 303);
});

adminRoutes.post('/taxonomias/categorias/:id', async (c) => {
  const container = c.get('container');
  const body = await c.req.parseBody({ all: true });
  const id = c.req.param('id');
  const name = F.strOrEmpty(body, 'name', 80);
  if (name.length < 2) throw badRequest('validation', 'Nombre no válido');
  await container.taxonomy.updateCategory(id, {
    name,
    sortOrder: F.num(body, 'sortOrder') ?? 0,
    isActive: F.bool(body, 'isActive') ? 1 : 0,
    updatedAt: Date.now(),
  });
  await container.audit.record({
    actorId: c.get('user')!.id, actorRole: 'ADMIN', action: 'taxonomy.update',
    entityType: 'category', entityId: id,
  });
  return c.redirect('/admin/taxonomias?ok=1', 303);
});

adminRoutes.post('/taxonomias/categorias/:id/eliminar', async (c) => {
  const container = c.get('container');
  await container.taxonomy.deleteCategory(c.req.param('id'));
  await container.audit.record({
    actorId: c.get('user')!.id, actorRole: 'ADMIN', action: 'taxonomy.delete',
    entityType: 'category', entityId: c.req.param('id'),
  });
  return c.redirect('/admin/taxonomias?ok=1', 303);
});

adminRoutes.post('/taxonomias/generos', async (c) => {
  const container = c.get('container');
  const body = await c.req.parseBody({ all: true });
  const parsed = genreInputSchema.safeParse({ name: F.strOrEmpty(body, 'name', 60), slug: F.str(body, 'slug', 90) });
  if (!parsed.success) throw badRequest('validation', 'Nombre no válido');
  const now = Date.now();
  const slug = await uniqueSlug(parsed.data.slug ?? parsed.data.name, (s) => container.taxonomy.genreSlugIsFree(s));
  await container.taxonomy.createGenre({ id: crypto.randomUUID(), slug, name: parsed.data.name, createdAt: now, updatedAt: now });
  return c.redirect('/admin/taxonomias?ok=1', 303);
});

adminRoutes.post('/taxonomias/generos/:id/eliminar', async (c) => {
  await c.get('container').taxonomy.deleteGenre(c.req.param('id'));
  return c.redirect('/admin/taxonomias?ok=1', 303);
});

adminRoutes.post('/taxonomias/plataformas', async (c) => {
  const container = c.get('container');
  const body = await c.req.parseBody({ all: true });
  const parsed = platformInputSchema.safeParse({
    name: F.strOrEmpty(body, 'name', 80),
    kind: F.str(body, 'kind', 20) ?? 'OTHER',
    baseUrl: F.str(body, 'baseUrl', 300) ?? '',
    isActive: true,
    sortOrder: F.num(body, 'sortOrder') ?? 0,
  });
  if (!parsed.success) throw badRequest('validation', 'Datos de plataforma no válidos');
  const now = Date.now();
  const slug = await uniqueSlug(parsed.data.name, (s) => container.taxonomy.platformSlugIsFree(s));
  await container.taxonomy.createPlatform({
    id: crypto.randomUUID(),
    slug,
    name: parsed.data.name,
    kind: parsed.data.kind,
    baseUrl: parsed.data.baseUrl || null,
    color: null,
    isActive: 1,
    sortOrder: parsed.data.sortOrder,
    createdAt: now,
    updatedAt: now,
  });
  return c.redirect('/admin/taxonomias?ok=1', 303);
});

adminRoutes.post('/taxonomias/plataformas/:id', async (c) => {
  const container = c.get('container');
  const body = await c.req.parseBody({ all: true });
  const parsed = platformInputSchema.safeParse({
    name: F.strOrEmpty(body, 'name', 80),
    kind: F.str(body, 'kind', 20) ?? 'OTHER',
    baseUrl: F.str(body, 'baseUrl', 300) ?? '',
    isActive: F.bool(body, 'isActive'),
    sortOrder: F.num(body, 'sortOrder') ?? 0,
  });
  if (!parsed.success) throw badRequest('validation', 'Datos de plataforma no válidos');
  await container.taxonomy.updatePlatform(c.req.param('id'), {
    name: parsed.data.name,
    kind: parsed.data.kind,
    baseUrl: parsed.data.baseUrl || null,
    isActive: parsed.data.isActive ? 1 : 0,
    sortOrder: parsed.data.sortOrder,
    updatedAt: Date.now(),
  });
  return c.redirect('/admin/taxonomias?ok=1', 303);
});

// ------------------------------------------------------------- ajustes ----
adminRoutes.get('/ajustes', async (c) => {
  const container = c.get('container');
  const [settings, users] = await Promise.all([container.settings.all(), container.users.list()]);
  return adminShell(
    c,
    'Ajustes',
    <SettingsPage
      settings={settings}
      users={users}
      csrfToken={c.get('csrfToken')!}
      environment={c.env.ENVIRONMENT}
      turnstileConfigured={c.env.TURNSTILE_ENABLED === 'true' && Boolean(c.env.TURNSTILE_SECRET_KEY)}
      flash={c.req.query('ok') === '1' ? { kind: 'ok', message: 'Ajustes guardados.' } : null}
    />,
  );
});

adminRoutes.post('/ajustes', async (c) => {
  const container = c.get('container');
  const body = await c.req.parseBody({ all: true });

  const patch: Partial<AppSettings> = {
    'comments.mode': (F.str(body, 'comments.mode', 10) ?? 'OPEN') as AppSettings['comments.mode'],
    'comments.require_approval': F.bool(body, 'comments.require_approval'),
    'comments.max_depth': F.num(body, 'comments.max_depth') ?? 4,
    'comments.min_length': F.num(body, 'comments.min_length') ?? 2,
    'comments.max_length': F.num(body, 'comments.max_length') ?? 2000,
    'moderation.report_threshold': F.num(body, 'moderation.report_threshold') ?? 3,
    'moderation.auto_hide_threshold': F.num(body, 'moderation.auto_hide_threshold') ?? 10,
    'security.turnstile_login': F.bool(body, 'security.turnstile_login'),
    'security.turnstile_comments': F.bool(body, 'security.turnstile_comments'),
    'security.turnstile_reports': F.bool(body, 'security.turnstile_reports'),
    'site.tagline': F.strOrEmpty(body, 'site.tagline', 200),
    'site.description': F.strOrEmpty(body, 'site.description', 400),
    'privacy.audit_retention_days': F.num(body, 'privacy.audit_retention_days') ?? 365,
  };

  const validated = SettingsSchema.partial().safeParse(patch);
  if (!validated.success) throw badRequest('validation', 'Ajustes no válidos', fieldErrors(validated.error));

  await container.settings.update(validated.data, c.get('user')!.id);
  await container.audit.record({
    actorId: c.get('user')!.id,
    actorRole: 'ADMIN',
    action: 'settings.update',
    metadata: { keys: Object.keys(validated.data) },
  });
  return c.redirect('/admin/ajustes?ok=1', 303);
});

// --------------------------------------------------- API interna (JSON) ---
adminRoutes.post('/api/media/portada', rateLimit('upload', { identity: (c) => c.get('user')?.id ?? null }), async (c) => {
  const contentType = c.req.header('Content-Type') ?? '';
  if (!contentType.includes('multipart/form-data')) throw badRequest('bad_content_type', 'Se esperaba multipart/form-data');

  const contentLength = Number(c.req.header('Content-Length') ?? '0');
  if (contentLength > 6 * 1024 * 1024) throw badRequest('too_large', 'Petición demasiado grande');

  const body = await c.req.parseBody({ all: true });
  const upload = F.file(body, 'file');
  if (!upload) throw badRequest('missing_file', 'No se ha recibido ningún archivo');

  const service = new MediaService(c.get('container'));
  const result = await service.uploadCover(upload, c.get('user')!);
  // La vista previa se pinta con esta URL, no con un `blob:` del propio
  // fichero: la CSP no lleva `blob:` en `img-src` y el navegador la bloquearía.
  return ok(c, { ...result, url: variantUrl(c.env, result.key, 'card') }, 201);
});

adminRoutes.delete('/api/media/portada', async (c) => {
  const key = c.req.query('key');
  if (!key) throw badRequest('missing_key', 'Falta la clave');
  await new MediaService(c.get('container')).deleteCover(key, c.get('user')!, { force: true });
  return ok(c, { deleted: true });
});

adminRoutes.get('/api/stats/pendientes', async (c) => {
  const value = await new StatsService(c.get('container')).pendingBadge();
  return ok(c, { pending: value });
});

adminRoutes.get('/api/slug', async (c) => {
  const title = c.req.query('title') ?? '';
  if (!title) throw badRequest('missing_title', 'Falta el título');
  const slug = await uniqueSlug(slugify(title), (s) => c.get('container').reviews.slugIsFree(s, c.req.query('id') ?? undefined));
  return ok(c, { slug });
});

// ================================================== RECOMENDACIONES =====
adminRoutes.get('/recomendaciones', async (c) => {
  const container = c.get('container');
  const parsed = recommendationQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  const query = parsed.success ? parsed.data : recommendationQuerySchema.parse({});

  const [resultado, counters] = await Promise.all([
    container.recommendations.list(query),
    container.recommendations.counters(),
  ]);

  return adminShell(
    c,
    'Recomendaciones',
    <RecommendationsPage
      items={resultado.items}
      counters={counters}
      status={query.status}
      page={query.page}
      totalPages={resultado.totalPages}
      csrfToken={c.get('csrfToken')!}
    />,
  );
});

adminRoutes.post('/recomendaciones/:id/accion', requireCsrf, async (c) => {
  const parsed = recommendationActionSchema.safeParse(await c.req.parseBody());
  if (!parsed.success) throw badRequest('validation', 'Acción no válida');

  const servicio = new RecommendationService(c.get('container'));
  const { redirectTo } = await servicio.act(c.req.param('id'), parsed.data.action, c.get('user')!);

  return c.redirect(redirectTo ?? '/admin/recomendaciones', 303);
});

adminRoutes.all('*', () => {
  throw forbidden('Ruta de administración desconocida');
});
