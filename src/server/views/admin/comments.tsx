import type { FC } from 'hono/jsx';
import { raw } from 'hono/html';
import type { AdminCommentRow } from '../../../db/repos/comments';
import { COMMENT_STATUSES, COMMENT_STATUS_LABELS } from '../../../types/domain';
import { AdminPage, CsrfField } from './shared';
import { Pagination, formatDateTime, EmptyState } from '../components/ui';
import { renderCommentBody } from '../../lib/sanitize';

export interface AdminCommentsProps {
  items: AdminCommentRow[];
  total: number;
  page: number;
  totalPages: number;
  status: string;
  q?: string;
  csrfToken: string;
  pendingCount: number;
  reportThreshold: number;
}

const ACTIONS: Array<{ action: string; label: string; tone: string; confirm?: string }> = [
  { action: 'approve', label: 'Aprobar', tone: 'ok' },
  { action: 'reject', label: 'Rechazar', tone: 'ghost' },
  { action: 'hide', label: 'Ocultar', tone: 'ghost' },
  { action: 'restore', label: 'Restaurar', tone: 'ghost' },
  { action: 'delete', label: 'Eliminar', tone: 'danger', confirm: '¿Eliminar el comentario? Se conservará el hilo.' },
  {
    action: 'purge',
    label: 'Borrar definitivamente',
    tone: 'danger',
    confirm: '¿Borrar este comentario y TODAS sus respuestas de forma irreversible?',
  },
];

export const AdminCommentsPage: FC<AdminCommentsProps> = (props) => (
  <AdminPage title="Moderación de comentarios">
    <p class="pending-counter" aria-live="polite">
      Comentarios pendientes: <strong>{props.pendingCount}</strong>
    </p>
    <p class="field__hint">
      Un comentario pasa automáticamente a <em>Reportado</em> al alcanzar {props.reportThreshold} reportes.
    </p>

    <form class="filters filters--admin" method="get" action="/admin/comentarios">
      <select class="select" name="status" aria-label="Estado">
        {['ALL', ...COMMENT_STATUSES].map((status) => (
          <option value={status} selected={props.status === status}>
            {status === 'ALL' ? 'Todos' : COMMENT_STATUS_LABELS[status as keyof typeof COMMENT_STATUS_LABELS]}
          </option>
        ))}
      </select>
      <input class="input" type="search" name="q" value={props.q ?? ''} placeholder="Buscar texto o alias…" maxlength={120} />
      <button type="submit" class="btn btn--ghost">
        Filtrar
      </button>
    </form>

    {props.items.length === 0 ? (
      <EmptyState title="No hay comentarios con ese filtro" icon="comment" />
    ) : (
      <ul class="mod-list">
        {props.items.map((comment) => (
          <li class={`mod-item mod-item--${comment.status.toLowerCase()}`}>
            <header class="mod-item__head">
              <div>
                <strong class="mod-item__author">{comment.authorAlias}</strong>
                <span class={`badge badge--${badgeTone(comment.status)}`}>
                  {COMMENT_STATUS_LABELS[comment.status]}
                </span>
                {comment.reportCount > 0 ? (
                  <span class="badge badge--warn">{comment.reportCount} reportes</span>
                ) : null}
                {comment.isDeleted ? <span class="badge badge--neutral">eliminado</span> : null}
              </div>
              <time datetime={new Date(comment.createdAt).toISOString()}>{formatDateTime(comment.createdAt)}</time>
            </header>

            <div class="mod-item__body">
              {comment.isDeleted ? (
                <p class="comment__deleted">Este comentario ha sido eliminado.</p>
              ) : (
                raw(renderCommentBody(comment.body))
              )}
            </div>

            <footer class="mod-item__footer">
              <p class="mod-item__context">
                En{' '}
                {comment.reviewSlug ? (
                  <a href={`/resena/${comment.reviewSlug}#c-${comment.id}`} target="_blank" rel="noopener">
                    {comment.reviewTitle}
                  </a>
                ) : (
                  '—'
                )}
                {comment.depth > 0 ? ` · respuesta (nivel ${comment.depth})` : null}
                {comment.replyCount > 0 ? ` · ${comment.replyCount} respuestas` : null}
              </p>
              <div class="mod-item__actions">
                {ACTIONS.map((item) => (
                  <form
                    method="post"
                    action={`/admin/comentarios/${comment.id}/accion`}
                    class="inline-form"
                    data-confirm={item.confirm}
                  >
                    <CsrfField token={props.csrfToken} />
                    <input type="hidden" name="action" value={item.action} />
                    <button type="submit" class={`btn btn--sm btn--${item.tone}`}>
                      {item.label}
                    </button>
                  </form>
                ))}
              </div>
            </footer>
          </li>
        ))}
      </ul>
    )}

    <Pagination
      page={props.page}
      totalPages={props.totalPages}
      hrefFor={(p) => {
        const params = new URLSearchParams();
        params.set('status', props.status);
        if (props.q) params.set('q', props.q);
        if (p > 1) params.set('page', String(p));
        return `/admin/comentarios?${params.toString()}`;
      }}
    />
  </AdminPage>
);

function badgeTone(status: string): string {
  switch (status) {
    case 'APPROVED':
      return 'ok';
    case 'PENDING':
      return 'alert';
    case 'REPORTED':
      return 'warn';
    default:
      return 'neutral';
  }
}
