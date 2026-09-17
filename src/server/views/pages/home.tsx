import type { FC } from 'hono/jsx';
import type { Bindings } from '../../../types/env';
import type { Paginated, ReviewListItem } from '../../../db/repos/reviews';
import type { CategoryWithCount, GenreWithCount } from '../../../db/repos/taxonomy';
import type { ReviewQuery } from '../../../validation/schemas';
import { ReviewCard, ReviewLead } from '../components/review-card';
import { Filters, ActiveFilters, hayFiltros } from '../components/filters';
import { EmptyState, Pagination } from '../components/ui';
import { BrandStack } from '../components/brand';

/**
 * La sección propia en la que se está, cuando no es la portada.
 *
 * `/genero/drama` y `/?genre=drama` listan lo mismo, pero no son lo mismo: la
 * primera es una página con titular, texto y sitio en el sitemap, y es por
 * donde entra quien no conoce el sitio. Reutilizan esta vista porque la
 * retícula, los filtros y la paginación ya están aquí; lo único que cambia es
 * la cabecera y a dónde apuntan los enlaces.
 */
export interface Seccion {
  kind: 'categoria' | 'genero';
  slug: string;
  name: string;
  description: string;
}

export interface HomePageProps {
  env: Bindings;
  results: Paginated<ReviewListItem>;
  categories: CategoryWithCount[];
  genres: GenreWithCount[];
  query: ReviewQuery;
  tagline: string;
  seccion?: Seccion;
}

/** `/genero/drama` o `/categoria/cine`; la portada es `/`. */
export function rutaDeSeccion(seccion: Seccion | undefined): string {
  if (!seccion) return '/';
  return seccion.kind === 'genero' ? `/genero/${seccion.slug}` : `/categoria/${seccion.slug}`;
}

function buildHref(query: ReviewQuery, page: number, seccion?: Seccion): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  // Dentro de una sección, su filtro va en la ruta y no se repite en la query:
  // `/genero/drama?genre=drama` sería la misma página escrita dos veces, y cada
  // forma de escribirla es una URL más que el buscador tiene que reconciliar.
  if (query.category && seccion?.kind !== 'categoria') params.set('category', query.category);
  if (query.genre && seccion?.kind !== 'genero') params.set('genre', query.genre);
  if (query.type) params.set('type', query.type);
  if (query.sort !== 'recent') params.set('sort', query.sort);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  const base = rutaDeSeccion(seccion);
  return qs ? `${base}?${qs}` : base;
}

export const HomePage: FC<HomePageProps> = ({ env, results, categories, genres, query, tagline, seccion }) => {
  const filtrado = hayFiltros(query);
  const href = (q: ReviewQuery, page: number) => buildHref(q, page, seccion);
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
      {seccion ? (
        /*
          En una sección manda el titular, no la marca: quien llega aquí desde
          un buscador tiene que leer de qué va la página antes que cómo se
          llama el sitio. La miga de pan da la vuelta a la portada y se marca
          además en JSON-LD, que es lo que pinta la ruta bajo el resultado.
        */
        <section class="hero hero--seccion">
          <div class="wrap hero__inner">
            <nav class="breadcrumb" aria-label="Migas de pan">
              <a href="/">{env.SITE_NAME}</a>
              <span aria-hidden="true">/</span>
              <span>{seccion.kind === 'genero' ? 'Género' : 'Categoría'}</span>
            </nav>
            <h1 class="hero__title hero__title--texto">{seccion.name}</h1>
            <p class="hero__tagline">{seccion.description}</p>
            <ul class="hero__meta">
              <li>
                <b>{results.total}</b> {results.total === 1 ? 'reseña' : 'reseñas'}
              </li>
            </ul>
          </div>
        </section>
      ) : (
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
      )}

      <Filters query={query} categories={categories} genres={genres} total={results.total} />

      <div class="wrap">
        <ActiveFilters query={query} categories={categories} genres={genres} hrefFor={href} />

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

        <Pagination page={results.page} totalPages={results.totalPages} hrefFor={(p) => href(query, p)} />
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
