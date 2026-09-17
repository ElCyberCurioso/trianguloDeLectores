import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import { Hono } from 'hono';
import type { AppEnv } from '../../types/env';
import { Layout } from '../views/layout';
import { HomePage, rutaDeSeccion, type Seccion } from '../views/pages/home';
import { hayFiltros } from '../views/components/filters';
import { ReviewPage } from '../views/pages/review';
import { AboutPage, PrivacyPage, CookiesPage } from '../views/pages/static';
import { AppPage } from '../views/pages/app';
import { WatchlistPage } from '../views/pages/watchlist';
import { WatchlistEditorPublicPage } from '../views/pages/watchlist-editor';
import { EMPTY_WATCHLIST_DRAFT, borradorDe } from '../views/components/watchlist-form';
import { RecommendPage } from '../views/pages/recommend';
import {
  reviewQuerySchema, publicWatchlistQuerySchema, watchlistInputSchema, fieldErrors,
  type PublicWatchlistQuery, type WatchlistInput,
} from '../../validation/schemas';
import { edgeCached, CACHE_NS, NO_STORE } from '../lib/cache';
import { reviewJsonLd, websiteJsonLd, reviewSeoTitle, itemListJsonLd, breadcrumbJsonLd } from '../lib/seo';
import { variantUrl } from '../lib/images';
import { issueFormToken } from '../lib/formtoken';
import { AppError, badRequest, notFound } from '../lib/http';
import { readApkManifest, isSafeApkKey, APK_FILENAME, APK_CONTENT_TYPE } from '../lib/apk';
import { booksHost } from '../lib/books';
import { rateLimit } from '../middleware/ratelimit';
import { requireAdmin, requireCsrf } from '../middleware/auth';
import { parseYearRange } from '../lib/year';
import * as F from '../lib/form';
import { WatchlistService } from '../services/watchlist';
import type { Container } from '../services/container';
import { htmlToText } from '../lib/sanitize';
import { MediaService } from '../services/media';
import { ReviewService } from '../services/reviews';
import type { CommentsSectionProps } from '../views/components/comments';

export const publicRoutes = new Hono<AppEnv>();

const HOME_CACHE = { ns: CACHE_NS.reviews, edgeTtl: 300, browserTtl: 60, swr: 3600 } as const;
const REVIEW_CACHE = { ns: CACHE_NS.reviews, edgeTtl: 600, browserTtl: 120, swr: 86400 } as const;

// ------------------------------------------------------------------- home --
publicRoutes.get('/', async (c) => {
  const parsed = reviewQuerySchema.safeParse(F.queryParams(c.req.url));
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
    const siteUrl = c.env.SITE_URL.replace(/\/$/, '');

    /*
     * El canónico de una portada filtrada no es ella misma.
     *
     * Antes se publicaba `/?genre=drama&sort=rating&page=2` como página propia
     * e indexable, y con cinco filtros combinables salen cientos de URLs con
     * casi el mismo contenido repartiéndose la autoridad. Ahora:
     *
     *   - si el único filtro es una categoría o un género, el canónico es su
     *     página propia, que sí es una página de verdad y está en el sitemap;
     *   - cualquier otra combinación canoniza a la portada y lleva `noindex`.
     *
     * Lo que no cambia es lo que se ve: la página sigue listando lo filtrado.
     * Esto sólo le dice al buscador cuál de todas las formas de escribirla es
     * la buena.
     */
    const soloCategoria = Boolean(query.category) && !query.genre && !query.q && !query.type
      && query.sort === 'recent' && query.page === 1;
    const soloGenero = Boolean(query.genre) && !query.category && !query.q && !query.type
      && query.sort === 'recent' && query.page === 1;

    const canonical = soloCategoria
      ? `${siteUrl}/categoria/${query.category}`
      : soloGenero
        ? `${siteUrl}/genero/${query.genre}`
        : `${siteUrl}/`;
    const filtrada = hayFiltros(query) || query.page > 1;

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
          canonical,
          type: 'website',
          // Una portada con filtros no es una página distinta que indexar. La
          // canónica de arriba ya dice cuál es la buena; el `noindex` evita que
          // se cuelen igual las combinaciones que no llevan a ningún sitio.
          noindex: filtrada && !soloCategoria && !soloGenero,
          jsonLd: [
            websiteJsonLd(c.env, description),
            itemListJsonLd(c.env, results.items),
          ],
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

/*
 * Páginas propias de categoría y de género.
 *
 * `/?genre=drama` lista lo mismo que `/genero/drama`, pero no es lo mismo: la
 * primera es una consulta sobre la portada —sin titular propio, sin texto y
 * fuera del sitemap— y la segunda es una página. Son justo por las que entra
 * quien todavía no conoce el sitio, y por eso existen.
 *
 * Reutilizan la vista del catálogo entera: la retícula, los filtros y la
 * paginación ya estaban escritos y lo único que cambia es la cabecera y a dónde
 * apuntan los enlaces.
 */
const SECCION_CACHE = { ns: CACHE_NS.reviews, edgeTtl: 600, browserTtl: 120, swr: 3600 } as const;

publicRoutes.get('/categoria/:slug', async (c) => {
  const slug = c.req.param('slug');
  return seccion(c, async (container) => {
    const categoria = await container.taxonomy.getCategoryBySlug(slug);
    // Una categoría desactivada deja de existir para el público: si no, se
    // seguiría entrando por un enlace viejo a una página que ya no se enseña.
    if (!categoria || categoria.isActive !== 1) return null;
    return {
      kind: 'categoria' as const,
      slug: categoria.slug,
      name: categoria.name,
      description:
        categoria.description ??
        `Todas las reseñas de ${categoria.name.toLowerCase()} publicadas en ${c.env.SITE_NAME}.`,
    };
  });
});

publicRoutes.get('/genero/:slug', async (c) => {
  const slug = c.req.param('slug');
  return seccion(c, async (container) => {
    const genero = await container.taxonomy.getGenreBySlug(slug);
    if (!genero) return null;
    return {
      kind: 'genero' as const,
      slug: genero.slug,
      name: genero.name,
      // Los géneros no tienen columna de descripción y no hacía falta añadirla:
      // el texto se compone del nombre, que es lo único que distingue a uno de
      // otro, y así no hay veinte descripciones que escribir a mano.
      description: `Reseñas de ${genero.name.toLowerCase()} en ${c.env.SITE_NAME}: libros, cine, series, anime, cómic y videojuegos.`,
    };
  });
});

/** Lo que comparten las dos: buscar la sección, listar y pintar. */
async function seccion(
  c: Context<AppEnv>,
  buscar: (container: Container) => Promise<Seccion | null>,
): Promise<Response> {
  return edgeCached(c, SECCION_CACHE, async () => {
    const container = c.get('container');
    const encontrada = await buscar(container);
    if (!encontrada) throw notFound('Esa sección no existe');

    const parsed = reviewQuerySchema.safeParse(F.queryParams(c.req.url));
    const base = parsed.success ? parsed.data : reviewQuerySchema.parse({});
    // El filtro de la sección lo manda la ruta, no la query: escribir
    // `/genero/drama?genre=terror` no puede enseñar terror.
    const query = {
      ...base,
      category: encontrada.kind === 'categoria' ? encontrada.slug : base.category,
      genre: encontrada.kind === 'genero' ? encontrada.slug : base.genre,
    };

    const [results, categories, genres, settings] = await Promise.all([
      container.reviews.listPublished(query),
      container.taxonomy.listCategoriesWithCounts(),
      container.taxonomy.listGenresWithCounts(),
      container.settings.all(),
    ]);

    const ruta = rutaDeSeccion(encontrada);
    const siteUrl = c.env.SITE_URL.replace(/\/$/, '');
    // Refinar dentro de la sección no crea páginas nuevas que indexar: la
    // canónica es siempre la sección limpia, y lo filtrado lleva `noindex`.
    const refinada = Boolean(base.q || base.type) || base.sort !== 'recent' || base.page > 1;

    return c.html(
      <Layout
        env={c.env}
        nonce={c.get('nonce')}
        path={ruta}
        user={c.get('user')}
        csrfToken={c.get('csrfToken')}
        seo={{
          title: `${encontrada.name} — reseñas | ${c.env.SITE_NAME}`,
          description: encontrada.description,
          canonical: `${siteUrl}${ruta}`,
          type: 'website',
          noindex: refinada,
          jsonLd: [
            itemListJsonLd(c.env, results.items),
            breadcrumbJsonLd(c.env, [
              { name: c.env.SITE_NAME, path: '/' },
              { name: encontrada.name, path: ruta },
            ]),
          ],
        }}
      >
        <HomePage
          env={c.env}
          results={results}
          categories={categories}
          genres={genres}
          query={query}
          tagline={settings['site.tagline']}
          seccion={encontrada}
        />
      </Layout>,
    );
  });
}

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
    const [comments, episodes, relacionadas] = await Promise.all([
      buildCommentProps(c, review.id, review.slug, policy),
      container.episodes.byReview(review.id),
      // En la misma tanda que lo demás: es una consulta más, no una espera más.
      container.reviews.relacionadas(review.id),
    ]);

    if (isPartial) {
      // Fragmento para el modal: sin <html>, mismas cabeceras de seguridad. Sin
      // relacionadas: el catálogo entero está justo detrás del modal.
      return c.html(<ReviewPage env={c.env} review={review} comments={comments} episodes={episodes} inModal />);
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
          /*
           * La ficha declara dos cosas: la reseña y dónde está.
           *
           * La miga de pan visual ya se pintaba arriba; ésta es la misma ruta
           * en datos, que es lo que el buscador convierte en la línea de
           * navegación bajo el resultado. Se cuelga de la categoría cuando la
           * tiene, porque ahora es una página de verdad a la que llevar.
           */
          jsonLd: [
            reviewJsonLd(c.env, review),
            breadcrumbJsonLd(c.env, [
              { name: c.env.SITE_NAME, path: '/' },
              ...(review.categorySlug && review.categoryName
                ? [{ name: review.categoryName, path: `/categoria/${review.categorySlug}` }]
                : []),
              { name: review.titleEs, path: `/resena/${review.slug}` },
            ]),
          ],
        }}
      >
        <ReviewPage
          env={c.env}
          review={review}
          comments={comments}
          episodes={episodes}
          relacionadas={relacionadas}
        />
      </Layout>,
    );
  };

  return edgeCached(c, REVIEW_CACHE, produce);
});


// ------------------------------------------------------------- pendientes --
const WATCHLIST_CACHE = { ns: CACHE_NS.watchlist, edgeTtl: 300, browserTtl: 60, swr: 3600 } as const;

/**
 * El listado de pendientes, público y a la vez el sitio donde se gestionan.
 *
 * Lo que se puede ver **no** lo decide la URL. Sin sesión se fuerza a lo
 * público, activo y todavía sin reseña, pase lo que pase en los parámetros; con
 * sesión se respeta lo que pida el filtro. Dejar que `status=ALL` o
 * `visibility=PRIVATE` funcionaran para cualquiera convertiría un parámetro de
 * la query en la llave de lo privado.
 */
publicRoutes.get('/pendientes', async (c) => {
  const parsed = publicWatchlistQuerySchema.safeParse(F.queryParams(c.req.url));
  const query = parsed.success ? parsed.data : publicWatchlistQuerySchema.parse({});
  const puedeGestionar = Boolean(c.get('user'));

  // Sin sesión, el filtro se recorta a lo que puede verse antes de llegar a la
  // base de datos. Así el resto del handler trabaja con una consulta ya segura.
  const efectiva: PublicWatchlistQuery = puedeGestionar
    ? query
    : { ...query, status: query.status === 'ALL' ? 'ACTIVE' : query.status, visibility: 'PUBLIC' };

  const periodo = parseYearRange(efectiva.year);

  return edgeCached(c, WATCHLIST_CACHE, async () => {
    const container = c.get('container');
    const [resultado, tipos, categories, settings] = await Promise.all([
      container.watchlist.list({
        status: efectiva.status,
        type: efectiva.type,
        priority: efectiva.priority,
        category: efectiva.category,
        q: efectiva.q,
        sort: efectiva.sort,
        // El año se busca por solape de periodos: «2021» encuentra también lo
        // que empezó en 2020 y seguía emitiéndose.
        yearFrom: periodo.year ?? undefined,
        yearTo: periodo.yearOngoing ? undefined : (periodo.yearEnd ?? periodo.year ?? undefined),
        onlyPublic: !puedeGestionar,
        visibility: puedeGestionar ? efectiva.visibility : undefined,
        /*
         * Con sesión **no** se excluye lo ya reseñado: el filtro tiene que poder
         * encontrar cualquier pendiente, también el que acabó en reseña. No
         * estorba en el uso normal porque el estado por omisión es «activos», y
         * un pendiente convertido está terminado. Sin sesión sigue mandando el
         * vínculo con la reseña, que lo aplica `onlyPublic`: una obra no puede
         * estar anunciada como «por ver» y publicada como reseña a la vez.
         */
        page: efectiva.page,
        perPage: 60,
      }),
      container.watchlist.publicTypes(),
      container.taxonomy.listCategories(false),
      container.settings.all(),
    ]);

    const totalTipos = tipos.reduce((suma, t) => suma + t.total, 0);

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
          // Una lista filtrada no es una página distinta que indexar.
          noindex: hayFiltroDePendientes(efectiva),
        }}
      >
        <WatchlistPage
          env={c.env}
          items={resultado.items}
          tiposDisponibles={tipos}
          categories={categories}
          query={efectiva}
          total={efectiva.type ? resultado.total : totalTipos}
          page={resultado.page}
          totalPages={resultado.totalPages}
          puedeGestionar={puedeGestionar}
          flash={c.req.query('ok') === '1' ? { kind: 'ok', message: 'Pendiente guardado.' } : null}
        />
      </Layout>,
    );
  });
});

/** ¿La URL lleva filtro? Decide el `noindex` y nada más. */
function hayFiltroDePendientes(query: PublicWatchlistQuery): boolean {
  return Boolean(
    query.q || query.type || query.priority || query.category || query.year ||
      query.status !== 'ACTIVE' || query.visibility !== 'PUBLIC' || query.sort !== 'priority' ||
      query.page > 1,
  );
}

/*
 * Alta y edición desde la propia página pública.
 *
 * Detrás del mismo guardián que el panel —`requireAdmin` mira el rol de la
 * sesión en base de datos— y con la misma comprobación CSRF. Que la ruta viva
 * en el sitio público no la hace pública: lo único que cambia es dónde está el
 * formulario, que es lo que se pedía. Esconder el botón de editar a quien no
 * tiene sesión es cortesía; el control de acceso es esto.
 */
const shellPendiente = (c: Context<AppEnv>, node: Child) => {
  c.header('Cache-Control', NO_STORE);
  return c.html(
    <Layout
      env={c.env}
      nonce={c.get('nonce')}
      path={new URL(c.req.url).pathname}
      user={c.get('user')}
      csrfToken={c.get('csrfToken')}
      seo={{
        title: `Pendientes | ${c.env.SITE_NAME}`,
        description: 'Alta y edición de un pendiente.',
        canonical: `${c.env.SITE_URL.replace(/\/$/, '')}/pendientes`,
        noindex: true,
      }}
    >
      {node}
    </Layout>,
  );
};

publicRoutes.get('/pendientes/nuevo', requireAdmin, async (c) => {
  const categories = await c.get('container').taxonomy.listCategories(false);
  return shellPendiente(
    c,
    <WatchlistEditorPublicPage
      env={c.env}
      id={null}
      item={EMPTY_WATCHLIST_DRAFT}
      categories={categories}
      csrfToken={c.get('csrfToken')!}
    />,
  );
});

publicRoutes.post('/pendientes/nuevo', requireAdmin, requireCsrf, async (c) => {
  const parsed = await leerFormularioPendiente(c);
  if (!parsed.success) throw badRequest('validation', 'Revisa los datos del pendiente', fieldErrors(parsed.error));

  try {
    await new WatchlistService(c.get('container')).create(parsed.data, c.get('user')!);
  } catch (err) {
    const pantalla = await pantallaDeDuplicado(c, err, null, parsed.data);
    if (!pantalla) throw err;
    return pantalla;
  }
  return c.redirect('/pendientes?ok=1', 303);
});

/**
 * La obra ya estaba en la lista: se vuelve al formulario con lo escrito.
 *
 * Aquí no vale la página de error. Este formulario tiene una nota, un enlace y
 * hasta una portada ya subida, y mandarlo todo a un 409 pelado obligaría a
 * escribirlo otra vez. Se dice cuál es el original, se enlaza y se deja
 * corregir el título o el tipo, que es lo único que hay que cambiar.
 *
 * Devuelve nulo si el error es otro: quien llama lo relanza.
 */
async function pantallaDeDuplicado(
  c: Context<AppEnv>,
  err: unknown,
  id: string | null,
  input: WatchlistInput,
): Promise<Response | null> {
  if (!(err instanceof AppError) || err.code !== 'watchlist_duplicate') return null;

  const container = c.get('container');
  const categories = await container.taxonomy.listCategories(false);
  // Al editar hace falta saber si la ficha ya se convirtió en reseña: ese aviso
  // es suyo y desaparecería al repintarla.
  const original = id ? await container.watchlist.getById(id) : null;

  c.status(409);
  return shellPendiente(
    c,
    <WatchlistEditorPublicPage
      env={c.env}
      id={id}
      item={borradorDe(input)}
      categories={categories}
      csrfToken={c.get('csrfToken')!}
      reviewId={original?.reviewId ?? null}
      duplicate={{ id: String(err.details?.id), titleEs: String(err.details?.titleEs) }}
      errors={{ titleEs: err.message }}
      flash={{ kind: 'error', message: 'Eso ya está en la lista.' }}
    />,
  );
}

publicRoutes.get('/pendientes/:id/editar', requireAdmin, async (c) => {
  const container = c.get('container');
  const item = await container.watchlist.getById(c.req.param('id'));
  if (!item) throw notFound('Ese pendiente no existe');
  const categories = await container.taxonomy.listCategories(false);

  return shellPendiente(
    c,
    <WatchlistEditorPublicPage
      env={c.env}
      id={item.id}
      item={item}
      categories={categories}
      csrfToken={c.get('csrfToken')!}
      reviewId={item.reviewId}
    />,
  );
});

publicRoutes.post('/pendientes/:id/editar', requireAdmin, requireCsrf, async (c) => {
  const parsed = await leerFormularioPendiente(c);
  if (!parsed.success) throw badRequest('validation', 'Revisa los datos del pendiente', fieldErrors(parsed.error));

  const id = c.req.param('id');
  try {
    await new WatchlistService(c.get('container')).update(id, parsed.data, c.get('user')!);
  } catch (err) {
    const pantalla = await pantallaDeDuplicado(c, err, id, parsed.data);
    if (!pantalla) throw err;
    return pantalla;
  }
  /*
   * Guardar devuelve a la lista, no deja en el formulario.
   *
   * Se edita desde la cola y para volver a ella: quedarse en la ficha con un
   * «guardado» obliga a pulsar «Volver» cada vez, y lo que se quiere ver
   * después de tocar un pendiente es dónde ha quedado respecto a los demás.
   */
  return c.redirect('/pendientes?ok=1', 303);
});

/**
 * Del formulario al esquema de dominio.
 *
 * El año llega como **texto** —«2020-2022», «2023-actualidad»— y se traduce
 * aquí a los tres campos que se guardan. La traducción vive en el adaptador del
 * formulario y no en el esquema a propósito: el esquema valida lo que se guarda,
 * y cómo se escriba una fecha en un `input` es cosa de quien lee el formulario.
 */
async function leerFormularioPendiente(c: Context<AppEnv>) {
  const body = await c.req.parseBody({ all: true });
  const periodo = parseYearRange(F.str(body, 'year', 40));

  return watchlistInputSchema.safeParse({
    titleEs: F.strOrEmpty(body, 'titleEs', 200),
    titleOriginal: F.str(body, 'titleOriginal', 200),
    contentType: F.str(body, 'contentType', 20),
    categoryId: F.str(body, 'categoryId', 40) ?? null,
    year: periodo.year,
    yearEnd: periodo.yearEnd,
    yearOngoing: periodo.yearOngoing,
    seasons: F.num(body, 'seasons') ?? null,
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
    const [reviews, categories, genres] = await Promise.all([
      container.reviews.allPublishedForSitemap(),
      container.taxonomy.listCategoriesWithCounts(),
      container.taxonomy.listGenresWithCounts(),
    ]);

    const urls = [
      { loc: `${siteUrl}/`, lastmod: new Date().toISOString(), priority: '1.0' },
      { loc: `${siteUrl}/pendientes`, lastmod: new Date().toISOString(), priority: '0.6' },
      /*
       * Las secciones, sólo si tienen algo dentro.
       *
       * Un género vacío es una página que dice «no hay reseñas»: mandarla al
       * buscador es pedir que indexe un hueco, y encima el día que se llene no
       * hay forma de que vuelva antes. Entran cuando tienen contenido y salen
       * solas del sitemap si alguna vez se quedan sin él.
       */
      ...categories
        .filter((categoria) => categoria.reviewCount > 0)
        .map((categoria) => ({
          loc: `${siteUrl}/categoria/${categoria.slug}`,
          lastmod: undefined,
          priority: '0.7',
        })),
      ...genres
        .filter((genero) => genero.reviewCount > 0)
        .map((genero) => ({
          loc: `${siteUrl}/genero/${genero.slug}`,
          lastmod: undefined,
          priority: '0.7',
        })),
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
