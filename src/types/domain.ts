/** Vocabulario del dominio + etiquetas en español (una sola fuente de verdad). */

export const CONTENT_TYPES = [
  'BOOK', 'NOVEL', 'MOVIE', 'SERIES', 'ANIME', 'COMIC', 'MANGA', 'GAME', 'OTHER',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  BOOK: 'Libro',
  NOVEL: 'Novela',
  MOVIE: 'Película',
  SERIES: 'Serie',
  ANIME: 'Anime',
  COMIC: 'Cómic',
  MANGA: 'Manga',
  GAME: 'Videojuego',
  OTHER: 'Otro',
};

export const AVAILABILITY = [
  'SUBSCRIPTION', 'RENT', 'BUY', 'FREE', 'LIBRARY', 'PHYSICAL', 'OTHER',
] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  SUBSCRIPTION: 'Incluido con suscripción',
  RENT: 'Alquiler',
  BUY: 'Compra',
  FREE: 'Gratis',
  LIBRARY: 'Biblioteca',
  PHYSICAL: 'Edición física',
  OTHER: 'Otro',
};

export const PLATFORM_KINDS = ['STREAMING', 'STORE', 'LIBRARY', 'AUDIO', 'GAME', 'OTHER'] as const;
export type PlatformKind = (typeof PLATFORM_KINDS)[number];

export const PLATFORM_KIND_LABELS: Record<PlatformKind, string> = {
  STREAMING: 'Streaming',
  STORE: 'Tienda',
  LIBRARY: 'Biblioteca',
  AUDIO: 'Audio',
  GAME: 'Videojuegos',
  OTHER: 'Otro',
};

export const COMMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'REPORTED', 'HIDDEN'] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export const COMMENT_STATUS_LABELS: Record<CommentStatus, string> = {
  PENDING: 'Pendiente',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  REPORTED: 'Reportado',
  HIDDEN: 'Oculto',
};

export const REPORT_REASONS = ['SPAM', 'INSULTS', 'HARASSMENT', 'SPOILERS', 'OFFENSIVE', 'OTHER'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  SPAM: 'Spam o publicidad',
  INSULTS: 'Insultos',
  HARASSMENT: 'Acoso',
  SPOILERS: 'Spoilers sin avisar',
  OFFENSIVE: 'Contenido ofensivo',
  OTHER: 'Otro motivo',
};

export const REVIEW_SORTS = ['recent', 'oldest', 'rating', 'comments'] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

export const REVIEW_SORT_LABELS: Record<ReviewSort, string> = {
  recent: 'Más recientes',
  oldest: 'Más antiguas',
  rating: 'Mejor valoradas',
  comments: 'Más comentadas',
};

/**
 * La nota.
 *
 * Se publica **sobre 10 y con medio punto de precisión**: 7,5 es una nota
 * válida y 7,3 no. Por dentro se guarda en **medios puntos** —un entero 0..20—
 * y no como decimal: un entero se compara, se ordena y se indexa sin sorpresas
 * de coma flotante, y 7,5 no tiene representación exacta en binario.
 *
 * La conversión vive aquí y sólo aquí. La columna es `reviews.rating_half`.
 */
export const MAX_SCORE_HALF = 20;

/** Lo que se escribe en el formulario: de 0 a 10, de medio en medio. */
export const MAX_SCORE = 10;
export const SCORE_STEP = 0.5;

/** De la nota que se escribe (7,5) a lo que se guarda (15). */
export function scoreToHalf(score: number): number {
  const acotada = Math.max(0, Math.min(MAX_SCORE, Number.isFinite(score) ? score : 0));
  // Se redondea al medio punto más cercano: lo que llegue con más precisión de
  // la que la escala admite se ajusta en vez de rechazarse.
  return Math.round(acotada * 2);
}

/** De lo que se guarda (15) a la nota (7,5). */
export function halfToScore(half: number): number {
  return Math.round(Math.max(0, Math.min(MAX_SCORE_HALF, half))) / 2;
}

/**
 * La nota tal como la pinta el sitio: sobre 10 y con coma decimal, según el
 * brand kit. Siempre con un decimal, también en los enteros — «8,0» y «7,5»
 * ocupan lo mismo y una columna de notas no baila.
 */
export function formatScore(half: number): string {
  return halfToScore(half).toFixed(1).replace('.', ',');
}

/** Los 21 valores de la escala, para pintar un desplegable sin inventarlos. */
export function scoreOptions(): number[] {
  return Array.from({ length: MAX_SCORE_HALF + 1 }, (_, i) => i);
}

export const PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 48;

// ------------------------------------------------------- lista de pendientes --

export const WATCHLIST_STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE', 'DROPPED'] as const;
export type WatchlistStatus = (typeof WATCHLIST_STATUSES)[number];

export const WATCHLIST_STATUS_LABELS: Record<WatchlistStatus, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  DONE: 'Terminado',
  DROPPED: 'Descartado',
};

/** Estados que siguen "vivos": los únicos que se muestran en público. */
export const WATCHLIST_ACTIVE_STATUSES = ['PENDING', 'IN_PROGRESS'] as const;

export const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  HIGH: 'Alta',
  MEDIUM: 'Media',
  LOW: 'Baja',
};

/** Orden de cola: alta primero. SQLite ordena texto, así que se mapea a número. */
export const PRIORITY_WEIGHT: Record<Priority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/**
 * Criterios de ordenación del catálogo de la biblioteca.
 *
 * Aquí y no junto a los comparadores porque el vocabulario del dominio lo
 * comparten la validación y la vista, igual que `REVIEW_SORTS` y
 * `WATCHLIST_SORTS`. Los comparadores viven en `server/lib/library-sort.ts`.
 *
 * El primero es el de por omisión: el apellido del autor, que es como está
 * ordenada la biblioteca en papel.
 */
export const LIBRARY_SORTS = [
  'apellido', 'titulo', 'nombre', 'recientes',
  'anyo-desc', 'anyo-asc', 'paginas-desc', 'paginas-asc',
  'estado', 'nota',
] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];
export const LIBRARY_SORT_DEFAULT: LibrarySort = 'apellido';

export const WATCHLIST_SORTS = ['priority', 'recent', 'oldest', 'title'] as const;
export type WatchlistSort = (typeof WATCHLIST_SORTS)[number];

export const WATCHLIST_SORT_LABELS: Record<WatchlistSort, string> = {
  priority: 'Prioridad',
  recent: 'Añadidos recientemente',
  oldest: 'Añadidos hace más tiempo',
  title: 'Título (A–Z)',
};

// ------------------------------------------------------ recomendaciones --

export const RECOMMENDATION_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export const RECOMMENDATION_STATUS_LABELS: Record<RecommendationStatus, string> = {
  PENDING: 'Por revisar',
  ACCEPTED: 'Aceptada',
  REJECTED: 'Descartada',
};

/** Qué se hizo con una recomendación aceptada. */
export const RECOMMENDATION_RESOLUTIONS = ['REVIEW', 'WATCHLIST'] as const;
export type RecommendationResolution = (typeof RECOMMENDATION_RESOLUTIONS)[number];

export const RECOMMENDATION_RESOLUTION_LABELS: Record<RecommendationResolution, string> = {
  REVIEW: 'Borrador de reseña',
  WATCHLIST: 'Lista de pendientes',
};

/** Lo que el panel puede hacer con una recomendación. */
export const RECOMMENDATION_ACTIONS = ['to-review', 'to-watchlist', 'reject', 'reopen', 'delete'] as const;
export type RecommendationAction = (typeof RECOMMENDATION_ACTIONS)[number];
