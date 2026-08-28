import type { FC } from 'hono/jsx';
import type { Bindings } from '../../../types/env';
import type { Paginated, ReviewListItem } from '../../../db/repos/reviews';
import type { CategoryWithCount, GenreWithCount } from '../../../db/repos/taxonomy';
import type { ReviewQuery } from '../../../validation/schemas';
import { ReviewCard, ReviewLead } from '../components/review-card';
import { Filters, ActiveFilters, hayFiltros } from '../components/filters';
import { EmptyState, Pagination } from '../components/ui';
import { BrandStack } from '../components/brand';

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

export const HomePage: FC<HomePageProps> = ({ env, results, categories, genres, query, tagline }) => {
  const filtrado = hayFiltros(query);
  // La pieza de apertura sólo tiene sentido en la portada limpia: con filtros o
  // en páginas siguientes, destacar una reseña sería arbitrario.
  const lead = !filtrado && query.page === 1 && query.sort === 'recent' ? results.items[0] : undefined;
  const resto = lead ? results.items.slice(1) : results.items;

  return (
    <>
      {/*
        Mancheta a la izquierda, sin centrar: el lockup vertical de la marca y
        debajo el lema y la franja de cifras del catálogo.
      */}
      <section class="hero">
        <div class="wrap hero__inner">
          <h1 class="hero__title">
            <BrandStack siteName={env.SITE_NAME} class="hero__logo" />
          </h1>
          <p class="hero__tagline">{tagline}</p>
          {!filtrado ? (
            <ul class="hero__meta">
              <li>
                <b>{results.total}</b> {results.total === 1 ? 'reseña publicada' : 'reseñas publicadas'}
              </li>
              <li>
                <b>{categories.length}</b> {categories.length === 1 ? 'categoría' : 'categorías'}
              </li>
            </ul>
          ) : null}
        </div>
      </section>

      <Filters query={query} categories={categories} genres={genres} total={results.total} />

      <div class="wrap">
        <ActiveFilters query={query} categories={categories} genres={genres} hrefFor={buildHref} />

        {results.items.length === 0 ? (
          <EmptyState
            title="No hay reseñas que coincidan con esos filtros"
            hint="Prueba a quitar algún filtro o a buscar otro título."
            icon="search"
          />
        ) : (
          <>
            {lead ? <ReviewLead review={lead} env={env} /> : null}

            {resto.length ? (
              <>
                {lead ? (
                  <div class="section-rule">
                    <p class="section-rule__title">Más del catálogo</p>
                  </div>
                ) : null}
                <div class="grid" data-review-grid>
                  {resto.map((review, index) => (
                    <ReviewCard review={review} env={env} priority={!lead && index < 4} />
                  ))}
                </div>
              </>
            ) : null}
          </>
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
};
