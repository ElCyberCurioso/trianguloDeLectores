import type { FC } from 'hono/jsx';

/**
 * Iconografía del sitio. Lucide, trazo de 2,2, remate recto y caja de 24, tal
 * como fija el brand kit. SVG en línea y `currentColor`: heredan
 * color y tamaño del texto que los rodea, se ven igual en todos los sistemas y
 * no cuestan ninguna petición extra.
 *
 * Sustituyen a los emoji, que cada plataforma dibuja a su manera y que un lector
 * de pantalla lee en voz alta con nombres largos e inesperados. Por eso van
 * siempre con `aria-hidden`: el significado lo aporta el texto de al lado.
 */

export type IconName =
  | 'star'
  | 'comment'
  | 'search'
  | 'external'
  | 'sun'
  | 'moon'
  | 'close'
  | 'warning'
  | 'list'
  | 'book'
  | 'arrow-right'
  | 'clock'
  | 'lock'
  | 'chevron-down'
  | 'logout'
  | 'filter'
  | 'film'
  | 'book-open'
  | 'tv'
  | 'gamepad'
  | 'sparkles'
  | 'download'
  | 'bookmark'
  | 'share'
  | 'trash';

interface IconSpec {
  /** Trazos del dibujo. */
  d: string[];
  /** Iconos macizos (la estrella): se rellenan en vez de trazarse. */
  fill?: boolean;
  /** Formas que no son un `path`: círculos y rayos. */
  shape?: 'search' | 'sun' | 'clock';
}

const ICONS: Record<IconName, IconSpec> = {
  star: {
    fill: true,
    d: ['M12 2.6l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.4l-5.8 3.05 1.1-6.46-4.69-4.58 6.49-.94z'],
  },
  comment: {
    d: [
      'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z',
    ],
  },
  search: { d: ['M21 21l-4.35-4.35'], shape: 'search' },
  external: {
    d: ['M15 3h6v6', 'M10 14 21 3', 'M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5'],
  },
  sun: { d: [], shape: 'sun' },
  moon: { d: ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'] },
  close: { d: ['M18 6 6 18', 'M6 6l12 12'] },
  warning: {
    d: [
      'm10.29 3.86-8.18 14a2 2 0 0 0 1.71 3h16.36a2 2 0 0 0 1.71-3l-8.18-14a2 2 0 0 0-3.42 0z',
      'M12 9v4',
      'M12 17h.01',
    ],
  },
  list: { d: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'] },
  book: { d: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'] },
  'arrow-right': { d: ['M5 12h14', 'm12 5 7 7-7 7'] },
  clock: { d: ['M12 7v5l3.5 2'], shape: 'clock' },
  lock: { d: ['M7 11V7a5 5 0 0 1 10 0v4', 'M5 11h14v10H5z'] },
  'chevron-down': { d: ['m6 9 6 6 6-6'] },
  logout: { d: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'] },

  /* Único icono propio: las tres reglas de la marca giradas a horizontal.
     Se usa sólo en controles de orden y filtrado. */
  filter: { d: ['M3 6h18', 'M3 12h12', 'M3 18h6'] },

  /* Un icono por medio, y nunca dos medios con el mismo. */
  film: {
    d: ['M4 3h16v18H4z', 'M4 8h4', 'M16 8h4', 'M4 16h4', 'M16 16h4', 'M9 3v18', 'M15 3v18'],
  },
  'book-open': { d: ['M12 7v14', 'M3 5h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v14h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3z'] },
  tv: { d: ['M3 7h18v13H3z', 'm7 3 5 4 5-4'] },
  gamepad: {
    d: ['M6 11h4', 'M8 9v4', 'M15 12h.01', 'M18 10h.01',
        'M17.32 5H6.68a4 4 0 0 0-3.98 3.59l-1.1 9A4 4 0 0 0 5.57 22c1.35 0 2.6-.68 3.34-1.8L10 18h4l1.09 2.2A4 4 0 0 0 18.43 22a4 4 0 0 0 3.97-4.41l-1.1-9A4 4 0 0 0 17.32 5z'],
  },
  sparkles: { d: ['m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', 'M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z'] },

  download: { d: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'] },
  bookmark: { d: ['m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'] },
  share: { d: ['M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8', 'm16 6-4-4-4 4', 'M12 2v13'] },
  trash: { d: ['M3 6h18', 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'] },
};

export interface IconProps {
  name: IconName;
  /** Tamaño del dibujo. Por omisión sigue al texto que lo rodea. */
  size?: number | string;
  class?: string;
}

export const Icon: FC<IconProps> = ({ name, size = '1em', class: className }) => {
  const spec = ICONS[name];
  const macizo = spec.fill === true;

  return (
    <svg
      class={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={macizo ? 'currentColor' : 'none'}
      stroke={macizo ? 'none' : 'currentColor'}
      stroke-width="2.2"
      stroke-linecap="butt"
      stroke-linejoin="miter"
      aria-hidden="true"
      focusable="false"
    >
      {spec.shape === 'search' ? <circle cx="11" cy="11" r="7" /> : null}
      {spec.shape === 'clock' ? <circle cx="12" cy="12" r="9" /> : null}
      {spec.shape === 'sun' ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      ) : null}
      {spec.d.map((d) => (
        <path d={d} />
      ))}
    </svg>
  );
};

/**
 * Un icono por medio, y nunca dos medios con el mismo, como pide el brand kit.
 * El kit define cinco; los cuatro tipos extra del catálogo (novela, cómic,
 * manga y «otros») se resuelven en la misma línea, sin repetir dibujo.
 */
export const MEDIA_ICON: Record<string, IconName> = {
  BOOK: 'book-open',
  NOVEL: 'book-open',
  MOVIE: 'film',
  SERIES: 'tv',
  ANIME: 'sparkles',
  COMIC: 'book',
  MANGA: 'book',
  GAME: 'gamepad',
  OTHER: 'bookmark',
};
