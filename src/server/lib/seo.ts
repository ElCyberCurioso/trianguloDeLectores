import type { Bindings } from '../../types/env';
import type { ReviewDetail } from '../../db/repos/reviews';
import { CONTENT_TYPE_LABELS, halfToScore } from '../../types/domain';
import { variantUrl } from './images';

/** Mapea nuestro tipo de contenido al tipo de Schema.org más ajustado. */
const SCHEMA_TYPE: Record<ReviewDetail['contentType'], string> = {
  BOOK: 'Book',
  NOVEL: 'Book',
  MOVIE: 'Movie',
  SERIES: 'TVSeries',
  ANIME: 'TVSeries',
  COMIC: 'ComicSeries',
  MANGA: 'ComicSeries',
  GAME: 'VideoGame',
  OTHER: 'CreativeWork',
};

function absolute(env: Bindings, path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${env.SITE_URL.replace(/\/$/, '')}${path}`;
}

export function reviewJsonLd(env: Bindings, review: ReviewDetail): string {
  const siteUrl = env.SITE_URL.replace(/\/$/, '');
  const image = absolute(env, variantUrl(env, review.coverKey, 'og'));

  const itemReviewed: Record<string, unknown> = {
    '@type': SCHEMA_TYPE[review.contentType],
    name: review.titleEs,
  };
  if (review.titleOriginal) itemReviewed.alternateName = review.titleOriginal;
  if (review.creator) itemReviewed.author = { '@type': 'Person', name: review.creator };
  if (review.year) itemReviewed.datePublished = String(review.year);
  if (review.genres.length) itemReviewed.genre = review.genres.map((g) => g.name);
  if (image) itemReviewed.image = image;

  const payload = {
    '@context': 'https://schema.org',
    '@type': 'Review',
    url: `${siteUrl}/resena/${review.slug}`,
    name: review.seoTitle ?? review.titleEs,
    headline: review.titleEs,
    inLanguage: 'es-ES',
    datePublished: review.publishedAt ? new Date(review.publishedAt).toISOString() : undefined,
    dateModified: new Date(review.updatedAt).toISOString(),
    author: { '@type': 'Organization', name: env.SITE_NAME, url: siteUrl },
    publisher: { '@type': 'Organization', name: env.SITE_NAME, url: siteUrl },
    reviewBody: review.summary ?? undefined,
    itemReviewed,
    reviewRating: {
      '@type': 'Rating',
      /*
       * La nota se guarda en medios puntos (0..20) y aquí se publica en la
       * escala real, 0..10 con medio punto. `schema.org` espera el número tal
       * como se muestra: mandar el entero interno anunciaría un 15 sobre 10.
       */
      ratingValue: halfToScore(review.ratingHalf),
      bestRating: 10,
      worstRating: 0,
    },
    commentCount: review.commentCount,
  };

  // JSON.stringify escapa comillas; además cerramos `</script>` por si acaso.
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

export function websiteJsonLd(env: Bindings, description: string): string {
  const siteUrl = env.SITE_URL.replace(/\/$/, '');
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: env.SITE_NAME,
    url: siteUrl,
    description,
    inLanguage: 'es-ES',
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl}/?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  }).replace(/</g, '\\u003c');
}

export function reviewSeoTitle(env: Bindings, review: ReviewDetail): string {
  if (review.seoTitle) return review.seoTitle;
  const type = CONTENT_TYPE_LABELS[review.contentType];
  const year = review.year ? ` (${review.year})` : '';
  return `${review.titleEs}${year} — reseña de ${type.toLowerCase()} | ${env.SITE_NAME}`;
}
