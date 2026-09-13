import type { FC } from 'hono/jsx';
import type { Bindings } from '../../../types/env';
import type { Category } from '../../../db/schema';
import { WatchlistForm, type WatchlistDraft } from '../components/watchlist-form';
import { Flash } from '../components/ui';
import { Icon } from '../components/icons';

export interface WatchlistEditorPageProps {
  env: Bindings;
  /** Nulo en el alta. El formulario es el mismo; cambia a dónde se envía. */
  id: string | null;
  item: WatchlistDraft;
  categories: Category[];
  csrfToken: string;
  /** Si ya se convirtió en reseña, se dice y se enlaza en vez de esconderlo. */
  reviewId?: string | null;
  errors?: Record<string, string>;
  flash?: { kind: 'ok' | 'error'; message: string } | null;
}

/**
 * Alta y edición de un pendiente, en el sitio público.
 *
 * La gestión estaba repartida entre esta página y el panel: se veía la cola
 * aquí y había que ir allí a tocarla. Ahora se hace donde se está mirando. La
 * ruta exige sesión igual que el panel —esconder un botón no es un control de
 * acceso—, así que esta página sólo existe para quien ha entrado.
 */
export const WatchlistEditorPublicPage: FC<WatchlistEditorPageProps> = ({
  env,
  id,
  item,
  categories,
  csrfToken,
  reviewId = null,
  errors = {},
  flash,
}) => (
  <div class="wrap watchlist-editor">
    <header class="watchlist__head">
      <div class="watchlist__headline">
        <h1 class="watchlist__title">{id ? 'Editar pendiente' : 'Añadir pendiente'}</h1>
        <a class="btn btn--ghost" href="/pendientes">
          <Icon name="arrow-right" size={13} />
          <span>Volver a la lista</span>
        </a>
      </div>
    </header>

    {flash ? <Flash kind={flash.kind} message={flash.message} /> : null}

    {reviewId ? (
      <p class="notice">
        Este pendiente ya se convirtió en reseña. <a href={`/admin/resenas/${reviewId}`}>Editar la reseña</a>.
      </p>
    ) : null}

    <WatchlistForm
      env={env}
      item={item}
      categories={categories}
      csrfToken={csrfToken}
      action={id ? `/pendientes/${id}/editar` : '/pendientes/nuevo'}
      submitLabel={id ? 'Guardar cambios' : 'Añadir a la lista'}
      cancelHref="/pendientes"
      errors={errors}
    />

    {id ? (
      <p class="field__hint">
        Las acciones de cola —empezar, terminar, descartar, convertir en reseña— siguen en{' '}
        <a href={`/admin/pendientes/${id}`}>el panel</a>.
      </p>
    ) : null}
  </div>
);
