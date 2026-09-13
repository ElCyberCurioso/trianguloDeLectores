import type { FC } from 'hono/jsx';
import type { Bindings } from '../../../types/env';
import type { WatchlistRow } from '../../../db/repos/watchlist';
import type { Category } from '../../../db/schema';
import type { PublicWatchlistQuery } from '../../../validation/schemas';
import {
  CONTENT_TYPES, CONTENT_TYPE_LABELS, PRIORITIES, PRIORITY_LABELS,
  WATCHLIST_STATUSES, WATCHLIST_STATUS_LABELS, WATCHLIST_SORTS, WATCHLIST_SORT_LABELS,
  type ContentType,
} from '../../../types/domain';
import { WatchlistCard } from '../components/watchlist-card';
import { EmptyState, Flash, Pagination } from '../components/ui';
import { Icon } from '../components/icons';

export interface WatchlistPageProps {
  env: Bindings;
  items: WatchlistRow[];
  tiposDisponibles: Array<{ type: ContentType; total: number }>;
  categories: Category[];
  query: PublicWatchlistQuery;
  total: number;
  page: number;
  totalPages: number;
  /** Hay sesión: se ven los botones de gestión y los filtros de administración. */
  puedeGestionar: boolean;
  flash?: { kind: 'ok' | 'error'; message: string } | null;
}

/** Reconstruye la URL conservando el filtro actual. */
export function watchlistHref(query: PublicWatchlistQuery, page = 1): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.type) params.set('type', query.type);
  if (query.priority) params.set('priority', query.priority);
  if (query.category) params.set('category', query.category);
  if (query.year) params.set('year', query.year);
  if (query.status !== 'ACTIVE') params.set('status', query.status);
  if (query.visibility !== 'PUBLIC') params.set('visibility', query.visibility);
  if (query.sort !== 'priority') params.set('sort', query.sort);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/pendientes?${qs}` : '/pendientes';
}

/** ¿Hay algún filtro puesto, o se está viendo la lista tal cual? */
function hayFiltro(query: PublicWatchlistQuery): boolean {
  return Boolean(
    query.q || query.type || query.priority || query.category || query.year ||
      query.status !== 'ACTIVE' || query.visibility !== 'PUBLIC' || query.sort !== 'priority',
  );
}

/**
 * Página pública de pendientes: qué hay en cola por ver, leer o jugar.
 *
 * Es **también** donde se gestiona la cola. Antes había dos listas —ésta y la
 * del panel— y para cambiar algo que se estaba viendo aquí había que ir a
 * buscarlo allí. Ahora, con sesión iniciada, cada tarjeta lleva su botón de
 * editar y arriba hay uno de añadir; sin sesión la página es exactamente la que
 * era. El panel sigue existiendo para lo que es suyo: las acciones de cola en
 * bloque y la conversión en reseña.
 */
export const WatchlistPage: FC<WatchlistPageProps> = ({
  env,
  items,
  tiposDisponibles,
  categories,
  query,
  total,
  page,
  totalPages,
  puedeGestionar,
  flash,
}) => {
  const disponibles = new Map(tiposDisponibles.map((t) => [t.type, t.total]));
  const filtrado = hayFiltro(query);

  /*
   * Los dos bloques —«ahora mismo» y «en cola»— sólo tienen sentido con el
   * orden por omisión. Ordenando por título, partir la lista en dos deja dos
   * alfabetos seguidos y ya no se puede buscar con la vista.
   */
  const agrupar = query.sort === 'priority' && query.status === 'ACTIVE';
  const enCurso = agrupar ? items.filter((item) => item.status === 'IN_PROGRESS') : [];
  const resto = agrupar ? items.filter((item) => item.status !== 'IN_PROGRESS') : items;

  return (
    <div class="wrap watchlist">
      <header class="watchlist__head">
        <div class="watchlist__headline">
          <h1 class="watchlist__title">Pendientes</h1>
          {puedeGestionar ? (
            <a class="btn btn--primary" href="/pendientes/nuevo">
              <Icon name="plus" size={14} />
              <span>Añadir pendiente</span>
            </a>
          ) : null}
        </div>
        <p class="watchlist__intro">
          Lo que está en cola por ver, leer o jugar. Cuando algo sale de aquí, normalmente
          entra en el catálogo con su reseña.
        </p>
      </header>

      {flash ? <Flash kind={flash.kind} message={flash.message} /> : null}

      {tiposDisponibles.length > 1 ? (
        <nav class="chips" aria-label="Filtrar por tipo">
          <a class={`chip${!query.type ? ' is-active' : ''}`} href={watchlistHref({ ...query, type: undefined })}>
            Todo ({total})
          </a>
          {CONTENT_TYPES.filter((type) => disponibles.has(type)).map((type) => (
            <a
              class={`chip${query.type === type ? ' is-active' : ''}`}
              href={watchlistHref({ ...query, type })}
              aria-current={query.type === type ? 'page' : undefined}
            >
              {CONTENT_TYPE_LABELS[type]} ({disponibles.get(type)})
            </a>
          ))}
        </nav>
      ) : null}

      <details class="watchlist__filters" open={filtrado}>
        <summary class="btn btn--ghost btn--sm">
          <Icon name="filter" size={13} />
          <span>Buscar y filtrar</span>
        </summary>

        <form class="filters filters--watchlist" method="get" action="/pendientes">
          <label class="visually-hidden" for="wl-q">
            Buscar
          </label>
          <input
            id="wl-q"
            class="input"
            type="search"
            name="q"
            value={query.q ?? ''}
            placeholder="Título, autor o nota…"
            maxlength={120}
          />

          <label class="visually-hidden" for="wl-type">
            Tipo
          </label>
          <select id="wl-type" class="select" name="type">
            <option value="">Todos los tipos</option>
            {CONTENT_TYPES.map((type) => (
              <option value={type} selected={query.type === type}>
                {CONTENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>

          <label class="visually-hidden" for="wl-category">
            Categoría
          </label>
          <select id="wl-category" class="select" name="category">
            <option value="">Cualquier categoría</option>
            {categories.map((category) => (
              <option value={category.slug} selected={query.category === category.slug}>
                {category.name}
              </option>
            ))}
          </select>

          <label class="visually-hidden" for="wl-priority">
            Prioridad
          </label>
          <select id="wl-priority" class="select" name="priority">
            <option value="">Cualquier prioridad</option>
            {PRIORITIES.map((priority) => (
              <option value={priority} selected={query.priority === priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </select>

          {/*
            Año en texto libre y no un número: lo que se guarda es un periodo, y
            buscar «2021» tiene que encontrar también lo que se emitía en 2021
            aunque empezara en 2020.
          */}
          <label class="visually-hidden" for="wl-year">
            Año o periodo
          </label>
          <input
            id="wl-year"
            class="input input--sm"
            type="text"
            name="year"
            value={query.year ?? ''}
            placeholder="Año o periodo"
            maxlength={40}
          />

          {puedeGestionar ? (
            <>
              <label class="visually-hidden" for="wl-status">
                Estado
              </label>
              <select id="wl-status" class="select" name="status">
                <option value="ACTIVE" selected={query.status === 'ACTIVE'}>
                  Activos (pendientes y en curso)
                </option>
                <option value="ALL" selected={query.status === 'ALL'}>
                  Todos los estados
                </option>
                {WATCHLIST_STATUSES.map((status) => (
                  <option value={status} selected={query.status === status}>
                    {WATCHLIST_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>

              <label class="visually-hidden" for="wl-visibility">
                Visibilidad
              </label>
              <select id="wl-visibility" class="select" name="visibility">
                <option value="PUBLIC" selected={query.visibility === 'PUBLIC'}>
                  Sólo los públicos
                </option>
                <option value="ALL" selected={query.visibility === 'ALL'}>
                  Públicos y privados
                </option>
                <option value="PRIVATE" selected={query.visibility === 'PRIVATE'}>
                  Sólo los privados
                </option>
              </select>
            </>
          ) : null}

          <label class="visually-hidden" for="wl-sort">
            Orden
          </label>
          <select id="wl-sort" class="select" name="sort">
            {WATCHLIST_SORTS.map((sort) => (
              <option value={sort} selected={query.sort === sort}>
                {WATCHLIST_SORT_LABELS[sort]}
              </option>
            ))}
          </select>

          <button type="submit" class="btn btn--ghost">
            Filtrar
          </button>
          {filtrado ? (
            <a class="btn btn--link" href="/pendientes">
              Quitar filtros
            </a>
          ) : null}
        </form>
      </details>

      {items.length === 0 ? (
        <EmptyState
          title={filtrado ? 'Nada coincide con esa búsqueda' : 'No hay nada en la lista ahora mismo'}
          hint={filtrado ? 'Prueba con menos filtros.' : 'Vuelve dentro de unos días: la cola se mueve.'}
          icon="list"
        />
      ) : (
        <>
          {enCurso.length ? (
            <section class="watchlist__section" aria-labelledby="en-curso">
              <h2 class="watchlist__section-title" id="en-curso">
                Ahora mismo
              </h2>
              <div class="pending-grid">
                {enCurso.map((item, index) => (
                  <WatchlistCard
                    item={item}
                    env={env}
                    priority={index < 3}
                    editHref={puedeGestionar ? `/pendientes/${item.id}/editar` : null}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {resto.length ? (
            <section class="watchlist__section" aria-labelledby="en-cola">
              <h2 class="watchlist__section-title" id="en-cola">
                {agrupar ? 'En cola' : `${total} resultados`}
              </h2>
              <div class="pending-grid">
                {resto.map((item, index) => (
                  <WatchlistCard
                    item={item}
                    env={env}
                    priority={!enCurso.length && index < 3}
                    editHref={puedeGestionar ? `/pendientes/${item.id}/editar` : null}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      <Pagination page={page} totalPages={totalPages} hrefFor={(p) => watchlistHref(query, p)} />
    </div>
  );
};
