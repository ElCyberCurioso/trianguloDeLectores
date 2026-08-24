import type { FC } from 'hono/jsx';
import type { Bindings } from '../../../types/env';
import type { ReviewDetail } from '../../../db/repos/reviews';
import { ReviewDetailView } from '../components/review-detail';
import { CommentsSection, type CommentsSectionProps } from '../components/comments';

export interface ReviewPageProps {
  env: Bindings;
  review: ReviewDetail;
  comments: CommentsSectionProps;
  inModal?: boolean;
}

export const ReviewPage: FC<ReviewPageProps> = ({ env, review, comments, inModal = false }) => (
  <div class={inModal ? 'review-wrap review-wrap--modal' : 'wrap review-wrap'}>
    {!inModal ? (
      <nav class="breadcrumb" aria-label="Miga de pan">
        <a href="/">Catálogo</a>
        <span aria-hidden="true">/</span>
        <span>{review.titleEs}</span>
      </nav>
    ) : null}

    <ReviewDetailView review={review} env={env} inModal={inModal} />

    <CommentsSection {...comments} />
  </div>
);
