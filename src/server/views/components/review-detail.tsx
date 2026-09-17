import type { FC } from 'hono/jsx';
import { raw } from 'hono/html';
import type { ReviewDetail } from '../../../db/repos/reviews';
import type { Bindings } from '../../../types/env';
import { AVAILABILITY_LABELS, CONTENT_TYPE_LABELS } from '../../../types/domain';
import { variantUrl } from '../../lib/images';
import { safeUrl } from '../../lib/sanitize';
import { StarRating, formatDate } from './ui';
import { formatYearRange } from '../../lib/year';
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
            <Fact label="Año" value={formatYearRange(review)} />
            <Fact label="Autor / dirección" value={review.creator} />
            <Fact label="País" value={review.country} />
            <Fact label="Duración" value={durationLabel} />
            <Fact label="Temporadas" value={review.seasons} />
            <Fact label="Episodios" value={review.episodes} />
            <Fact label="Volúmenes" value={review.volumes} />
            <Fact label="Categoría" value={review.categoryName} />
            <Fact label="Publicada" value={formatDate(review.publishedAt ?? review.createdAt)} />
          </dl>

          {review.genres.length ? (
            <ul class="tags tags--lg" aria-label="Géneros">
              {review.genres.map((genre) => (
                <li>
                  <a class="tag" href={`/genero/${encodeURIComponent(genre.slug)}`}>
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

      {/*
        El resumen, a un clic y no delante.

        Estaba encima del cuerpo, en tipografía de titular y a 20 px: lo primero
        que se leía de una reseña era su propio spoiler, contado en negrita, y
        el texto de verdad empezaba debajo y más pequeño. Aquí lo que tiene que
        resaltar es la reseña.

        Es un `<details>` nativo: se abre y se cierra sin JavaScript, el
        navegador ya le pone el papel de botón y lo anuncia a los lectores de
        pantalla. Cerrado ocupa una línea; abierto, el resumen se lee a tamaño
        de cuerpo, no de titular, porque es una nota al margen y no la obra.
      */}
      {review.summary ? (
        <details class="verdict">
          {/*
            Las dos etiquetas van en el HTML y la CSS enseña la que toca según
            `[open]`. Cambiarla con JavaScript obligaría a una isla para algo
            que el navegador ya sabe hacer solo, y sin JavaScript el botón se
            quedaría diciendo «ver» con el resumen a la vista.
          */}
          <summary class="verdict__toggle">
            <Icon name="list" size={14} />
            <span class="verdict__label verdict__label--cerrado">Ver el resumen en una frase</span>
            <span class="verdict__label verdict__label--abierto">Ocultar el resumen</span>
          </summary>
          <p class="verdict__text">{review.summary}</p>
        </details>
      ) : null}

      {/* `bodyHtml` se saneó en servidor antes de guardarse en la base de datos. */}
      <div class="prose prose--review" data-spoiler-scope>
        {raw(review.bodyHtml)}
      </div>

      {/*
        Dónde verlo, después de leer.
        
        Estaba entre el resumen y el cuerpo, o sea empujando la reseña hacia
        abajo con una tabla de plataformas que sólo interesa cuando ya has
        decidido que quieres verlo. Ese momento es el final, no el principio.
      */}
      {review.platforms.length ? <PlatformSection review={review} /> : null}
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
