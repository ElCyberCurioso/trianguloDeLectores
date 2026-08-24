import type { FC } from 'hono/jsx';
import type { ReviewListItem } from '../../../db/repos/reviews';
import type { Bindings } from '../../../types/env';
import { CONTENT_TYPE_LABELS } from '../../../types/domain';
import { variantUrl, coverSrcSet } from '../../lib/images';
import { StarRating, formatDate } from './ui';

export interface ReviewCardProps {
  review: ReviewListItem;
  env: Bindings;
  /** primera fila del grid: se precarga la portada en vez de diferirla */
  priority?: boolean;
}

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
          <span class="card__type">{CONTENT_TYPE_LABELS[review.contentType]}</span>
          {review.hasSpoilers ? (
            <span class="card__spoiler-flag" title="Contiene spoilers">
              Spoilers
            </span>
          ) : null}
        </div>

        <div class="card__body">
          <h2 class="card__title">{review.titleEs}</h2>
          <div class="card__meta">
            {review.year ? <span>{review.year}</span> : null}
            {review.categoryName ? <span class="card__category">{review.categoryName}</span> : null}
          </div>
          <StarRating rating={review.rating} size="sm" />
          {review.summary ? <p class="card__excerpt">{review.summary}</p> : null}
        </div>
      </a>

      <footer class="card__footer">
        <ul class="tags" aria-label="Géneros">
          {review.genres.slice(0, 3).map((genre) => (
            <li>
              <a class="tag" href={`/?genre=${encodeURIComponent(genre.slug)}`}>
                {genre.name}
              </a>
            </li>
          ))}
        </ul>
        <div class="card__stats">
          <span class="card__comments" title="Comentarios">
            {review.commentCount} 💬
          </span>
          <time datetime={review.publishedAt ? new Date(review.publishedAt).toISOString() : undefined}>
            {formatDate(review.publishedAt ?? review.updatedAt)}
          </time>
        </div>
      </footer>
    </article>
  );
};
