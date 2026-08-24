import { z } from 'zod';
import {
  CONTENT_TYPES, AVAILABILITY, PLATFORM_KINDS, REPORT_REASONS, REVIEW_SORTS,
  COMMENT_STATUSES, MAX_RATING_HALF_STARS, PAGE_SIZE, MAX_PAGE_SIZE,
  WATCHLIST_STATUSES, WATCHLIST_SORTS, PRIORITIES,
} from '../types/domain';

/**
 * Validación de entrada. **Todo** input externo (formularios, query string,
 * JSON) pasa por aquí antes de llegar a la capa de datos. El WAF de Cloudflare
 * es una capa adicional, nunca la única.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  trimmed(max).optional().transform((v) => (v && v.length ? v : undefined));

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
