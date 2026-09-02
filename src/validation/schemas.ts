import { z } from 'zod';
import {
  CONTENT_TYPES, AVAILABILITY, PLATFORM_KINDS, REPORT_REASONS, REVIEW_SORTS,
  COMMENT_STATUSES, MAX_RATING_HALF_STARS, PAGE_SIZE, MAX_PAGE_SIZE,
  WATCHLIST_STATUSES, WATCHLIST_SORTS, PRIORITIES,
  RECOMMENDATION_STATUSES, RECOMMENDATION_ACTIONS,
  LIBRARY_SORTS, LIBRARY_SORT_DEFAULT,
} from '../types/domain';

/**
 * Validación de entrada. **Todo** input externo (formularios, query string,
 * JSON) pasa por aquí antes de llegar a la capa de datos. El WAF de Cloudflare
 * es una capa adicional, nunca la única.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  trimmed(max).optional().transform((v) => (v && v.length ? v : undefined));

/**
 * Igual que `optionalText`, pero acepta además `null`.
 *
 * `optional()` sólo admite `undefined`, y JSON no tiene ese valor: un cliente
 * que quiere decir «este campo está vacío» manda `null`. Donde la columna de la
 * base es nullable, el esquema tiene que admitirlo — si no, el campo vacío se
 * convierte en un 400 sin explicación.
 */
const nullableText = (max: number) =>
  trimmed(max).nullish().transform((v) => (v && v.length ? v : undefined));

export const idSchema = z.string().uuid();

/**
 * URL destinada a acabar en un `href`.
 *
 * `z.string().url()` NO basta: se apoya en el constructor `URL`, que acepta
 * cualquier esquema, incluido `javascript:`. Como estos valores se pintan como
 * enlaces, aquí se restringe explícitamente a http/https.
 */
export const httpUrl = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .url('URL inválida')
    .refine((value) => /^https?:\/\//i.test(value), {
      message: 'El enlace debe empezar por http:// o https://',
    });
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(90)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug inválido');

// ------------------------------------------------------------------- login --
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email inválido').max(254),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(200),
  turnstileToken: z.string().max(2048).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordSchema = z
  .string()
  .min(12, 'La contraseña debe tener al menos 12 caracteres')
  .max(200)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v), {
    message: 'Debe incluir mayúsculas, minúsculas y números',
  });

// ------------------------------------------------------------------ reseñas --
export const reviewPlatformInput = z.object({
  platformId: idSchema,
  url: httpUrl(500).optional().or(z.literal('')),
  availability: z.enum(AVAILABILITY).default('OTHER'),
  note: optionalText(120),
});

export const reviewInputSchema = z.object({
  titleEs: trimmed(200).min(2, 'El título es obligatorio'),
  titleOriginal: optionalText(200),
  otherTitles: z.array(trimmed(200)).max(10).default([]),
  contentType: z.enum(CONTENT_TYPES),
  categoryId: idSchema.optional().nullable(),
  year: z.coerce.number().int().min(1400).max(2200).optional().nullable(),
  creator: optionalText(200),
  country: optionalText(100),
  durationMin: z.coerce.number().int().min(1).max(100000).optional().nullable(),
  episodes: z.coerce.number().int().min(1).max(100000).optional().nullable(),
  volumes: z.coerce.number().int().min(1).max(100000).optional().nullable(),
  /** 0..10 (medias estrellas) */
  rating: z.coerce.number().int().min(0).max(MAX_RATING_HALF_STARS).default(0),
  summary: optionalText(600),
  bodyHtml: z.string().max(400_000).default(''),
  hasSpoilers: z.coerce.boolean().default(false),
  status: z.enum(['DRAFT', 'PUBLISHED']).default('DRAFT'),
  commentsMode: z.enum(['INHERIT', 'OPEN', 'AUTH', 'CLOSED']).default('INHERIT'),
  coverKey: z.string().max(120).optional().nullable(),
  coverAlt: optionalText(200),
  seoTitle: optionalText(70),
  seoDescription: optionalText(180),
  slug: slugSchema.optional(),
  genreIds: z.array(idSchema).max(20).default([]),
  platforms: z.array(reviewPlatformInput).max(20).default([]),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export const reviewQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: slugSchema.optional(),
  genre: slugSchema.optional(),
  type: z.enum(CONTENT_TYPES).optional(),
  sort: z.enum(REVIEW_SORTS).default('recent'),
  page: z.coerce.number().int().min(1).max(2000).default(1),
  perPage: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(PAGE_SIZE),
});
export type ReviewQuery = z.infer<typeof reviewQuerySchema>;

export const adminReviewQuerySchema = reviewQuerySchema.extend({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ALL']).default('ALL'),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

// -------------------------------------------------------------- comentarios --
export const commentInputSchema = z.object({
  reviewId: idSchema,
  parentId: idSchema.optional().nullable(),
  alias: trimmed(40).min(2, 'El alias debe tener al menos 2 caracteres'),
  body: z.string().trim().min(2, 'El comentario está vacío').max(2000),
  turnstileToken: z.string().max(2048).optional(),
  /** honeypot: los bots lo rellenan, las personas no lo ven */
  website: z.string().max(200).optional(),
});
export type CommentInput = z.infer<typeof commentInputSchema>;

export const reportInputSchema = z.object({
  commentId: idSchema,
  reason: z.enum(REPORT_REASONS),
  details: optionalText(500),
  turnstileToken: z.string().max(2048).optional(),
});
export type ReportInput = z.infer<typeof reportInputSchema>;

export const moderationActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'hide', 'restore', 'delete', 'purge']),
  commentId: idSchema,
});

export const adminCommentQuerySchema = z.object({
  status: z.enum([...COMMENT_STATUSES, 'ALL']).default('PENDING'),
  reviewId: idSchema.optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(2000).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});

// ---------------------------------------------------------------- taxonomía --
export const categoryInputSchema = z.object({
  name: trimmed(80).min(2),
  slug: slugSchema.optional(),
  description: optionalText(300),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.coerce.boolean().default(true),
});

export const genreInputSchema = z.object({
  name: trimmed(60).min(2),
  slug: slugSchema.optional(),
});

export const platformInputSchema = z.object({
  name: trimmed(80).min(2),
  slug: slugSchema.optional(),
  kind: z.enum(PLATFORM_KINDS).default('OTHER'),
  baseUrl: httpUrl(300).optional().or(z.literal('')),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal('')),
  isActive: z.coerce.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

// ------------------------------------------------------ lista de pendientes --
export const watchlistInputSchema = z.object({
  titleEs: trimmed(200).min(2, 'El título es obligatorio'),
  titleOriginal: optionalText(200),
  contentType: z.enum(CONTENT_TYPES),
  categoryId: idSchema.optional().nullable(),
  year: z.coerce.number().int().min(1400).max(2200).optional().nullable(),
  creator: optionalText(200),
  note: optionalText(500),
  sourceUrl: httpUrl(500).optional().or(z.literal('')),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  status: z.enum(WATCHLIST_STATUSES).default('PENDING'),
  isPublic: z.coerce.boolean().default(true),
  coverKey: z.string().max(120).optional().nullable(),
  coverAlt: optionalText(200),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});
export type WatchlistInput = z.infer<typeof watchlistInputSchema>;

export const watchlistQuerySchema = z.object({
  status: z.enum([...WATCHLIST_STATUSES, 'ALL', 'ACTIVE']).default('ACTIVE'),
  type: z.enum(CONTENT_TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(WATCHLIST_SORTS).default('priority'),
  page: z.coerce.number().int().min(1).max(2000).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
});
export type WatchlistQueryInput = z.infer<typeof watchlistQuerySchema>;

export const watchlistActionSchema = z.object({
  action: z.enum(['start', 'complete', 'drop', 'reopen', 'delete', 'convert', 'toggle-public']),
});

/** Convierte un ZodError en un mapa campo -> mensaje, apto para el formulario. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

// ------------------------------------------------------ recomendaciones --

/**
 * Lo que envía el público. Esquema cerrado: nada de campos no declarados, y el
 * enlace pasa por `httpUrl()` porque acaba en un `href` del panel.
 */
export const recommendationInputSchema = z.object({
  titleEs: trimmed(200).min(2, 'Dinos qué obra recomiendas'),
  contentType: z.enum(CONTENT_TYPES),
  creator: optionalText(200),
  year: z.coerce.number().int().min(1400).max(2200).optional().nullable(),
  note: trimmed(1500).min(10, 'Cuéntanos por qué la recomiendas, aunque sea en una línea'),
  sourceUrl: httpUrl(500).optional().or(z.literal('')),
  alias: optionalText(60),
});
export type RecommendationInput = z.infer<typeof recommendationInputSchema>;

export const recommendationQuerySchema = z.object({
  status: z.enum([...RECOMMENDATION_STATUSES, 'ALL']).default('PENDING'),
  page: z.coerce.number().int().min(1).max(2000).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
});
export type RecommendationQueryInput = z.infer<typeof recommendationQuerySchema>;

export const recommendationActionSchema = z.object({
  action: z.enum(RECOMMENDATION_ACTIONS),
});

// --------------------------------------------------- biblioteca privada --
/**
 * Entradas del subdominio `books.`. Mismos criterios que el resto: esquemas
 * cerrados, nada de campos no declarados y ninguna confianza en lo que llegue
 * del navegador, aunque detrás haya un login.
 */

export const documentMetaSchema = z.object({
  title: trimmed(300).min(1, 'El título es obligatorio'),
  author: optionalText(200),
});

export const documentPatchSchema = z.object({
  title: trimmed(300).min(1, 'El título es obligatorio'),
  author: optionalText(200),
  notes: optionalText(2000),
});

/**
 * Posición de lectura. `scrollPct` va en milésimas de página (0..1000) para
 * guardar un entero y no un decimal, igual que la puntuación de las reseñas.
 */
export const readingProgressSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000),
  scrollPct: z.coerce.number().int().min(0).max(1000).default(0),
});

/** Rectángulo del subrayado, normalizado al tamaño de la página (0..1). */
/**
 * Los rectángulos llegan de medir el DOM, así que traen error de subpíxel: un
 * `-0.0004` al seleccionar desde el borde izquierdo bastaba para tumbar la
 * anotación entera con un 400. Aquí se recortan al margen en vez de rechazarse;
 * lo que se descarta arriba, en el cliente, es lo que cae fuera de la página.
 */
const clampedRectSchema = z.object({
  x: z.coerce.number().catch(0),
  y: z.coerce.number().catch(0),
  w: z.coerce.number().catch(0),
  h: z.coerce.number().catch(0),
}).transform((r) => ({
  x: Math.min(1, Math.max(0, r.x)),
  y: Math.min(1, Math.max(0, r.y)),
  w: Math.min(1, Math.max(0, r.w)),
  h: Math.min(1, Math.max(0, r.h)),
}));

export const annotationCreateSchema = z.object({
  kind: z.enum(['HIGHLIGHT', 'NOTE']),
  page: z.number().int().min(1).max(100_000),
  // Un subrayado sin rectángulos no se podría pintar, y 200 por anotación es
  // más de lo que ocupa cualquier selección razonable.
  rects: z.array(clampedRectSchema).max(200).default([]),
  quote: nullableText(2000),
  body: nullableText(4000),
  color: z.enum(['YELLOW', 'RED', 'GREEN', 'BLUE']).default('YELLOW'),
});

export const annotationPatchSchema = z.object({
  body: nullableText(4000),
  color: z.enum(['YELLOW', 'RED', 'GREEN', 'BLUE']).optional(),
});

/**
 * ISBN tal y como llega del teclado o de la cámara. Aquí sólo se comprueba la
 * forma: el dígito de control lo valida `parseIsbn()`.
 */
export const isbnSchema = z.object({
  isbn: z.string().trim().max(20).regex(/^[\d\sXx-]+$/, 'Un ISBN sólo lleva dígitos, guiones y una X final'),
});

export const LIBRARY_STATUSES = ['OWNED', 'READING', 'READ', 'LENT', 'WISHLIST'] as const;

export const libraryBookSchema = z.object({
  isbn13: z.string().trim().max(20).optional().or(z.literal('')),
  isbn10: z.string().trim().max(20).optional().or(z.literal('')),
  title: trimmed(300).min(1, 'El título es obligatorio'),
  subtitle: optionalText(300),
  authors: optionalText(300),
  publisher: optionalText(200),
  publishedYear: z.coerce.number().int().min(1400).max(2200).optional().nullable(),
  pageCount: z.coerce.number().int().min(1).max(50_000).optional().nullable(),
  language: optionalText(20),
  location: optionalText(120),
  status: z.enum(LIBRARY_STATUSES).default('OWNED'),
  // Entero 0..10, la misma escala publicada que las reseñas.
  rating: z.coerce.number().int().min(0).max(10).optional().nullable(),
  notes: optionalText(4000),
  coverKey: z.string().trim().max(120).optional().or(z.literal('')),
  coverUrl: z.string().trim().max(500).optional().or(z.literal('')),
});

export const librarySearchSchema = z.object({
  q: optionalText(120),
  status: z.enum([...LIBRARY_STATUSES, 'ALL']).default('ALL'),
  // Lista cerrada: el criterio elige un comparador ya escrito, nunca una
  // columna ni un trozo de SQL que venga de la URL. La lista y el valor por
  // omisión salen de `lib/library-sort.ts`, que es donde viven los
  // comparadores: declararlos aquí otra vez sería tener dos fuentes.
  sort: z.enum(LIBRARY_SORTS).catch(LIBRARY_SORT_DEFAULT).default(LIBRARY_SORT_DEFAULT),
});

export type DocumentMetaInput = z.infer<typeof documentMetaSchema>;
export type ReadingProgressInput = z.infer<typeof readingProgressSchema>;
export type AnnotationCreateInput = z.infer<typeof annotationCreateSchema>;
export type LibraryBookInput = z.infer<typeof libraryBookSchema>;

/**
 * Dirección de una imagen que el servidor va a descargar para guardarla como
 * portada. `httpUrl()` y no `z.string().url()`: este último acepta esquemas
 * como `javascript:`. Las comprobaciones de destino —puertos, direcciones
 * internas, redirecciones— están en `lib/remote-image.ts`.
 */
export const coverUrlSchema = z.object({
  url: httpUrl(2000),
});

/**
 * Ficha en el formato de MyLibrary, tal y como la manda el script de
 * importación. Se valida igual de cerrada que cualquier otra entrada: que
 * venga de un script propio no la convierte en de fiar.
 */
export const myLibraryBookSchema = z.object({
  sourceId: z.coerce.number().int().min(0).max(1_000_000),
  title: trimmed(500).min(1, 'El título es obligatorio'),
  author: nullableText(300),
  additionalAuthors: z.array(trimmed(300)).max(20).default([]),
  isbn: nullableText(40),
  pages: z.coerce.number().int().min(0).max(100_000).nullish(),
  publishedDate: nullableText(100),
  publisher: nullableText(300),
  summary: nullableText(8000),
  series: nullableText(300),
  categories: z.array(trimmed(120)).max(40).default([]),
  comments: z.array(trimmed(2000)).max(40).default([]),
  readingDates: nullableText(500),
  read: z.boolean().default(false),
  inWishlist: z.boolean().default(false),
  amazonUrl: nullableText(1000),
  fnacUrl: nullableText(1000),
  /** Clave de la portada, ya subida por `/api/portadas`. */
  coverKey: z.string().trim().max(120).optional().or(z.literal('')),
});
