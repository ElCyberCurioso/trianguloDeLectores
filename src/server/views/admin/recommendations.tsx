import type { FC } from 'hono/jsx';
import type { RecommendationRow, RecommendationCounters } from '../../../db/repos/recommendations';
import {
  CONTENT_TYPE_LABELS, RECOMMENDATION_STATUS_LABELS, RECOMMENDATION_RESOLUTION_LABELS,
  type RecommendationStatus,
} from '../../../types/domain';
import { AdminPage, CsrfField } from './shared';
import { EmptyState, Pagination, formatDateTime } from '../components/ui';
import { Icon, MEDIA_ICON } from '../components/icons';
import { safeUrl } from '../../lib/sanitize';

export interface RecommendationsPageProps {
  items: RecommendationRow[];
  counters: RecommendationCounters;
  status: RecommendationStatus | 'ALL';
  page: number;
  totalPages: number;
  csrfToken: string;
}

const FILTROS: Array<{ value: RecommendationStatus | 'ALL'; label: string }> = [
  { value: 'PENDING', label: 'Por revisar' },
  { value: 'ACCEPTED', label: 'Aceptadas' },
  { value: 'REJECTED', label: 'Descartadas' },
  { value: 'ALL', label: 'Todas' },
];

export const RecommendationsPage: FC<RecommendationsPageProps> = ({
  items, counters, status, page, totalPages, csrfToken,
}) => (
  <AdminPage title="Recomendaciones">
    <div class="stats">
      <div class="stat stat--alert">
        <span class="stat__value">{counters.pending}</span>
        <span class="stat__label">Por revisar</span>
      </div>
      <div class="stat stat--ok">
        <span class="stat__value">{counters.accepted}</span>
        <span class="stat__label">Aceptadas</span>
      </div>
      <div class="stat">
        <span class="stat__value">{counters.rejected}</span>
        <span class="stat__label">Descartadas</span>
      </div>
    </div>

    <nav class="chips" aria-label="Filtrar por estado">
      {FILTROS.map((filtro) => (
        <a
          class={`chip${status === filtro.value ? ' is-active' : ''}`}
          href={`/admin/recomendaciones?status=${filtro.value}`}
          aria-current={status === filtro.value ? 'page' : undefined}
        >
          {filtro.label}
        </a>
      ))}
    </nav>

    {items.length === 0 ? (
      <EmptyState
        title="No hay recomendaciones con ese filtro"
        hint="Cuando alguien envíe una desde la web pública, aparecerá aquí."
        icon="bookmark"
      />
    ) : (
      <ul class="mod-list">
        {items.map((item) => (
          <RecommendationItem item={item} csrfToken={csrfToken} />
        ))}
      </ul>
    )}

    <Pagination
      page={page}
      totalPages={totalPages}
      hrefFor={(p) => `/admin/recomendaciones?status=${status}&page=${p}`}
    />
  </AdminPage>
);

const RecommendationItem: FC<{ item: RecommendationRow; csrfToken: string }> = ({ item, csrfToken }) => {
  const pendiente = item.status === 'PENDING';
  // Defensa en profundidad: el enlace ya se validó al entrar, pero lo que se
  // pinta como href vuelve a filtrarse.
  const enlace = item.sourceUrl ? safeUrl(item.sourceUrl, { allowRelative: false }) : null;

  return (
    <li class={`mod-item mod-item--${pendiente ? 'pending' : item.status === 'ACCEPTED' ? 'approved' : 'reported'}`}>
      <div class="mod-item__head">
        <div class="queue-item__head">
          <span class="queue-item__title">{item.titleEs}</span>
          <span class="badge">
            <Icon name={MEDIA_ICON[item.contentType] ?? 'bookmark'} size={11} />
            {CONTENT_TYPE_LABELS[item.contentType]}
          </span>
          <span class={`badge badge--${pendiente ? 'alert' : item.status === 'ACCEPTED' ? 'ok' : 'neutral'}`}>
            {RECOMMENDATION_STATUS_LABELS[item.status]}
          </span>
          {item.resolution ? (
            <span class="badge badge--accent">{RECOMMENDATION_RESOLUTION_LABELS[item.resolution]}</span>
          ) : null}
        </div>
        <span class="comment__time">{formatDateTime(item.createdAt)}</span>
      </div>

      <p class="mod-item__context">
        {[item.year, item.creator].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
        {item.alias ? ` · recomendada por ${item.alias}` : ' · sin firma'}
      </p>

      <blockquote class="mod-item__body">{item.note}</blockquote>

      {enlace ? (
        <p class="mod-item__context">
          <a href={enlace} rel="noopener noreferrer nofollow" target="_blank">
            Ficha aportada
            <Icon name="external" size={12} />
          </a>
        </p>
      ) : null}

      <div class="mod-item__footer">
        <p class="mod-item__context">
          {item.reviewId ? (
            <a href={`/admin/resenas/${item.reviewId}`}>Ver el borrador de reseña</a>
          ) : item.watchlistId ? (
            <a href={`/admin/pendientes/${item.watchlistId}`}>Ver en la lista de pendientes</a>
          ) : (
            'Sin resolver'
          )}
        </p>

        <div class="mod-item__actions">
          {pendiente ? (
            <>
              <Accion id={item.id} accion="to-review" etiqueta="Convertir en reseña" token={csrfToken} tono="primary" />
              <Accion id={item.id} accion="to-watchlist" etiqueta="A pendientes" token={csrfToken} />
              <Accion id={item.id} accion="reject" etiqueta="Descartar" token={csrfToken} />
            </>
          ) : (
            <Accion id={item.id} accion="reopen" etiqueta="Reabrir" token={csrfToken} />
          )}
          <Accion
            id={item.id}
            accion="delete"
            etiqueta="Eliminar"
            token={csrfToken}
            tono="danger"
            confirmar={`¿Eliminar la recomendación de "${item.titleEs}"?`}
          />
        </div>
      </div>
    </li>
  );
};

const Accion: FC<{
  id: string;
  accion: string;
  etiqueta: string;
  token: string;
  tono?: string;
  confirmar?: string;
}> = ({ id, accion, etiqueta, token, tono = 'ghost', confirmar }) => (
  <form method="post" action={`/admin/recomendaciones/${id}/accion`} class="inline-form" data-confirm={confirmar}>
    <CsrfField token={token} />
    <input type="hidden" name="action" value={accion} />
    <button type="submit" class={`btn btn--sm btn--${tono}`}>
      {etiqueta}
    </button>
  </form>
);
