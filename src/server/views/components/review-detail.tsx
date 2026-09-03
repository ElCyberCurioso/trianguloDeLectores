import type { FC } from 'hono/jsx';
import { raw } from 'hono/html';
import type { ReviewDetail } from '../../../db/repos/reviews';
import type { Bindings } from '../../../types/env';
import { AVAILABILITY_LABELS, CONTENT_TYPE_LABELS } from '../../../types/domain';
import { variantUrl } from '../../lib/images';
import { safeUrl } from '../../lib/sanitize';
import { StarRating, formatDate } from './ui';
import { Icon, MEDIA_ICON } from './icons';

interface FactProps { label: string; value: string | number | null | undefined }

/** Sólo se pinta la fila si hay dato: nada de "—" ni campos vacíos. */
const Fact: FC<FactProps> = ({ label, value }) =>
  value === null || value === undefined || value === '' ? null : (
    <div class="fact">
      <dt class="fact__label">{label}</dt>
      <dd class="fact__value">{value}</dd>
    </div>
  );

export interface ReviewDetailProps {
  review: ReviewDetail;
  env: Bindings;
  /** true cuando se renderiza dentro del modal (no repite el <h1> de página) */
  inModal?: boolean;
}

export const ReviewDetailView: FC<ReviewDetailProps> = ({ review, env, inModal = false }) => {
  const cover = variantUrl(env, review.coverKey, 'hero');
  const Title = inModal ? 'h2' : 'h1';
  const durationLabel = review.durationMin
    ? review.durationMin >= 60
      ? `${Math.floor(review.durationMin / 60)} h ${review.durationMin % 60} min`
      : `${review.durationMin} min`
    : null;

  return (
    <article class="review" data-review-id={review.id}>
      <header class="review__header">
        <div class="review__cover">
          {cover ? (
            <img
              src={cover}
              alt={review.coverAlt ?? `Portada de ${review.titleEs}`}
              width={review.coverWidth ?? 600}
              height={review.coverHeight ?? 900}
              class="review__img"
              decoding="async"
            />
          ) : (
            <div class="review__img review__img--placeholder" aria-hidden="true">
              <span>{review.titleEs.slice(0, 1)}</span>
            </div>
          )}
        </div>

        <div class="review__head">
          <p class="review__kicker">
            <Icon name={MEDIA_ICON[review.contentType] ?? 'bookmark'} size={14} />
            {CONTENT_TYPE_LABELS[review.contentType]}
          </p>
          <Title class="review__title">{review.titleEs}</Title>
          {review.titleOriginal && review.titleOriginal !== review.titleEs ? (
            <p class="review__original">{review.titleOriginal}</p>
          ) : null}
          {review.otherTitles.length ? (
            <p class="review__aka">
              También conocido como: {review.otherTitles.join(' · ')}
            </p>
          ) : null}

          <div class="review__rating">
            <StarRating rating={review.ratingHalf} size="lg" />
          </div>

          <dl class="facts">
            <Fact label="Año" value={review.year} />
            <Fact label="Autor / dirección" value={review.creator} />
            <Fact label="País" value={review.country} />
            <Fact label="Duración" value={durationLabel} />
            <Fact label="Episodios" value={review.episodes} />
            <Fact label="Volúmenes" value={review.volumes} />
            <Fact label="Categoría" value={review.categoryName} />
            <Fact label="Publicada" value={formatDate(review.publishedAt ?? review.createdAt)} />
          </dl>

          {review.genres.length ? (
            <ul class="tags tags--lg" aria-label="Géneros">
              {review.genres.map((genre) => (
                <li>
                  <a class="tag" href={`/?genre=${encodeURIComponent(genre.slug)}`}>
                    {genre.name}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </header>

      {review.hasSpoilers ? (
        <p class="spoiler-warning" role="note">
          <Icon name="warning" size={18} />
          <span>
            <strong>Aviso:</strong> esta reseña contiene spoilers.
          </span>
        </p>
      ) : null}

      {review.summary ? <p class="review__summary">{review.summary}</p> : null}

      {review.platforms.length ? <PlatformSection review={review} /> : null}

      {/* `bodyHtml` se saneó en servidor antes de guardarse en la base de datos. */}
      <div class="prose" data-spoiler-scope>
        {raw(review.bodyHtml)}
      </div>
    </article>
  );
};

const PlatformSection: FC<{ review: ReviewDetail }> = ({ review }) => (
  <section class="platforms" aria-labelledby="platforms-title">
    <h3 class="platforms__title" id="platforms-title">
      Dónde verlo / dónde encontrarlo
    </h3>
    <ul class="platforms__list">
      {review.platforms.map((platform) => {
        const label = AVAILABILITY_LABELS[platform.availability];
        // El href vuelve a filtrarse aquí, no sólo al guardarlo.
        const enlace = platform.url ? safeUrl(platform.url, { allowRelative: false }) : null;
        const content = (
          <>
            <span class="platform__name">{platform.name}</span>
            <span class="platform__availability">{label}</span>
            {platform.note ? <span class="platform__note">{platform.note}</span> : null}
          </>
        );
        return (
          <li class={`platform platform--${platform.kind.toLowerCase()}`}>
            {enlace ? (
              <a class="platform__link" href={enlace} rel="noopener noreferrer nofollow" target="_blank">
                {content}
                <span class="platform__ext">
                  <Icon name="external" size={15} />
                  <span class="visually-hidden">Se abre en una pestaña nueva</span>
                </span>
              </a>
            ) : (
              <span class="platform__link platform__link--static">{content}</span>
            )}
          </li>
        );
      })}
    </ul>
  </section>
);
