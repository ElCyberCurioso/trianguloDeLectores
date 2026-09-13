import type { FC } from 'hono/jsx';
import type { Bindings } from '../../../types/env';
import type { ReviewDetail } from '../../../db/repos/reviews';
import type { EpisodeRow } from '../../../db/repos/episodes';
import { ReviewDetailView } from '../components/review-detail';
import { EpisodesSection } from '../components/episodes';
import { CommentsSection, type CommentsSectionProps } from '../components/comments';

export interface ReviewPageProps {
  env: Bindings;
  review: ReviewDetail;
  comments: CommentsSectionProps;
  /** Notas por temporada y capítulo. Vacío en todo lo que no sea una serie. */
  episodes?: EpisodeRow[];
  inModal?: boolean;
}

export const ReviewPage: FC<ReviewPageProps> = ({ env, review, comments, episodes = [], inModal = false }) => (
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

    <CommentsSection {...comments} />
  </div>
);
