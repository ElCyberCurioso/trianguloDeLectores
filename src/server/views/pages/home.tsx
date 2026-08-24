import type { FC } from 'hono/jsx';
import type { Bindings } from '../../../types/env';
import type { Paginated, ReviewListItem } from '../../../db/repos/reviews';
import type { CategoryWithCount, GenreWithCount } from '../../../db/repos/taxonomy';
import type { ReviewQuery } from '../../../validation/schemas';
import { ReviewCard } from '../components/review-card';
import { Filters } from '../components/filters';
import { EmptyState, Pagination } from '../components/ui';

export interface HomePageProps {
  env: Bindings;
  results: Paginated<ReviewListItem>;
  categories: CategoryWithCount[];
  genres: GenreWithCount[];
  query: ReviewQuery;
  tagline: string;
}

function buildHref(query: ReviewQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  if (query.genre) params.set('genre', query.genre);
  if (query.type) params.set('type', query.type);
  if (query.sort !== 'recent') params.set('sort', query.sort);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}

export const HomePage: FC<HomePageProps> = ({ env, results, categories, genres, query, tagline }) => (
  <>
    <section class="hero">
      <div class="wrap">
        <h1 class="hero__title">{env.SITE_NAME}</h1>
        <p class="hero__tagline">{tagline}</p>
      </div>
    </section>

    <div class="wrap">
      <Filters query={query} categories={categories} genres={genres} total={results.total} />

      {results.items.length === 0 ? (
        <EmptyState
          title="No hay reseñas que coincidan con esos filtros"
          hint="Prueba a quitar algún filtro o a buscar otro título."
          icon="🔍"
        />
      ) : (
        <div class="grid" data-review-grid>
          {results.items.map((review, index) => (
            <ReviewCard review={review} env={env} priority={index < 4} />
          ))}
        </div>
      )}

      <Pagination page={results.page} totalPages={results.totalPages} hrefFor={(p) => buildHref(query, p)} />
    </div>

    {/*
      El modal es un <dialog> nativo: gestiona foco, Escape y el backdrop sin
      JavaScript propio de accesibilidad. El contenido se inyecta desde el
      parcial servidor `/resena/:slug?parcial=1`.
    */}
    <dialog class="modal" id="review-modal" aria-labelledby="review-modal-title" data-review-modal>
      <div class="modal__chrome">
        <button type="button" class="modal__close" data-modal-close aria-label="Cerrar reseña">
          ×
        </button>
        <div class="modal__content" id="review-modal-content" tabindex={-1}>
          <p id="review-modal-title" class="visually-hidden">
            Detalle de la reseña
          </p>
          <div class="modal__loading" data-modal-loading>
            <div class="skeleton skeleton--line" />
            <div class="skeleton skeleton--line" />
            <div class="skeleton skeleton--line skeleton--short" />
          </div>
        </div>
      </div>
    </dialog>
  </>
);
