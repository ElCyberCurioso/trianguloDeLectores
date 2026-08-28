import type { FC } from 'hono/jsx';
import type { WatchlistRow, WatchlistCounters } from '../../../db/repos/watchlist';
import type { Category } from '../../../db/schema';
import type { Bindings } from '../../../types/env';
import {
  CONTENT_TYPES, CONTENT_TYPE_LABELS, PRIORITIES, PRIORITY_LABELS,
  WATCHLIST_STATUSES, WATCHLIST_STATUS_LABELS, WATCHLIST_SORTS, WATCHLIST_SORT_LABELS,
} from '../../../types/domain';
import { variantUrl } from '../../lib/images';
import { AdminPage, CsrfField, Field, Flash } from './shared';
import { WatchlistRowView } from '../components/watchlist-card';
import { EmptyState, Pagination } from '../components/ui';

export interface AdminWatchlistProps {
  items: WatchlistRow[];
  counters: WatchlistCounters;
  categories: Category[];
  csrfToken: string;
  query: { status: string; type?: string; priority?: string; q?: string; sort: string };
  page: number;
  totalPages: number;
  total: number;
  flash?: { kind: 'ok' | 'error'; message: string } | null;
}

function hrefFor(query: AdminWatchlistProps['query'], page: number): string {
  const params = new URLSearchParams();
  if (query.status !== 'ACTIVE') params.set('status', query.status);
  if (query.type) params.set('type', query.type);
  if (query.priority) params.set('priority', query.priority);
  if (query.q) params.set('q', query.q);
  if (query.sort !== 'priority') params.set('sort', query.sort);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/admin/pendientes?${qs}` : '/admin/pendientes';
}

export const AdminWatchlistPage: FC<AdminWatchlistProps> = (props) => (
  <AdminPage title="Pendientes por ver">
    {props.flash ? <Flash kind={props.flash.kind} message={props.flash.message} /> : null}

    <div class="stats">
      <a class="stat stat--accent" href="/admin/pendientes?status=PENDING">
        <span class="stat__value">{props.counters.pending}</span>
        <span class="stat__label">Pendientes</span>
      </a>
      <a class="stat stat--warn" href="/admin/pendientes?status=IN_PROGRESS">
        <span class="stat__value">{props.counters.inProgress}</span>
        <span class="stat__label">En curso</span>
      </a>
      <a class="stat stat--ok" href="/admin/pendientes?status=DONE">
        <span class="stat__value">{props.counters.done}</span>
        <span class="stat__label">Terminados</span>
      </a>
      <a class="stat" href="/admin/pendientes?status=DROPPED">
        <span class="stat__value">{props.counters.dropped}</span>
        <span class="stat__label">Descartados</span>
      </a>
    </div>

    <section class="panel">
      <h2 class="panel__title">Añadir a la lista</h2>

      <form method="post" action="/admin/pendientes" class="quick-add">
        <CsrfField token={props.csrfToken} />
        <input
          class="input"
          type="text"
          name="titleEs"
          placeholder="Título"
          maxlength={200}
          required
          aria-label="Título"
        />
        <select class="select" name="contentType" aria-label="Tipo">
          {CONTENT_TYPES.map((type) => (
            <option value={type}>{CONTENT_TYPE_LABELS[type]}</option>
          ))}
        </select>
        <select class="select" name="priority" aria-label="Prioridad">
          {PRIORITIES.map((priority) => (
            <option value={priority} selected={priority === 'MEDIUM'}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
        <input class="input" type="text" name="note" placeholder="Nota (opcional)" maxlength={500} aria-label="Nota" />
        <label class="check">
          <input type="checkbox" name="isPublic" value="1" checked />
          <span>Público</span>
        </label>
        <button type="submit" class="btn btn--primary">
          Añadir
        </button>
      </form>

      <details class="batch-add">
        <summary class="btn btn--link">Añadir varios de golpe</summary>
        <form method="post" action="/admin/pendientes/lote" class="batch-add__form">
          <CsrfField token={props.csrfToken} />
          <Field label="Un título por línea" name="titles" hint="Máximo 50. Después puedes editar cada uno.">
            <textarea id="f-titles" class="textarea" name="titles" rows={6} required maxlength={6000} />
          </Field>
          <div class="batch-add__row">
            <select class="select" name="contentType" aria-label="Tipo por defecto">
              {CONTENT_TYPES.map((type) => (
                <option value={type}>{CONTENT_TYPE_LABELS[type]}</option>
              ))}
            </select>
            <select class="select" name="priority" aria-label="Prioridad por defecto">
              {PRIORITIES.map((priority) => (
                <option value={priority} selected={priority === 'MEDIUM'}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
            <label class="check">
              <input type="checkbox" name="isPublic" value="1" checked />
              <span>Públicos</span>
            </label>
            <button type="submit" class="btn btn--primary">
              Añadir todos
            </button>
          </div>
        </form>
      </details>
    </section>

    <form class="filters filters--admin" method="get" action="/admin/pendientes">
      <select class="select" name="status" aria-label="Estado">
        <option value="ACTIVE" selected={props.query.status === 'ACTIVE'}>
          Activos (pendientes y en curso)
        </option>
        <option value="ALL" selected={props.query.status === 'ALL'}>
          Todos
        </option>
        {WATCHLIST_STATUSES.map((status) => (
          <option value={status} selected={props.query.status === status}>
            {WATCHLIST_STATUS_LABELS[status]}
          </option>
        ))}
      </select>
      <select class="select" name="type" aria-label="Tipo">
        <option value="">Todos los tipos</option>
        {CONTENT_TYPES.map((type) => (
          <option value={type} selected={props.query.type === type}>
            {CONTENT_TYPE_LABELS[type]}
          </option>
        ))}
      </select>
      <select class="select" name="priority" aria-label="Prioridad">
        <option value="">Cualquier prioridad</option>
        {PRIORITIES.map((priority) => (
          <option value={priority} selected={props.query.priority === priority}>
            {PRIORITY_LABELS[priority]}
          </option>
        ))}
      </select>
      <select class="select" name="sort" aria-label="Orden">
        {WATCHLIST_SORTS.map((sort) => (
          <option value={sort} selected={props.query.sort === sort}>
            {WATCHLIST_SORT_LABELS[sort]}
          </option>
        ))}
      </select>
      <input class="input" type="search" name="q" value={props.query.q ?? ''} placeholder="Buscar…" maxlength={120} />
      <button type="submit" class="btn btn--ghost">
        Filtrar
      </button>
    </form>

    {props.items.length === 0 ? (
      <EmptyState title="No hay nada con esos filtros" hint="Añade algo con el formulario de arriba." icon="list" />
    ) : (
      <ol class="queue">
        {props.items.map((item) => (
          <WatchlistRowView item={item} csrfToken={props.csrfToken} />
        ))}
      </ol>
    )}

    <Pagination page={props.page} totalPages={props.totalPages} hrefFor={(p) => hrefFor(props.query, p)} />
  </AdminPage>
);

// ---------------------------------------------------------------- edición ---

export interface WatchlistEditorProps {
  env: Bindings;
  item: WatchlistRow;
  categories: Category[];
  csrfToken: string;
  errors?: Record<string, string>;
  flash?: { kind: 'ok' | 'error'; message: string } | null;
}

export const WatchlistEditorPage: FC<WatchlistEditorProps> = ({
  env,
  item,
  categories,
  csrfToken,
  errors = {},
  flash,
}) => {
  const cover = variantUrl(env, item.coverKey, 'card');

  return (
    <AdminPage
      title="Editar pendiente"
      actions={
        <a class="btn btn--ghost" href="/admin/pendientes">
          Volver a la lista
        </a>
      }
    >
      {flash ? <Flash kind={flash.kind} message={flash.message} /> : null}

      {item.reviewId ? (
        <p class="notice">
          Este pendiente ya se convirtió en reseña.{' '}
          <a href={`/admin/resenas/${item.reviewId}`}>Editarla</a>.
        </p>
      ) : null}

      <form method="post" action={`/admin/pendientes/${item.id}`} class="editor">
        <CsrfField token={csrfToken} />

        <div class="editor__grid">
          <div class="editor__main">
            <Field label="Título" name="titleEs" required error={errors.titleEs}>
              <input
                id="f-titleEs"
                class="input input--lg"
                type="text"
                name="titleEs"
                value={item.titleEs}
                required
                maxlength={200}
              />
            </Field>

            <div class="editor__row">
              <Field label="Título original" name="titleOriginal">
                <input
                  id="f-titleOriginal"
                  class="input"
                  type="text"
                  name="titleOriginal"
                  value={item.titleOriginal ?? ''}
                  maxlength={200}
                />
              </Field>
              <Field label="Autor / dirección / estudio" name="creator">
                <input id="f-creator" class="input" type="text" name="creator" value={item.creator ?? ''} maxlength={200} />
              </Field>
            </div>

            <Field label="Nota" name="note" hint="Por qué está en la lista, quién lo recomendó, qué esperas.">
              <textarea id="f-note" class="textarea" name="note" rows={4} maxlength={500}>
                {item.note ?? ''}
              </textarea>
            </Field>

            <Field label="Enlace" name="sourceUrl" hint="Ficha, tráiler o donde lo encontraste." error={errors.sourceUrl}>
              <input
                id="f-sourceUrl"
                class="input"
                type="url"
                name="sourceUrl"
                value={item.sourceUrl ?? ''}
                maxlength={500}
                placeholder="https://…"
              />
            </Field>
          </div>

          <aside class="editor__side">
            <section class="panel">
              <h2 class="panel__title">Estado</h2>

              <Field label="Situación" name="status">
                <select id="f-status" class="select" name="status">
                  {WATCHLIST_STATUSES.map((status) => (
                    <option value={status} selected={item.status === status}>
                      {WATCHLIST_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Prioridad" name="priority">
                <select id="f-priority" class="select" name="priority">
                  {PRIORITIES.map((priority) => (
                    <option value={priority} selected={item.priority === priority}>
                      {PRIORITY_LABELS[priority]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Orden manual" name="sortOrder" hint="Menor número, más arriba dentro de su prioridad.">
                <input
                  id="f-sortOrder"
                  class="input input--sm"
                  type="number"
                  name="sortOrder"
                  value={item.sortOrder}
                  min={0}
                  max={9999}
                />
              </Field>

              <label class="check">
                <input type="checkbox" name="isPublic" value="1" checked={item.isPublic === 1} />
                <span>Visible en la página pública</span>
              </label>

              <div class="editor__submit">
                <button type="submit" class="btn btn--primary btn--block">
                  Guardar cambios
                </button>
              </div>
            </section>

            <section class="panel">
              <h2 class="panel__title">Ficha</h2>

              <Field label="Tipo de contenido" name="contentType" required>
                <select id="f-contentType" class="select" name="contentType" required>
                  {CONTENT_TYPES.map((type) => (
                    <option value={type} selected={item.contentType === type}>
                      {CONTENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Categoría" name="categoryId">
                <select id="f-categoryId" class="select" name="categoryId">
                  <option value="">Sin categoría</option>
                  {categories.map((category) => (
                    <option value={category.id} selected={item.categoryId === category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Año" name="year" error={errors.year}>
                <input id="f-year" class="input" type="number" name="year" value={item.year ?? ''} min={1400} max={2200} />
              </Field>
            </section>

            <section class="panel">
              <h2 class="panel__title">Portada</h2>
              <div class="cover-uploader" data-cover-uploader>
                <div class="cover-uploader__preview">
                  {cover ? (
                    <img src={cover} alt="Portada actual" data-cover-preview width="200" height="300" />
                  ) : (
                    <div class="cover-uploader__empty" data-cover-preview-empty>
                      Sin portada
                    </div>
                  )}
                </div>
                <input type="hidden" name="coverKey" value={item.coverKey ?? ''} data-cover-key />
                <label class="btn btn--ghost btn--block">
                  <span>Subir imagen</span>
                  <input
                    type="file"
                    class="visually-hidden"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    data-cover-input
                  />
                </label>
                <button type="button" class="btn btn--link" data-cover-remove>
                  Quitar portada
                </button>
                <Field label="Texto alternativo" name="coverAlt">
                  <input
                    id="f-coverAlt"
                    class="input"
                    type="text"
                    name="coverAlt"
                    value={item.coverAlt ?? ''}
                    maxlength={200}
                  />
                </Field>
              </div>
            </section>
          </aside>
        </div>
      </form>

      {!item.reviewId ? (
        <form method="post" action={`/admin/pendientes/${item.id}/accion`} class="panel">
          <CsrfField token={csrfToken} />
          <input type="hidden" name="action" value="convert" />
          <h2 class="panel__title">Convertir en reseña</h2>
          <p class="field__hint">
            Crea un borrador de reseña con estos datos y la portada, marca este pendiente como
            terminado y enlaza ambos. Publicar la reseña sigue siendo un paso aparte.
          </p>
          <button type="submit" class="btn btn--primary">
            Crear borrador de reseña
          </button>
        </form>
      ) : null}
    </AdminPage>
  );
};
