import type { FC, PropsWithChildren } from 'hono/jsx';
import { raw } from 'hono/html';
import { Icon } from '../components/icons';
import { BrandLockup } from '../components/brand';

/**
 * Cáscara del subdominio privado.
 *
 * No es el `Layout` del sitio público y no debe serlo: aquí no hay SEO, ni Open
 * Graph, ni RSS, ni navegación pública, ni nada que indexar. Lo que se comparte
 * es lo que importa —la hoja de estilos, la marca y los iconos—, así que la
 * biblioteca se ve como el resto del sitio sin arrastrar su cabecera.
 */

const THEME_BOOTSTRAP = `try{var t=localStorage.getItem('tdl-theme');document.documentElement.dataset.theme=(t==='light')?'light':'dark'}catch(e){}`;

export interface BooksLayoutProps {
  nonce: string;
  title: string;
  path?: string;
  scripts?: string[];
  bodyClass?: string;
  csrfToken?: string | null;
  user?: { displayName: string } | null;
  /** El lector ocupa toda la ventana: sin el ancho máximo del contenido. */
  wide?: boolean;
}

const NAV = [
  { href: '/', label: 'Estantería', icon: 'book-open' as const },
  { href: '/biblioteca', label: 'Biblioteca', icon: 'book' as const },
  { href: '/copias', label: 'Copias', icon: 'download' as const },
];

function isActive(href: string, path: string): boolean {
  return href === '/' ? path === '/' : path.startsWith(href);
}

export const BooksLayout: FC<PropsWithChildren<BooksLayoutProps>> = ({
  nonce, title, path = '', scripts = [], bodyClass = '', csrfToken = null, user = null, wide = false, children,
}) => (
  <html lang="es" data-theme-default="dark">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <title>{`${title} · Biblioteca`}</title>
      <meta name="robots" content="noindex, nofollow, noarchive" />
      <meta name="theme-color" content="#1b1a19" />
      <link rel="icon" href="/favicon.ico" sizes="any" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <link rel="preload" href="/assets/fonts/archivo-latin.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
      <link rel="stylesheet" href="/assets/styles.css" />
      <script nonce={nonce}>{raw(THEME_BOOTSTRAP)}</script>
    </head>
    <body class={`body--books ${bodyClass}`.trim()}>
      <a class="skip-link" href="#contenido">Saltar al contenido</a>

      {user ? (
        <header class="site-header">
          <div class={`${wide ? 'wrap wrap--wide' : 'wrap'} site-header__inner`}>
            <a class="brand" href="/">
              <BrandLockup siteName="Biblioteca" />
            </a>

            <nav class="site-nav" aria-label="Biblioteca">
              {NAV.map((item) => (
                <a href={item.href} aria-current={isActive(item.href, path) ? 'page' : undefined}>
                  <Icon name={item.icon} size={13} />
                  {item.label}
                </a>
              ))}
            </nav>

            <div class="header-tools">
              <span class="admin-user__name">{user.displayName}</span>
              <form method="post" action="/logout">
                <input type="hidden" name="_csrf" value={csrfToken ?? ''} />
                <button class="btn btn--ghost btn--sm" type="submit">
                  <Icon name="logout" size={14} />
                  <span>Salir</span>
                </button>
              </form>
            </div>
          </div>
        </header>
      ) : null}

      <main id="contenido" class={wide ? '' : 'wrap'}>
        {children}
      </main>

      {scripts.map((src) => (
        <script type="module" src={src} nonce={nonce} defer />
      ))}
    </body>
  </html>
);
