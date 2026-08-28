import type { FC } from 'hono/jsx';
import { raw } from 'hono/html';
import type { CommentNode } from '../../../db/repos/comments';
import { renderCommentBody } from '../../lib/sanitize';
import { REPORT_REASONS, REPORT_REASON_LABELS } from '../../../types/domain';
import { formatDateTime } from './ui';

export interface CommentsSectionProps {
  reviewId: string;
  reviewSlug: string;
  nodes: CommentNode[];
  totalRoots: number;
  policy: 'OPEN' | 'AUTH' | 'CLOSED';
  requiresApproval: boolean;
  maxDepth: number;
  isLoggedIn: boolean;
  formToken: string;
  turnstileSiteKey: string | null;
  aliasMaxLength: number;
  bodyMaxLength: number;
}

export const CommentsSection: FC<CommentsSectionProps> = (props) => {
  const { nodes, totalRoots, policy } = props;
  return (
    <section class="comments" id="comentarios" aria-labelledby="comentarios-title" data-comments data-review-id={props.reviewId}>
      <h3 class="comments__title" id="comentarios-title">
        Comentarios <span class="comments__count">({totalRoots})</span>
      </h3>

      {policy === 'CLOSED' ? (
        <p class="notice">Los comentarios están cerrados en esta reseña.</p>
      ) : policy === 'AUTH' && !props.isLoggedIn ? (
        <p class="notice">
          Necesitas <a href="/admin/login">iniciar sesión</a> para comentar.
        </p>
      ) : (
        <CommentForm {...props} parentId={null} />
      )}

      {nodes.length === 0 ? (
        <p class="comments__empty">Todavía no hay comentarios. Sé la primera persona en escribir uno.</p>
      ) : (
        <ol class="comment-list">
          {nodes.map((node) => (
            <CommentItem node={node} props={props} />
          ))}
        </ol>
      )}
    </section>
  );
};

const CommentItem: FC<{ node: CommentNode; props: CommentsSectionProps }> = ({ node, props }) => {
  const canReply =
    props.policy === 'OPEN' || (props.policy === 'AUTH' && props.isLoggedIn);
  const replyAllowed = canReply && node.depth + 1 < props.maxDepth && !node.isDeleted;

  return (
    <li class="comment" id={`c-${node.id}`} data-comment-id={node.id} data-depth={node.depth}>
      <article class={`comment__box${node.isDeleted ? ' comment__box--deleted' : ''}`}>
        <header class="comment__header">
          <span class="comment__author">{node.isDeleted ? '—' : node.authorAlias}</span>
          <time class="comment__time" datetime={new Date(node.createdAt).toISOString()}>
            {formatDateTime(node.createdAt)}
          </time>
        </header>

        {node.isDeleted ? (
          <p class="comment__deleted">Este comentario ha sido eliminado.</p>
        ) : (
          <div class="comment__body">{raw(renderCommentBody(node.body))}</div>
        )}

        {!node.isDeleted ? (
          <footer class="comment__actions">
            {replyAllowed ? (
              <button type="button" class="btn btn--link" data-reply-toggle={node.id} aria-expanded="false">
                Responder
              </button>
            ) : null}

            <details class="report">
              <summary class="btn btn--link">Reportar comentario</summary>
              <form
                class="report__form"
                method="post"
                action={`/api/comentarios/${node.id}/reportar`}
                data-report-form
              >
                <input type="hidden" name="_form" value={props.formToken} />
                <input type="hidden" name="commentId" value={node.id} />
                <fieldset class="report__reasons">
                  <legend class="field__label">Motivo</legend>
                  {REPORT_REASONS.map((reason, index) => (
                    <label class="radio">
                      <input type="radio" name="reason" value={reason} required={index === 0} />
                      <span>{REPORT_REASON_LABELS[reason]}</span>
                    </label>
                  ))}
                </fieldset>
                <label class="field">
                  <span class="field__label">Detalles (opcional)</span>
                  <textarea class="textarea" name="details" rows={2} maxlength={500} />
                </label>
                {props.turnstileSiteKey ? (
                  <div class="turnstile-slot">
                    <div class="cf-turnstile" data-sitekey={props.turnstileSiteKey} data-theme="auto" data-size="normal" />
                  </div>
                ) : null}
                <button type="submit" class="btn btn--sm btn--danger">
                  Enviar reporte
                </button>
              </form>
            </details>
          </footer>
        ) : null}

        {replyAllowed ? (
          <div class="comment__reply-slot" data-reply-slot={node.id} hidden>
            <CommentForm {...props} parentId={node.id} compact />
          </div>
        ) : null}
      </article>

      {node.children.length ? (
        <ol class="comment-list comment-list--nested">
          {node.children.map((child) => (
            <CommentItem node={child} props={props} />
          ))}
        </ol>
      ) : null}
    </li>
  );
};

const CommentForm: FC<CommentsSectionProps & { parentId: string | null; compact?: boolean }> = (props) => (
  <form
    class={`comment-form${props.compact ? ' comment-form--compact' : ''}`}
    method="post"
    action={`/api/resenas/${props.reviewSlug}/comentarios`}
    data-comment-form
  >
    <input type="hidden" name="_form" value={props.formToken} />
    <input type="hidden" name="reviewId" value={props.reviewId} />
    {props.parentId ? <input type="hidden" name="parentId" value={props.parentId} /> : null}

    {/* Honeypot: invisible para personas, irresistible para bots. */}
    <div class="hp" aria-hidden="true">
      <label>
        No rellenes este campo
        <input type="text" name="website" tabindex={-1} autocomplete="off" />
      </label>
    </div>

    {!props.isLoggedIn ? (
      <label class="field">
        <span class="field__label">Tu nombre o alias</span>
        <input
          class="input"
          type="text"
          name="alias"
          required
          minlength={2}
          maxlength={props.aliasMaxLength}
          autocomplete="nickname"
        />
      </label>
    ) : null}

    <label class="field">
      <span class="field__label">
        {props.parentId ? 'Tu respuesta' : 'Tu comentario'}
      </span>
      <textarea
        class="textarea"
        name="body"
        rows={props.compact ? 3 : 4}
        required
        minlength={2}
        maxlength={props.bodyMaxLength}
        placeholder="Usa ||dobles barras|| para ocultar spoilers"
      />
    </label>

    {props.turnstileSiteKey ? (
      <div class="turnstile-slot">
                    <div class="cf-turnstile" data-sitekey={props.turnstileSiteKey} data-theme="auto" data-size="normal" />
                  </div>
    ) : null}

    <div class="comment-form__actions">
      <button type="submit" class="btn btn--primary">
        {props.parentId ? 'Responder' : 'Publicar comentario'}
      </button>
      {props.requiresApproval ? (
        <p class="comment-form__hint">Los comentarios se revisan antes de publicarse.</p>
      ) : null}
    </div>
  </form>
);
