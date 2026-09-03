import type { FC } from 'hono/jsx';
import type { ReviewListItem } from '../../../db/repos/reviews';
import type { Bindings } from '../../../types/env';
import { CONTENT_TYPE_LABELS } from '../../../types/domain';
import { variantUrl, coverSrcSet } from '../../lib/images';
import { StarRating, formatDate } from './ui';
import { Icon, MEDIA_ICON } from './icons';

export interface ReviewCardProps {
  review: ReviewListItem;
  env: Bindings;
  /** primera fila del grid: se precarga la portada en vez de diferirla */
  priority?: boolean;
}

/** Contador de comentarios: icono para quien ve, texto para quien escucha. */
const CommentCount: FC<{ total: number }> = ({ total }) => (
  <span class="card__stat">
    <Icon name="comment" size={13} />
    <span aria-hidden="true">{total}</span>
    <span class="visually-hidden">{total === 1 ? '1 comentario' : `${total} comentarios`}</span>
  </span>
);

export const ReviewCard: FC<ReviewCardProps> = ({ review, env, priority = false }) => {
  const cover = variantUrl(env, review.coverKey, 'card');
  const srcSet = coverSrcSet(env, review.coverKey);
  const href = `/resena/${review.slug}`;

  return (
    <article class="card" data-review-card data-slug={review.slug}>
      <a class="card__link" href={href} data-review-open aria-label={`Abrir reseña de ${review.titleEs}`}>
        <div class="card__cover">
          {cover ? (
            <img
              class="card__img"
              src={cover}
              srcset={srcSet ?? undefined}
              sizes="(max-width: 640px) 45vw, (max-width: 1100px) 30vw, 260px"
              alt={review.coverAlt ?? `Portada de ${review.titleEs}`}
              width="400"
              height="600"
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
              fetchpriority={priority ? 'high' : 'auto'}
            />
          ) : (
            <div class="card__img card__img--placeholder" aria-hidden="true">
              <span>{review.titleEs.slice(0, 1)}</span>
            </div>
          )}
          {review.hasSpoilers ? (
            <span class="card__spoiler-flag" title="Contiene spoilers">
              Spoilers
            </span>
          ) : null}
        </div>

        <div class="card__body">
          <p class="card__type">
            <Icon name={MEDIA_ICON[review.contentType] ?? 'bookmark'} size={13} />
            {CONTENT_TYPE_LABELS[review.contentType]}
          </p>
          <h2 class="card__title">{review.titleEs}</h2>
          <div class="card__meta">
            {review.year ? <span>{review.year}</span> : null}
            {review.categoryName ? <span class="card__category">{review.categoryName}</span> : null}
          </div>
          <StarRating rating={review.ratingHalf} size="sm" />
          {review.summary ? <p class="card__excerpt">{review.summary}</p> : null}
        </div>
      </a>

      <footer class="card__footer">
        <ul class="tags" aria-label="Géneros">
          {review.genres.slice(0, 2).map((genre) => (
            <li>
              <a class="tag" href={`/?genre=${encodeURIComponent(genre.slug)}`}>
                {genre.name}
              </a>
            </li>
          ))}
        </ul>
        <div class="card__stats">
          <CommentCount total={review.commentCount} />
          <time datetime={review.publishedAt ? new Date(review.publishedAt).toISOString() : undefined}>
            {formatDate(review.publishedAt ?? review.updatedAt)}
          </time>
        </div>
      </footer>
    </article>
  );
};

/**
 * Pieza de apertura del catálogo: la reseña más reciente a lo ancho, como el
 * reportaje que abre una revista. Sólo aparece en la primera página y sin
 * filtros; entonces esa reseña se retira de la retícula para no repetirla.
 *
 * La portada es un enlace decorativo (`aria-hidden`, fuera del orden de
 * tabulación): duplicar el mismo destino con dos nombres accesibles obliga a
 * quien navega con teclado o lector de pantalla a oír la misma reseña dos veces.
 */
export const ReviewLead: FC<{ review: ReviewListItem; env: Bindings }> = ({ review, env }) => {
  const cover = variantUrl(env, review.coverKey, 'hero');
  const href = `/resena/${review.slug}`;

  return (
    <article class="lead" data-review-card data-slug={review.slug}>
      <a class="lead__cover" href={href} data-review-open tabindex={-1} aria-hidden="true">
        {cover ? (
          <img
            class="card__img"
            src={cover}
            alt={review.coverAlt ?? `Portada de ${review.titleEs}`}
            width="600"
            height="900"
            fetchpriority="high"
            decoding="async"
          />
        ) : (
          <div class="card__img card__img--placeholder">
            <span>{review.titleEs.slice(0, 1)}</span>
          </div>
        )}
      </a>

      <div class="lead__body">
        <p class="eyebrow eyebrow--icon">
          <Icon name={MEDIA_ICON[review.contentType] ?? 'bookmark'} size={13} />
          Última reseña · {CONTENT_TYPE_LABELS[review.contentType]}
        </p>
        <h2 class="lead__title">
          <a href={href} data-review-open aria-label={`Abrir reseña de ${review.titleEs}`}>
            {review.titleEs}
          </a>
        </h2>
        <StarRating rating={review.ratingHalf} size="md" />
        {review.summary ? <p class="lead__summary">{review.summary}</p> : null}

        <div class="lead__meta">
          {review.year ? <span>{review.year}</span> : null}
          {review.creator ? <span>{review.creator}</span> : null}
          <CommentCount total={review.commentCount} />
          <time datetime={review.publishedAt ? new Date(review.publishedAt).toISOString() : undefined}>
            {formatDate(review.publishedAt ?? review.updatedAt)}
          </time>
        </div>

        {review.genres.length ? (
          <ul class="tags" aria-label="Géneros">
            {review.genres.slice(0, 4).map((genre) => (
              <li>
                <a class="tag" href={`/?genre=${encodeURIComponent(genre.slug)}`}>
                  {genre.name}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
};
