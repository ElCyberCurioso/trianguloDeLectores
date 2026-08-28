import type { FC } from 'hono/jsx';
import type { Bindings } from '../../../types/env';
import type { WatchlistRow } from '../../../db/repos/watchlist';
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, type ContentType } from '../../../types/domain';
import { WatchlistCard } from '../components/watchlist-card';
import { EmptyState } from '../components/ui';

export interface WatchlistPageProps {
  env: Bindings;
  items: WatchlistRow[];
  tiposDisponibles: Array<{ type: ContentType; total: number }>;
  tipoActivo?: ContentType;
  total: number;
}

/**
 * Página pública de pendientes: qué hay en cola por ver, leer o jugar.
 * Sólo aparecen los items marcados como públicos y todavía sin terminar.
 */
export const WatchlistPage: FC<WatchlistPageProps> = ({ env, items, tiposDisponibles, tipoActivo, total }) => {
  const enCurso = items.filter((item) => item.status === 'IN_PROGRESS');
  const pendientes = items.filter((item) => item.status !== 'IN_PROGRESS');
  const disponibles = new Map(tiposDisponibles.map((t) => [t.type, t.total]));

  return (
    <div class="wrap watchlist">
      <header class="watchlist__head">
        <h1 class="watchlist__title">Pendientes</h1>
        <p class="watchlist__intro">
          Lo que está en cola por ver, leer o jugar. Cuando algo sale de aquí, normalmente
          entra en el catálogo con su reseña.
        </p>
      </header>

      {tiposDisponibles.length > 1 ? (
        <nav class="chips" aria-label="Filtrar por tipo">
          <a class={`chip${!tipoActivo ? ' is-active' : ''}`} href="/pendientes">
            Todo ({total})
          </a>
          {CONTENT_TYPES.filter((type) => disponibles.has(type)).map((type) => (
            <a
              class={`chip${tipoActivo === type ? ' is-active' : ''}`}
              href={`/pendientes?type=${type}`}
              aria-current={tipoActivo === type ? 'page' : undefined}
            >
              {CONTENT_TYPE_LABELS[type]} ({disponibles.get(type)})
            </a>
          ))}
        </nav>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title="No hay nada en la lista ahora mismo"
          hint="Vuelve dentro de unos días: la cola se mueve."
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
                  <WatchlistCard item={item} env={env} priority={index < 3} />
                ))}
              </div>
            </section>
          ) : null}

          {pendientes.length ? (
            <section class="watchlist__section" aria-labelledby="en-cola">
              <h2 class="watchlist__section-title" id="en-cola">
                En cola
              </h2>
              <div class="pending-grid">
                {pendientes.map((item, index) => (
                  <WatchlistCard item={item} env={env} priority={!enCurso.length && index < 3} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
};
