import type { FC } from 'hono/jsx';
import type { WatchlistRow } from '../../../db/repos/watchlist';
import type { Bindings } from '../../../types/env';
import {
  CONTENT_TYPE_LABELS, PRIORITY_LABELS, WATCHLIST_STATUS_LABELS,
} from '../../../types/domain';
import { variantUrl } from '../../lib/images';
import { safeUrl } from '../../lib/sanitize';
import { formatDate } from './ui';
import { formatYearRange } from '../../lib/year';
import { Icon } from './icons';

export const WatchlistCard: FC<{
  item: WatchlistRow;
  env: Bindings;
  priority?: boolean;
  /**
   * Enlace a la edición. Sólo llega con sesión: quien pasa por aquí sin ella no
   * ve el botón, y la ruta a la que apunta tampoco le dejaría entrar. Son las
   * dos cosas, no una: esconder el botón no es un control de acceso.
   */
  editHref?: string | null;
}> = ({ item, env, priority = false, editHref = null }) => {
  const cover = variantUrl(env, item.coverKey, 'card');
  // Defensa en profundidad: la validación ya restringe el esquema, pero lo que
  // se pinta como href vuelve a pasar por el filtro por si viniera de antes.
  const enlaceSeguro = item.sourceUrl
    ? safeUrl(item.sourceUrl, { allowRelative: false })
    : null;

  return (
    /*
     * Con sesión, la tarjeta entera lleva a la edición.
     *
     * No se envuelve en un `<a>`: dentro hay otros enlaces —la reseña, la
     * ficha— y un enlace dentro de otro no existe en HTML; los navegadores lo
     * deshacen y el resultado depende de cuál. El enlace es **el título**, y se
     * estira con un pseudoelemento que cubre la tarjeta. Así sigue habiendo un
     * solo enlace de verdad, con su texto, su foco y su nombre accesible, y los
     * otros se quedan por encima para poder pulsarlos.
     *
     * El título y no un botón «Editar» porque un botón invisible no se anuncia
     * bien y uno visible sobraba: la tarjeta entera ya se pulsa, y el título es
     * lo que se lee para saber a dónde lleva.
     */
    <article
      class={`pending pending--${item.priority.toLowerCase()}${editHref ? ' pending--editable' : ''}`}
    >
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
        <h3 class="pending__title">
          {editHref ? (
            <a class="pending__titlelink" href={editHref}>
              {item.titleEs}
              {/* Lo que no se ve pero sí se oye: a dónde lleva el enlace. */}
              <span class="visually-hidden"> · Editar este pendiente</span>
            </a>
          ) : (
            item.titleEs
          )}
        </h3>

        <div class="pending__meta">
          {formatYearRange(item) ? <span>{formatYearRange(item)}</span> : null}
          {item.seasons ? (
            <span>
              {item.seasons} {item.seasons === 1 ? 'temporada' : 'temporadas'}
            </span>
          ) : null}
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
  env: Bindings;
  csrfToken: string;
}> = ({ item, env, csrfToken }) => {
  const activo = item.status === 'PENDING' || item.status === 'IN_PROGRESS';
  const cover = variantUrl(env, item.coverKey, 'card');

  return (
    <li class={`queue-item queue-item--${item.priority.toLowerCase()} queue-item--${item.status.toLowerCase()}`}>
      {/*
        La portada también en la cola del panel: es lo que hace que una lista de
        ciento treinta títulos se recorra con la vista y no leyendo. Miniatura,
        2:3 y en color, como en el sitio — la portada es identidad de la obra—, y
        marcador gris donde no la hay para que la fila no baile de altura.

        `aria-hidden` y `alt` vacío: el título está justo al lado y en texto, así
        que anunciar la imagen sería decirlo dos veces.
      */}
      <div class="queue-item__cover" aria-hidden="true">
        {cover ? (
          <img class="queue-item__img" src={cover} alt="" width="44" height="66" loading="lazy" decoding="async" />
        ) : (
          <div class="queue-item__img queue-item__img--placeholder">
            <span>{item.titleEs.slice(0, 1)}</span>
          </div>
        )}
      </div>

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
          {[formatYearRange(item), item.creator, item.categoryName].filter(Boolean).join(' · ') ||
            'Sin datos adicionales'}
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
