import type { FC, PropsWithChildren } from 'hono/jsx';
import { raw } from 'hono/html';
import type { Bindings } from '../../types/env';
import { Icon } from './components/icons';
import { BrandLockup } from './components/brand';

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
  /** Ruta actual: marca la sección activa en la navegación. */
  path?: string;
}

/**
 * Fija el tema antes de pintar, para que no haya destello al cargar. El sitio
 * es oscuro por omisión y sólo cambia si esa persona eligió el claro; no se
 * consulta la preferencia del sistema. Es un script en línea, permitido por la
 * CSP gracias al nonce por petición (no `unsafe-inline`).
 */
const THEME_BOOTSTRAP = `try{var t=localStorage.getItem('tdl-theme');document.documentElement.dataset.theme=(t==='light')?'light':'dark'}catch(e){}`;


export const Layout: FC<PropsWithChildren<LayoutProps>> = (props) => {
  const {
    env, nonce, seo, children, scripts = [],
    isAdmin = false, adminBadge = 0, user = null, csrfToken = null, path = '',
  } = props;
  const siteUrl = env.SITE_URL.replace(/\/$/, '');
  const ogImage = seo.image ?? `${siteUrl}/assets/brand/og-default.jpg`;

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

        <meta name="theme-color" content="#1b1a19" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />

        {/*
          La familia del sistema se precarga: sin esto el navegador no la
          descubre hasta haber leído la hoja de estilos y el texto parpadea al
          cambiar de tipografía. Es un único fichero variable de 400 a 800.
        */}
        <link rel="preload" href="/assets/fonts/archivo-latin.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
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

        <SiteHeader
          siteName={env.SITE_NAME}
          path={path}
          user={user}
          csrfToken={csrfToken}
          badge={adminBadge}
          isAdmin={isAdmin}
        />

        <main id="contenido" class="main">
          {children}
        </main>

        <SiteFooter siteName={env.SITE_NAME} />

        <div id="toasts" class="toasts" role="status" aria-live="polite" aria-atomic="false" />

        <script nonce={nonce} src="/assets/app.js" type="module" defer />
        {scripts.map((src) => (
          <script nonce={nonce} src={src} type="module" defer />
        ))}
      </body>
    </html>
  );
};

/** Sección activa de la navegación. La raíz sólo coincide de forma exacta. */
function esActiva(href: string, path: string): boolean {
  if (href === '/' || href === '/admin') return path === href;
  return path === href || path.startsWith(`${href}/`);
}

const NAV_PUBLICA = [
  { href: '/', label: 'Catálogo' },
  { href: '/pendientes', label: 'Pendientes' },
  { href: '/recomendar', label: 'Recomendar' },
  { href: '/sobre', label: 'Sobre el sitio' },
];

const NAV_ADMIN = [
  { href: '/admin', label: 'Panel' },
  { href: '/admin/resenas', label: 'Reseñas' },
  { href: '/admin/pendientes', label: 'Pendientes' },
  { href: '/admin/comentarios', label: 'Comentarios' },
  { href: '/admin/recomendaciones', label: 'Recomendaciones' },
  { href: '/admin/taxonomias', label: 'Taxonomías' },
  { href: '/admin/ajustes', label: 'Ajustes' },
];

/** El icono que se ve es el del tema al que se va a cambiar, no el actual. */
const ThemeToggle: FC = () => (
  <button
    type="button"
    class="icon-btn theme-toggle"
    data-theme-toggle
    aria-label="Cambiar entre tema claro y oscuro"
  >
    <Icon name="moon" size={18} class="icon--moon" />
    <Icon name="sun" size={18} class="icon--sun" />
  </button>
);

/**
 * Menú de la sesión abierta. Es un `<details>`: se abre, se cierra y se recorre
 * con el teclado sin una línea de JavaScript, que además sólo lo mejora
 * (cerrarlo con Escape o al pulsar fuera).
 */
const UserMenu: FC<{
  user: { displayName: string; role: string };
  csrfToken: string | null;
  badge: number;
}> = ({ user, csrfToken, badge }) => (
  <details class="usermenu" data-user-menu>
    <summary class="usermenu__trigger" aria-haspopup="menu">
      <span class="usermenu__avatar" aria-hidden="true">
        {user.displayName.slice(0, 1).toUpperCase()}
      </span>
      <span class="usermenu__name">{user.displayName}</span>
      {badge > 0 ? (
        <span class="usermenu__dot" aria-label={`${badge} cosas pendientes de revisar`} />
      ) : null}
      <Icon name="chevron-down" size={14} class="usermenu__caret" />
    </summary>

    <div class="usermenu__panel" role="menu">
      <p class="usermenu__head">
        {user.displayName}
        <span>{user.role === 'ADMIN' ? 'Administración' : 'Lectura'}</span>
      </p>

      <nav class="usermenu__nav" aria-label="Gestión del sitio">
        {NAV_ADMIN.map((item) => (
          <a role="menuitem" href={item.href}>
            {item.label}
            {item.href === '/admin/comentarios' && badge > 0 ? (
              <span class="badge badge--alert">{badge}</span>
            ) : null}
          </a>
        ))}
      </nav>

      <form method="post" action="/admin/logout" class="usermenu__salir">
        {csrfToken ? <input type="hidden" name="_csrf" value={csrfToken} /> : null}
        <button type="submit" class="btn btn--ghost btn--sm btn--block">
          <Icon name="logout" size={14} />
          Salir
        </button>
      </form>
    </div>
  </details>
);

/**
 * Una única cabecera para todo el sitio. La navegación pública está siempre —
 * también dentro del panel, para poder volver al catálogo de un clic— y la
 * gestión cuelga del menú de usuario. En las páginas del panel se añade debajo
 * una segunda barra con sus secciones.
 */
const SiteHeader: FC<{
  siteName: string;
  path: string;
  user: { displayName: string; role: string } | null;
  csrfToken: string | null;
  badge: number;
  isAdmin: boolean;
}> = ({ siteName, path, user, csrfToken, badge, isAdmin }) => (
  <header class="site-header">
    <div class="wrap site-header__inner">
      {/* Lockup horizontal de la marca «1C · Tres reglas»: isotipo y nombre. */}
      <a class="brand" href={isAdmin ? '/admin' : '/'}>
        <BrandLockup siteName={isAdmin ? `${siteName} · Panel` : siteName} />
      </a>

      <nav class="site-nav" aria-label="Principal">
        {NAV_PUBLICA.map((item) => (
          <a href={item.href} aria-current={esActiva(item.href, path) ? 'page' : undefined}>
            {item.label}
          </a>
        ))}
      </nav>

      <div class="header-tools">
        {user ? (
          <UserMenu user={user} csrfToken={csrfToken} badge={badge} />
        ) : path.startsWith('/admin') ? null : (
          /* En la propia página de acceso el botón sobra: lleva a donde ya estás. */
          <a class="btn btn--ghost btn--sm header-login" href="/admin/login" aria-label="Acceso al panel">
            <Icon name="lock" size={14} />
            {/* En móvil queda sólo el icono: el nombre lo da el `aria-label`. */}
            <span class="header-login__text">Acceso</span>
          </a>
        )}
        <ThemeToggle />
      </div>
    </div>

    {isAdmin ? (
      <div class="admin-bar">
        <nav class="wrap admin-bar__inner" aria-label="Administración">
          {NAV_ADMIN.map((item) => (
            <a href={item.href} aria-current={esActiva(item.href, path) ? 'page' : undefined}>
              {item.label}
              {item.href === '/admin/comentarios' && badge > 0 ? (
                <span class="badge badge--alert" aria-label={`${badge} cosas pendientes de revisar`}>
                  {badge}
                </span>
              ) : null}
            </a>
          ))}
        </nav>
      </div>
    ) : null}
  </header>
);

const SiteFooter: FC<{ siteName: string }> = ({ siteName }) => (
  <footer class="site-footer">
    <div class="wrap site-footer__inner">
      <p class="site-footer__copy">
        © {new Date().getFullYear()} {siteName}
      </p>
      <nav class="site-footer__nav" aria-label="Enlaces del pie">
        <a href="/sobre">Sobre el sitio</a>
        <a href="/recomendar">Recomendar</a>
        <a href="/rss.xml">RSS</a>
        <a href="/privacidad">Privacidad</a>
        <a href="/cookies">Cookies</a>
      </nav>
    </div>
  </footer>
);
