import type { Context } from 'hono';
import { Hono } from 'hono';
import type { AppEnv } from '../../types/env';
import { Layout } from '../views/layout';
import { HomePage } from '../views/pages/home';
import { ReviewPage } from '../views/pages/review';
import { AboutPage, PrivacyPage, CookiesPage } from '../views/pages/static';
import { AppPage } from '../views/pages/app';
import { WatchlistPage } from '../views/pages/watchlist';
import { RecommendPage } from '../views/pages/recommend';
import { reviewQuerySchema } from '../../validation/schemas';
import { CONTENT_TYPES, type ContentType } from '../../types/domain';
import { edgeCached, CACHE_NS, NO_STORE } from '../lib/cache';
import { reviewJsonLd, websiteJsonLd, reviewSeoTitle } from '../lib/seo';
import { variantUrl } from '../lib/images';
import { issueFormToken } from '../lib/formtoken';
import { notFound } from '../lib/http';
import { readApkManifest, isSafeApkKey, APK_FILENAME, APK_CONTENT_TYPE } from '../lib/apk';
import { booksHost } from '../lib/books';
import { rateLimit } from '../middleware/ratelimit';
import { htmlToText } from '../lib/sanitize';
import { MediaService } from '../services/media';
import { ReviewService } from '../services/reviews';
import type { CommentsSectionProps } from '../views/components/comments';

export const publicRoutes = new Hono<AppEnv>();

const HOME_CACHE = { ns: CACHE_NS.reviews, edgeTtl: 300, browserTtl: 60, swr: 3600 } as const;
const REVIEW_CACHE = { ns: CACHE_NS.reviews, edgeTtl: 600, browserTtl: 120, swr: 86400 } as const;

// ------------------------------------------------------------------- home --
publicRoutes.get('/', async (c) => {
  const parsed = reviewQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  const query = parsed.success ? parsed.data : reviewQuerySchema.parse({});

  return edgeCached(c, HOME_CACHE, async () => {
    const container = c.get('container');
    const [results, categories, genres, settings] = await Promise.all([
      container.reviews.listPublished(query),
      container.taxonomy.listCategoriesWithCounts(),
      container.taxonomy.listGenresWithCounts(),
      container.settings.all(),
    ]);

    const description = settings['site.description'];
    const canonicalParams = new URL(c.req.url);
    canonicalParams.searchParams.delete('__v');

    return c.html(
      <Layout
        env={c.env}
        nonce={c.get('nonce')}
        path={new URL(c.req.url).pathname}
        user={c.get('user')}
        csrfToken={c.get('csrfToken')}
        seo={{
          title: `${c.env.SITE_NAME} — ${settings['site.tagline']}`,
          description,
          canonical: `${c.env.SITE_URL.replace(/\/$/, '')}${canonicalParams.pathname}${canonicalParams.search}`,
          type: 'website',
          jsonLd: websiteJsonLd(c.env, description),
        }}
      >
        <HomePage
          env={c.env}
          results={results}
          categories={categories}
          genres={genres}
          query={query}
          tagline={settings['site.tagline']}
        />
      </Layout>,
    );
  });
});

// ----------------------------------------------------------------- reseña --
async function buildCommentProps(
  c: Context<AppEnv>,
  reviewId: string,
  reviewSlug: string,
  policy: 'OPEN' | 'AUTH' | 'CLOSED',
): Promise<CommentsSectionProps> {
  const container = c.get('container');
  const settings = await container.settings.all();
  const thread = await container.comments.listThread(reviewId, { rootsPerPage: 25 });
  return {
    reviewId,
    reviewSlug,
    nodes: thread.nodes,
    totalRoots: thread.totalRoots,
    policy,
    requiresApproval: settings['comments.require_approval'],
    maxDepth: settings['comments.max_depth'],
    isLoggedIn: Boolean(c.get('user')),
    formToken: await issueFormToken(c.env, `comment:${reviewId}`),
    turnstileSiteKey:
      c.env.TURNSTILE_ENABLED === 'true' && settings['security.turnstile_comments']
        ? c.env.TURNSTILE_SITE_KEY
        : null,
    aliasMaxLength: settings['comments.alias_max_length'],
    bodyMaxLength: settings['comments.max_length'],
  };
}

publicRoutes.get('/resena/:slug', async (c) => {
  const slug = c.req.param('slug');
  const isPartial = c.req.query('parcial') === '1';

  const produce = async () => {
    const container = c.get('container');
    const review = await container.reviews.getBySlug(slug);
    if (!review) throw notFound('Esa reseña no existe o todavía no está publicada');

    const policy = await new ReviewService(container).commentPolicy(review);
    const comments = await buildCommentProps(c, review.id, review.slug, policy);

    if (isPartial) {
      // Fragmento para el modal: sin <html>, mismas cabeceras de seguridad.
      return c.html(<ReviewPage env={c.env} review={review} comments={comments} inModal />);
    }

    const description =
      review.seoDescription ?? review.summary ?? htmlToText(review.bodyHtml, 180) ?? review.titleEs;
    const ogImage = variantUrl(c.env, review.coverKey, 'og');

    return c.html(
      <Layout
        env={c.env}
        nonce={c.get('nonce')}
        path={new URL(c.req.url).pathname}
        user={c.get('user')}
        csrfToken={c.get('csrfToken')}
        seo={{
          title: reviewSeoTitle(c.env, review),
          description,
          canonical: `${c.env.SITE_URL.replace(/\/$/, '')}/resena/${review.slug}`,
          image: ogImage ? (ogImage.startsWith('http') ? ogImage : `${c.env.SITE_URL.replace(/\/$/, '')}${ogImage}`) : null,
          imageAlt: review.coverAlt ?? `Portada de ${review.titleEs}`,
          type: 'article',
          publishedTime: review.publishedAt ? new Date(review.publishedAt).toISOString() : undefined,
          modifiedTime: new Date(review.updatedAt).toISOString(),
          jsonLd: reviewJsonLd(c.env, review),
        }}
      >
        <ReviewPage env={c.env} review={review} comments={comments} />
      </Layout>,
    );
  };

  return edgeCached(c, REVIEW_CACHE, produce);
});


// ------------------------------------------------------------- pendientes --
const WATCHLIST_CACHE = { ns: CACHE_NS.watchlist, edgeTtl: 300, browserTtl: 60, swr: 3600 } as const;

publicRoutes.get('/pendientes', async (c) => {
  const tipoParam = c.req.query('type');
  const tipo = CONTENT_TYPES.includes(tipoParam as ContentType) ? (tipoParam as ContentType) : undefined;

  return edgeCached(c, WATCHLIST_CACHE, async () => {
    const container = c.get('container');
    const [resultado, tipos, settings] = await Promise.all([
      // `onlyPublic` + estado activo se aplican en el repositorio: lo privado y
      // lo ya terminado no sale de la base de datos.
      container.watchlist.list({ onlyPublic: true, status: 'ACTIVE', type: tipo, perPage: 60 }),
      container.watchlist.publicTypes(),
      container.settings.all(),
    ]);

    const total = tipos.reduce((suma, t) => suma + t.total, 0);

    return c.html(
      <Layout
        env={c.env}
        nonce={c.get('nonce')}
        path={new URL(c.req.url).pathname}
        user={c.get('user')}
        csrfToken={c.get('csrfToken')}
        seo={{
          title: `Pendientes por ver | ${c.env.SITE_NAME}`,
          description:
            'Lo que está en cola por ver, leer o jugar en ' +
            `${c.env.SITE_NAME}. ${settings['site.tagline']}`,
          canonical: `${c.env.SITE_URL.replace(/\/$/, '')}/pendientes`,
          type: 'website',
        }}
      >
        <WatchlistPage
          env={c.env}
          items={resultado.items}
          tiposDisponibles={tipos}
          tipoActivo={tipo}
          total={total}
        />
      </Layout>,
    );
  });
});

// ---------------------------------------------------------- recomendaciones --
/*
  No se cachea: lleva un token de formulario firmado y por tanto irrepetible.
  Servir una copia guardada dejaría el formulario inservible para el siguiente.
*/
publicRoutes.get('/recomendar', rateLimit('publicApi'), async (c) => {
  const container = c.get('container');
  const [settings, counters] = await Promise.all([
    container.settings.all(),
    container.recommendations.counters(),
  ]);
  const url = new URL(c.req.url);

  return c.html(
    <Layout
      env={c.env}
      nonce={c.get('nonce')}
      path={new URL(c.req.url).pathname}
      user={c.get('user')}
      csrfToken={c.get('csrfToken')}
      seo={{
        title: `Recomienda una obra | ${c.env.SITE_NAME}`,
        description:
          'Cuenta qué deberíamos leer, ver o jugar. Cada propuesta se lee a mano y algunas acaban en el catálogo.',
        canonical: `${c.env.SITE_URL.replace(/\/$/, '')}/recomendar`,
        type: 'website',
      }}
    >
      <RecommendPage
        formToken={await issueFormToken(c.env, 'recommendation')}
        turnstileSiteKey={
          c.env.TURNSTILE_ENABLED === 'true' && settings['security.turnstile_comments']
            ? c.env.TURNSTILE_SITE_KEY
            : null
        }
        aceptadas={counters.accepted}
        enviada={url.searchParams.get('enviada') === '1'}
        error={url.searchParams.get('error') === 'validacion' ? 'Revisa el formulario: falta algún campo obligatorio.' : null}
      />
    </Layout>,
    200,
    { 'Cache-Control': NO_STORE },
  );
});

// ------------------------------------------------------- páginas estáticas --
publicRoutes.get('/sobre', async (c) =>
  edgeCached(c, { ns: CACHE_NS.taxonomy, edgeTtl: 3600, browserTtl: 600 }, async () =>
    c.html(
      <Layout
        env={c.env}
        nonce={c.get('nonce')}
        path={new URL(c.req.url).pathname}
        user={c.get('user')}
        csrfToken={c.get('csrfToken')}
        seo={{
          title: `Sobre ${c.env.SITE_NAME}`,
          description: `Qué es ${c.env.SITE_NAME} y cómo se puntúan las reseñas.`,
          canonical: `${c.env.SITE_URL.replace(/\/$/, '')}/sobre`,
        }}
      >
        <AboutPage siteName={c.env.SITE_NAME} />
      </Layout>,
    ),
  ),
);

publicRoutes.get('/privacidad', async (c) =>
  edgeCached(c, { ns: CACHE_NS.taxonomy, edgeTtl: 3600, browserTtl: 600 }, async () =>
    c.html(
      <Layout
        env={c.env}
        nonce={c.get('nonce')}
        path={new URL(c.req.url).pathname}
        user={c.get('user')}
        csrfToken={c.get('csrfToken')}
        seo={{
          title: `Política de privacidad | ${c.env.SITE_NAME}`,
          description: 'Qué datos trata este sitio, con qué base legal y durante cuánto tiempo.',
          canonical: `${c.env.SITE_URL.replace(/\/$/, '')}/privacidad`,
        }}
      >
        <PrivacyPage siteName={c.env.SITE_NAME} />
      </Layout>,
    ),
  ),
);

publicRoutes.get('/cookies', async (c) =>
  edgeCached(c, { ns: CACHE_NS.taxonomy, edgeTtl: 3600, browserTtl: 600 }, async () =>
    c.html(
      <Layout
        env={c.env}
        nonce={c.get('nonce')}
        path={new URL(c.req.url).pathname}
        user={c.get('user')}
        csrfToken={c.get('csrfToken')}
        seo={{
          title: `Política de cookies | ${c.env.SITE_NAME}`,
          description: 'Cookies estrictamente necesarias que utiliza el sitio.',
          canonical: `${c.env.SITE_URL.replace(/\/$/, '')}/cookies`,
        }}
      >
        <CookiesPage />
      </Layout>,
    ),
  ),
);

// ---------------------------------------------------- aplicación Android --
/**
 * Página de descarga del APK.
 *
 * Vive en el sitio público a propósito: hay que poder llegar desde un teléfono
 * recién estrenado, que todavía no tiene forma de entrar en ninguna parte. Lo
 * que está detrás del acceso es la biblioteca, no el instalador.
 *
 * **No entra en la caché compartida**, y es la única página estática del sitio
 * que se queda fuera. Lo que pinta sale de un manifiesto en R2 que cambia al
 * publicar una versión, y esa publicación no toca el sello de contenido en KV
 * ni la versión desplegada, que son las dos cosas que forman la clave de caché.
 * Cacheada, el sitio anunciaría la versión anterior durante minutos después de
 * publicar una nueva, que es la peor forma posible de repartir un binario. Leer
 * un objeto pequeño de R2 en cada visita a una página que se abre cuatro veces
 * al mes no es un problema.
 */
publicRoutes.get('/aplicacion', async (c) => {
  const manifest = await readApkManifest(c.env);
  const booksUrl = c.env.BOOKS_URL ?? `https://${booksHost(c.env)}`;

  c.header('Cache-Control', 'public, max-age=60');
  return c.html(
      <Layout
        env={c.env}
        nonce={c.get('nonce')}
        path={new URL(c.req.url).pathname}
        user={c.get('user')}
        csrfToken={c.get('csrfToken')}
        seo={{
          title: `Aplicación para Android | ${c.env.SITE_NAME}`,
          description:
            'Lector de PDF para Android que funciona sin conexión y sincroniza la lectura con la biblioteca privada.',
          canonical: `${c.env.SITE_URL.replace(/\/$/, '')}/aplicacion`,
        }}
      >
      <AppPage siteName={c.env.SITE_NAME} booksUrl={booksUrl} manifest={manifest} />
    </Layout>,
  );
});

/**
 * El binario.
 *
 * La clave del objeto sale del manifiesto y se vuelve a validar aquí con un
 * patrón cerrado: aunque el manifiesto lo escribimos nosotros, es un fichero
 * de un bucket, y lo que decide qué objeto se sirve no puede depender de que
 * nadie lo haya tocado.
 *
 * Sin caché compartida larga: publicar una versión nueva debe llegar a quien
 * descargue a continuación, y son unos pocos megas al mes.
 */
publicRoutes.get('/aplicacion/descargar', async (c) => {
  const manifest = await readApkManifest(c.env);
  if (!manifest || !isSafeApkKey(manifest.key)) throw notFound('Todavía no hay ninguna versión publicada');

  const object = await c.env.MEDIA.get(manifest.key);
  if (!object) throw notFound('Todavía no hay ninguna versión publicada');

  return new Response(object.body, {
    headers: {
      'Content-Type': APK_CONTENT_TYPE,
      'Content-Length': String(object.size),
      // `attachment`: un APK no se abre en el navegador, se guarda.
      'Content-Disposition': `attachment; filename="${APK_FILENAME}"`,
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      etag: object.httpEtag,
    },
  });
});

/**
 * Manifiesto en JSON. Lo consulta la propia aplicación para avisar de que hay
 * versión nueva -- sin Play Store no hay quien lo haga por ella.
 */
publicRoutes.get('/aplicacion/version.json', async (c) => {
  const manifest = await readApkManifest(c.env);
  if (!manifest) throw notFound('Todavía no hay ninguna versión publicada');

  return c.json(
    {
      version: manifest.version,
      versionCode: manifest.versionCode,
      sizeBytes: manifest.sizeBytes,
      sha256: manifest.sha256,
      publishedAt: manifest.publishedAt,
      minSdk: manifest.minSdk,
      notes: manifest.notes,
      // La clave de R2 no sale: el enlace de descarga es el que se publica.
      url: `${c.env.SITE_URL.replace(/\/$/, '')}/aplicacion/descargar`,
    },
    200,
    { 'Cache-Control': 'public, max-age=300' },
  );
});

// ------------------------------------------------------------------ media --
publicRoutes.get('/media/*', async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/media\//, ''));
  const service = new MediaService(c.get('container'));
  return service.serve(key, c.req.raw);
});

// -------------------------------------------------------------------- SEO --
publicRoutes.get('/robots.txt', (c) => {
  const siteUrl = c.env.SITE_URL.replace(/\/$/, '');
  const body =
    c.env.ENVIRONMENT === 'production'
      ? [
          'User-agent: *',
          'Allow: /',
          'Disallow: /admin',
          'Disallow: /admin/',
          'Disallow: /api/',
          'Disallow: /*?parcial=1',
          '',
          `Sitemap: ${siteUrl}/sitemap.xml`,
          '',
        ].join('\n')
      : ['User-agent: *', 'Disallow: /', ''].join('\n');

  return c.text(body, 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  });
});

publicRoutes.get('/sitemap.xml', async (c) =>
  edgeCached(c, { ns: CACHE_NS.reviews, edgeTtl: 1800, browserTtl: 300 }, async () => {
    const container = c.get('container');
    const siteUrl = c.env.SITE_URL.replace(/\/$/, '');
    const reviews = await container.reviews.allPublishedForSitemap();

    const urls = [
      { loc: `${siteUrl}/`, lastmod: new Date().toISOString(), priority: '1.0' },
      { loc: `${siteUrl}/pendientes`, lastmod: new Date().toISOString(), priority: '0.6' },
      { loc: `${siteUrl}/aplicacion`, lastmod: undefined, priority: '0.5' },
      { loc: `${siteUrl}/sobre`, lastmod: undefined, priority: '0.3' },
      { loc: `${siteUrl}/privacidad`, lastmod: undefined, priority: '0.2' },
      { loc: `${siteUrl}/cookies`, lastmod: undefined, priority: '0.2' },
      ...reviews.map((r) => ({
        loc: `${siteUrl}/resena/${r.slug}`,
        lastmod: new Date(r.updatedAt).toISOString(),
        priority: '0.8',
      })),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`,
  )
  .join('\n')}
</urlset>`;

    return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  }),
);

publicRoutes.get('/rss.xml', async (c) =>
  edgeCached(c, { ns: CACHE_NS.reviews, edgeTtl: 1800, browserTtl: 600 }, async () => {
    const container = c.get('container');
    const siteUrl = c.env.SITE_URL.replace(/\/$/, '');
    const settings = await container.settings.all();
    const results = await container.reviews.listPublished(reviewQuerySchema.parse({ perPage: 20 }));

    const items = results.items
      .map((r) => {
        const link = `${siteUrl}/resena/${r.slug}`;
        const date = new Date(r.publishedAt ?? r.updatedAt).toUTCString();
        return `    <item>
      <title>${escapeXml(r.titleEs)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${date}</pubDate>
      <description>${escapeXml(r.summary ?? '')}</description>
    </item>`;
      })
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
    <title>${escapeXml(c.env.SITE_NAME)}</title>
    <link>${escapeXml(siteUrl)}</link>
    <description>${escapeXml(settings['site.description'])}</description>
    <language>es-ES</language>
${items}
</channel></rss>`;

    return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
  }),
);

publicRoutes.get('/health', (c) =>
  c.json({ ok: true, environment: c.env.ENVIRONMENT }, 200, { 'Cache-Control': NO_STORE }),
);

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
