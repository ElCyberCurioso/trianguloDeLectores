import type { FC } from 'hono/jsx';
import type { DashboardData } from '../../services/stats';
import { AdminPage } from './shared';
import { formatDateTime } from '../components/ui';
import { COMMENT_STATUS_LABELS, REPORT_REASON_LABELS } from '../../../types/domain';

export const DashboardPage: FC<{ data: DashboardData }> = ({ data }) => (
  <AdminPage
    title="Dashboard"
    actions={
      <a class="btn btn--primary" href="/admin/resenas/nueva">
        Nueva reseña
      </a>
    }
  >
    <div class="stats">
      <Stat label="Reseñas" value={data.reviewsTotal} href="/admin/resenas" />
      <Stat label="Publicadas" value={data.reviewsPublished} href="/admin/resenas?status=PUBLISHED" tone="ok" />
      <Stat label="Borradores" value={data.reviewsDrafts} href="/admin/resenas?status=DRAFT" />
      <Stat label="Comentarios" value={data.commentsTotal} href="/admin/comentarios?status=ALL" />
      <Stat
        label="Comentarios pendientes"
        value={data.commentsPending}
        href="/admin/comentarios?status=PENDING"
        tone={data.commentsPending > 0 ? 'alert' : 'neutral'}
      />
      <Stat
        label="Comentarios reportados"
        value={data.commentsReported}
        href="/admin/comentarios?status=REPORTED"
        tone={data.commentsReported > 0 ? 'warn' : 'neutral'}
      />
      <Stat label="Reportes abiertos" value={data.reportsOpen} href="/admin/comentarios?status=REPORTED" />
      <Stat label="Usuarios" value={data.usersTotal} href="/admin/ajustes" />
      <Stat
        label="Pendientes por ver"
        value={data.watchlistPending}
        href="/admin/pendientes?status=PENDING"
        tone="accent"
      />
      <Stat
        label="En curso"
        value={data.watchlistInProgress}
        href="/admin/pendientes?status=IN_PROGRESS"
        tone={data.watchlistInProgress > 0 ? 'warn' : 'neutral'}
      />
    </div>

    <p class="pending-counter" aria-live="polite">
      Comentarios pendientes: <strong>{data.commentsPending}</strong>
    </p>

    <div class="admin-cols">
      <section class="panel">
        <h2 class="panel__title">Reseñas recientes</h2>
        {data.recentReviews.length === 0 ? (
          <p class="panel__empty">Todavía no has creado ninguna reseña.</p>
        ) : (
          <table class="table">
            <thead>
              <tr>
                <th scope="col">Título</th>
                <th scope="col">Estado</th>
                <th scope="col">Coment.</th>
                <th scope="col">Actualizada</th>
              </tr>
            </thead>
            <tbody>
              {data.recentReviews.map((review) => (
                <tr>
                  <td>
                    <a href={`/admin/resenas/${review.id}`}>{review.titleEs}</a>
                  </td>
                  <td>
                    <span class={`badge badge--${review.status === 'PUBLISHED' ? 'ok' : 'neutral'}`}>
                      {review.status === 'PUBLISHED' ? 'Publicada' : 'Borrador'}
                    </span>
                  </td>
                  <td>{review.commentCount}</td>
                  <td>{formatDateTime(review.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section class="panel">
        <h2 class="panel__title">Reportes recientes</h2>
        {data.recentReports.length === 0 ? (
          <p class="panel__empty">Sin reportes. Buena señal.</p>
        ) : (
          <ul class="report-feed">
            {data.recentReports.map((report) => (
              <li class="report-feed__item">
                <div class="report-feed__meta">
                  <span class="badge badge--warn">{REPORT_REASON_LABELS[report.reason]}</span>
                  <time datetime={new Date(report.createdAt).toISOString()}>
                    {formatDateTime(report.createdAt)}
                  </time>
                </div>
                <p class="report-feed__body">
                  {report.commentBody ? report.commentBody.slice(0, 160) : 'Comentario eliminado'}
                </p>
                <p class="report-feed__footer">
                  {report.commentStatus ? COMMENT_STATUS_LABELS[report.commentStatus] : '—'} ·{' '}
                  <a href={`/admin/comentarios?status=ALL&q=${encodeURIComponent(report.commentId)}`}>
                    Ver en moderación
                  </a>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>

    <section class="panel">
      <h2 class="panel__title">Actividad reciente</h2>
      <table class="table">
        <thead>
          <tr>
            <th scope="col">Cuándo</th>
            <th scope="col">Acción</th>
            <th scope="col">Entidad</th>
            <th scope="col">Autor</th>
          </tr>
        </thead>
        <tbody>
          {data.recentAudit.map((entry) => (
            <tr>
              <td>{formatDateTime(entry.createdAt)}</td>
              <td>
                <code>{entry.action}</code>
              </td>
              <td>{entry.entityType ?? '—'}</td>
              <td>{entry.actorName ?? 'sistema'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  </AdminPage>
);

const Stat: FC<{ label: string; value: number; href: string; tone?: 'neutral' | 'ok' | 'warn' | 'alert' | 'accent' }> = ({
  label,
  value,
  href,
  tone = 'neutral',
}) => (
  <a class={`stat stat--${tone}`} href={href}>
    <span class="stat__value">{value}</span>
    <span class="stat__label">{label}</span>
  </a>
);
