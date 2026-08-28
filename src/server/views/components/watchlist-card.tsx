import type { FC } from 'hono/jsx';
import type { WatchlistRow } from '../../../db/repos/watchlist';
import type { Bindings } from '../../../types/env';
import {
  CONTENT_TYPE_LABELS, PRIORITY_LABELS, WATCHLIST_STATUS_LABELS,
} from '../../../types/domain';
import { variantUrl } from '../../lib/images';
import { safeUrl } from '../../lib/sanitize';
import { formatDate } from './ui';
import { Icon } from './icons';

export const WatchlistCard: FC<{ item: WatchlistRow; env: Bindings; priority?: boolean }> = ({
  item,
  env,
  priority = false,
}) => {
  const cover = variantUrl(env, item.coverKey, 'card');
  // Defensa en profundidad: la validación ya restringe el esquema, pero lo que
  // se pinta como href vuelve a pasar por el filtro por si viniera de antes.
  const enlaceSeguro = item.sourceUrl
    ? safeUrl(item.sourceUrl, { allowRelative: false })
    : null;

  return (
    <article class={`pending pending--${item.priority.toLowerCase()}`}>
      <div class="pending__cover">
        {cover ? (
          <img
            class="pending__img"
            src={cover}
            alt={item.coverAlt ?? `Portada de ${item.titleEs}`}
            width="200"
            height="300"
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
          />
        ) : (
          <div class="pending__img pending__img--placeholder" aria-hidden="true">
            <span>{item.titleEs.slice(0, 1)}</span>
          </div>
        )}
        {item.status === 'IN_PROGRESS' ? <span class="pending__flag">En curso</span> : null}
      </div>

      <div class="pending__body">
        <p class="pending__type">{CONTENT_TYPE_LABELS[item.contentType]}</p>
        <h3 class="pending__title">{item.titleEs}</h3>

        <div class="pending__meta">
          {item.year ? <span>{item.year}</span> : null}
          {item.creator ? <span>{item.creator}</span> : null}
        </div>

        {item.note ? <p class="pending__note">{item.note}</p> : null}

        <div class="pending__footer">
          <span class={`badge badge--${item.priority === 'HIGH' ? 'accent' : 'neutral'}`}>
            <span class="visually-hidden">Prioridad </span>
            {PRIORITY_LABELS[item.priority]}
          </span>
          {item.reviewSlug ? (
            <a class="pending__link" href={`/resena/${item.reviewSlug}`}>
              Ver la reseña
              <Icon name="arrow-right" size={13} />
            </a>
          ) : enlaceSeguro ? (
            <a class="pending__link" href={enlaceSeguro} rel="noopener noreferrer nofollow" target="_blank">
              Ficha
              <Icon name="external" size={13} />
              <span class="visually-hidden">Se abre en una pestaña nueva</span>
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
};

/** Fila compacta para la cola del panel, con sus acciones. */
export const WatchlistRowView: FC<{
  item: WatchlistRow;
  csrfToken: string;
}> = ({ item, csrfToken }) => {
  const activo = item.status === 'PENDING' || item.status === 'IN_PROGRESS';

  return (
    <li class={`queue-item queue-item--${item.priority.toLowerCase()} queue-item--${item.status.toLowerCase()}`}>
      <div class="queue-item__main">
        <div class="queue-item__head">
          <a class="queue-item__title" href={`/admin/pendientes/${item.id}`}>
            {item.titleEs}
          </a>
          <span class="badge">{CONTENT_TYPE_LABELS[item.contentType]}</span>
          <span class={`badge badge--${statusTone(item.status)}`}>{WATCHLIST_STATUS_LABELS[item.status]}</span>
          <span class={`badge badge--${item.priority === 'HIGH' ? 'alert' : item.priority === 'LOW' ? 'neutral' : 'warn'}`}>
            {PRIORITY_LABELS[item.priority]}
          </span>
          {item.isPublic === 0 ? <span class="badge badge--neutral">Privado</span> : null}
        </div>

        <p class="queue-item__meta">
          {[item.year, item.creator, item.categoryName].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
          {' · añadido el '}
          {formatDate(item.createdAt)}
        </p>

        {item.note ? <p class="queue-item__note">{item.note}</p> : null}

        {item.reviewSlug ? (
          <p class="queue-item__note">
            Reseña asociada: <a href={`/admin/resenas/${item.reviewId}`}>editar</a> ·{' '}
            <a href={`/resena/${item.reviewSlug}`} target="_blank" rel="noopener">
              ver
            </a>
          </p>
        ) : null}
      </div>

      <div class="queue-item__actions">
        {item.status === 'PENDING' ? <Accion id={item.id} accion="start" etiqueta="Empezar" token={csrfToken} /> : null}
        {activo ? <Accion id={item.id} accion="complete" etiqueta="Terminado" token={csrfToken} /> : null}
        {activo ? <Accion id={item.id} accion="drop" etiqueta="Descartar" token={csrfToken} /> : null}
        {!activo ? <Accion id={item.id} accion="reopen" etiqueta="Reabrir" token={csrfToken} /> : null}
        {!item.reviewId ? (
          <Accion id={item.id} accion="convert" etiqueta="Convertir en reseña" token={csrfToken} tono="primary" />
        ) : null}
        <Accion
          id={item.id}
          accion="toggle-public"
          etiqueta={item.isPublic === 1 ? 'Hacer privado' : 'Hacer público'}
          token={csrfToken}
        />
        <Accion
          id={item.id}
          accion="delete"
          etiqueta="Eliminar"
          token={csrfToken}
          tono="danger"
          confirmar={`¿Eliminar "${item.titleEs}" de la lista?`}
        />
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
  <form method="post" action={`/admin/pendientes/${id}/accion`} class="inline-form" data-confirm={confirmar}>
    <input type="hidden" name="_csrf" value={token} />
    <input type="hidden" name="action" value={accion} />
    <button type="submit" class={`btn btn--sm btn--${tono}`}>
      {etiqueta}
    </button>
  </form>
);

function statusTone(status: WatchlistRow['status']): string {
  switch (status) {
    case 'IN_PROGRESS':
      return 'warn';
    case 'DONE':
      return 'ok';
    case 'DROPPED':
      return 'neutral';
    default:
      return 'accent';
  }
}
