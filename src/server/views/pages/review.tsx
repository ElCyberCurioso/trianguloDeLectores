import type { FC } from 'hono/jsx';
import type { Bindings } from '../../../types/env';
import type { ReviewDetail, ReviewListItem } from '../../../db/repos/reviews';
import type { EpisodeRow } from '../../../db/repos/episodes';
import { ReviewDetailView } from '../components/review-detail';
import { EpisodesSection } from '../components/episodes';
import { CommentsSection, type CommentsSectionProps } from '../components/comments';
import { ReviewCard } from '../components/review-card';

export interface ReviewPageProps {
  env: Bindings;
  review: ReviewDetail;
  comments: CommentsSectionProps;
  /** Notas por temporada y capítulo. Vacío en todo lo que no sea una serie. */
  episodes?: EpisodeRow[];
  /** Tres reseñas parecidas, por géneros compartidos. Vacío si no hay. */
  relacionadas?: ReviewListItem[];
  inModal?: boolean;
}

export const ReviewPage: FC<ReviewPageProps> = ({
  env,
  review,
  comments,
  episodes = [],
  relacionadas = [],
  inModal = false,
}) => (
  <div class={inModal ? 'review-wrap review-wrap--modal' : 'wrap review-wrap'}>
    {!inModal ? (
      <nav class="breadcrumb" aria-label="Miga de pan">
        <a href="/">Catálogo</a>
        <span aria-hidden="true">/</span>
        <span>{review.titleEs}</span>
      </nav>
    ) : null}

    <ReviewDetailView review={review} env={env} inModal={inModal} />

    {/* Después del cuerpo: primero la opinión, luego el detalle. */}
    <EpisodesSection episodes={episodes} />

    {/*
      Antes de los comentarios, no después: quien acaba de leer decide ahí si
      sigue en el sitio o se va, y enterrar las relacionadas bajo un hilo de
      treinta comentarios es lo mismo que no ponerlas.

      Dentro del modal no van: el modal enseña una reseña sobre el catálogo, y
      el catálogo entero está justo detrás.
    */}
    {!inModal && relacionadas.length ? (
      <section class="related" aria-labelledby="related-title">
        <div class="section-rule">
          <p class="section-rule__title" id="related-title">
            Si te ha gustado
          </p>
        </div>
        <div class="grid grid--related">
          {relacionadas.map((otra) => (
            <ReviewCard review={otra} env={env} />
          ))}
        </div>
      </section>
    ) : null}

    <CommentsSection {...comments} />
  </div>
);
