import type { FC, PropsWithChildren } from 'hono/jsx';
import { raw } from 'hono/html';
import type { Bindings } from '../../types/env';

export interface SeoMeta {
  title: string;
  description: string;
  canonical: string;
  /** URL absoluta de la imagen para redes sociales */
  image?: string | null;
  imageAlt?: string | null;
  type?: 'website' | 'article';
  publishedTime?: string;
  modifiedTime?: string;
  noindex?: boolean;
  /** JSON-LD ya serializado */
  jsonLd?: string | null;
}

export interface LayoutProps {
  env: Bindings;
  nonce: string;
  seo: SeoMeta;
  bodyClass?: string;
  /** scripts adicionales (rutas bajo /assets) */
  scripts?: string[];
  isAdmin?: boolean;
  adminBadge?: number;
  /** Token CSRF de la sesión: lo necesita el formulario de salida del panel. */
  csrfToken?: string | null;
  user?: { displayName: string; role: string } | null;
}

/**
 * Evita el "flash" de tema claro antes de que cargue el JS. Es un script en
 * línea, permitido por la CSP gracias al nonce por petición (no `unsafe-inline`).
 */
const THEME_BOOTSTRAP = `try{var t=localStorage.getItem('tdl-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}`;

export const Layout: FC<PropsWithChildren<LayoutProps>> = (props) => {
  const {
    env, nonce, seo, children, scripts = [],
    isAdmin = false, adminBadge = 0, user = null, csrfToken = null,
  } = props;
  const siteUrl = env.SITE_URL.replace(/\/$/, '');
  const ogImage = seo.image ?? `${siteUrl}/assets/og-default.svg`;

  return (
    <html lang="es" data-theme-default="dark">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{seo.title}</title>
        <meta name="description" content={seo.description} />
        <link rel="canonical" href={seo.canonical} />
        {seo.noindex ? (
          <meta name="robots" content="noindex, nofollow, noarchive" />
        ) : (
          <meta name="robots" content="index, follow, max-image-preview:large" />
        )}

        <meta property="og:site_name" content={env.SITE_NAME} />
        <meta property="og:locale" content="es_ES" />
        <meta property="og:type" content={seo.type ?? 'website'} />
        <meta property="og:title" content={seo.title} />
        <meta property="og:description" content={seo.description} />
        <meta property="og:url" content={seo.canonical} />
        <meta property="og:image" content={ogImage} />
        {seo.imageAlt ? <meta property="og:image:alt" content={seo.imageAlt} /> : null}
        {seo.publishedTime ? <meta property="article:published_time" content={seo.publishedTime} /> : null}
        {seo.modifiedTime ? <meta property="article:modified_time" content={seo.modifiedTime} /> : null}

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={seo.title} />
        <meta name="twitter:description" content={seo.description} />
        <meta name="twitter:image" content={ogImage} />

        <meta name="theme-color" content="#0f1115" />
        <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/assets/styles.css" />
        <link rel="alternate" type="application/rss+xml" title={env.SITE_NAME} href={`${siteUrl}/rss.xml`} />

        <script nonce={nonce}>{raw(THEME_BOOTSTRAP)}</script>
        {seo.jsonLd ? (
          <script type="application/ld+json" nonce={nonce}>
            {raw(seo.jsonLd)}
          </script>
        ) : null}
      </head>
      <body class={props.bodyClass ?? ''}>
        <a class="skip-link" href="#contenido">
          Saltar al contenido
        </a>

        {isAdmin ? (
          <AdminHeader siteName={env.SITE_NAME} badge={adminBadge} user={user} csrfToken={csrfToken} />
        ) : (
          <PublicHeader siteName={env.SITE_NAME} tagline={null} />
        )}

        <main id="contenido" class="main">
          {children}
        </main>

        <SiteFooter siteName={env.SITE_NAME} isAdmin={isAdmin} />

        <div id="toasts" class="toasts" role="status" aria-live="polite" aria-atomic="false" />

        <script nonce={nonce} src="/assets/app.js" type="module" defer />
        {scripts.map((src) => (
          <script nonce={nonce} src={src} type="module" defer />
        ))}
      </body>
    </html>
  );
};

const PublicHeader: FC<{ siteName: string; tagline: string | null }> = ({ siteName }) => (
  <header class="site-header">
    <div class="wrap site-header__inner">
      <a class="brand" href="/">
        <span class="brand__mark" aria-hidden="true">
          &#9651;
        </span>
        <span class="brand__name">{siteName}</span>
      </a>
      <nav class="site-nav" aria-label="Principal">
        <a href="/">Catálogo</a>
        <a href="/sobre">Sobre el sitio</a>
      </nav>
      <button
        type="button"
        class="theme-toggle"
        data-theme-toggle
        aria-label="Cambiar entre tema claro y oscuro"
      >
        <span class="theme-toggle__icon" aria-hidden="true" />
      </button>
    </div>
  </header>
);

const AdminHeader: FC<{
  siteName: string;
  badge: number;
  user: { displayName: string; role: string } | null;
  csrfToken: string | null;
}> = ({ siteName, badge, user, csrfToken }) => (
  <header class="site-header site-header--admin">
    <div class="wrap site-header__inner">
      <a class="brand" href="/admin">
        <span class="brand__mark" aria-hidden="true">
          &#9651;
        </span>
        <span class="brand__name">{siteName} · Panel</span>
      </a>
      <nav class="site-nav" aria-label="Administración">
        <a href="/admin">Dashboard</a>
        <a href="/admin/resenas">Reseñas</a>
        <a href="/admin/comentarios">
          Comentarios
          {badge > 0 ? (
            <span class="badge badge--alert" aria-label={`${badge} comentarios pendientes`}>
              {badge}
            </span>
          ) : null}
        </a>
        <a href="/admin/taxonomias">Taxonomías</a>
        <a href="/admin/ajustes">Ajustes</a>
      </nav>
      <div class="admin-user">
        {user ? <span class="admin-user__name">{user.displayName}</span> : null}
        <form method="post" action="/admin/logout">
          {csrfToken ? <input type="hidden" name="_csrf" value={csrfToken} /> : null}
          <button type="submit" class="btn btn--ghost btn--sm">
            Salir
          </button>
        </form>
      </div>
    </div>
  </header>
);

const SiteFooter: FC<{ siteName: string; isAdmin: boolean }> = ({ siteName, isAdmin }) => (
  <footer class="site-footer">
    <div class="wrap site-footer__inner">
      <p>
        © {new Date().getFullYear()} {siteName}
      </p>
      {!isAdmin ? (
        <nav aria-label="Legal">
          <a href="/privacidad">Privacidad</a>
          <a href="/cookies">Cookies</a>
          <a href="/rss.xml">RSS</a>
        </nav>
      ) : null}
    </div>
  </footer>
);
