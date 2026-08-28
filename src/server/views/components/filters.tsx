import type { FC } from 'hono/jsx';
import type { CategoryWithCount, GenreWithCount } from '../../../db/repos/taxonomy';
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, REVIEW_SORTS, REVIEW_SORT_LABELS } from '../../../types/domain';
import type { ReviewQuery } from '../../../validation/schemas';
import { Icon } from './icons';

export interface FiltersProps {
  query: ReviewQuery;
  categories: CategoryWithCount[];
  genres: GenreWithCount[];
  total: number;
}

/** ¿Hay algo filtrando el catálogo, más allá del orden por omisión? */
export function hayFiltros(query: ReviewQuery): boolean {
  return Boolean(query.q || query.type || query.category || query.genre) || query.sort !== 'recent';
}

/**
 * Barra de filtros. Es un `<form method="get">`: funciona sin JavaScript, y el
 * JS del cliente sólo lo mejora (auto-envío al cambiar un select). Va pegada
 * bajo la cabecera para no perderse al recorrer una retícula larga.
 */
export const Filters: FC<FiltersProps> = ({ query, categories, genres, total }) => (
  <form class="filters" method="get" action="/" data-filters role="search">
    <div class="wrap">
      <div class="filters__row">
        <div class="field field--search">
          <label class="field__label" for="f-q">
            Buscar
          </label>
          <input
            id="f-q"
            class="input"
            type="search"
            name="q"
            value={query.q ?? ''}
            placeholder="Título, autor, director…"
            maxlength={120}
            autocomplete="off"
          />
        </div>

        <div class="field">
          <label class="field__label" for="f-type">
            Tipo
          </label>
          <select id="f-type" class="select" name="type" data-autosubmit>
            <option value="">Todos</option>
            {CONTENT_TYPES.map((type) => (
              <option value={type} selected={query.type === type}>
                {CONTENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        <div class="field">
          <label class="field__label" for="f-category">
            Categoría
          </label>
          <select id="f-category" class="select" name="category" data-autosubmit>
            <option value="">Todas</option>
            {categories.map((category) => (
              <option value={category.slug} selected={query.category === category.slug}>
                {category.name} ({category.reviewCount})
              </option>
            ))}
          </select>
        </div>

        <div class="field">
          <label class="field__label" for="f-genre">
            Género
          </label>
          <select id="f-genre" class="select" name="genre" data-autosubmit>
            <option value="">Todos</option>
            {genres
              .filter((genre) => genre.reviewCount > 0)
              .map((genre) => (
                <option value={genre.slug} selected={query.genre === genre.slug}>
                  {genre.name} ({genre.reviewCount})
                </option>
              ))}
          </select>
        </div>

        <div class="field">
          <label class="field__label" for="f-sort">
            Ordenar
          </label>
          <select id="f-sort" class="select" name="sort" data-autosubmit>
            {REVIEW_SORTS.map((sort) => (
              <option value={sort} selected={query.sort === sort}>
                {REVIEW_SORT_LABELS[sort]}
              </option>
            ))}
          </select>
        </div>

        <div class="filters__actions">
          <button type="submit" class="btn btn--primary">
            <Icon name="search" size={15} />
            Filtrar
          </button>
        </div>
      </div>

      <p class="filters__summary" aria-live="polite">
        {total === 1 ? '1 reseña' : `${total} reseñas`}
        {hayFiltros(query) ? ' con los filtros aplicados' : ' en el catálogo'}
      </p>
    </div>
  </form>
);

export interface ActiveFiltersProps {
  query: ReviewQuery;
  categories: CategoryWithCount[];
  genres: GenreWithCount[];
  /** Construye la URL del catálogo para una consulta y una página dadas. */
  hrefFor: (query: ReviewQuery, page: number) => string;
}

/**
 * Resumen de lo que está filtrando, con un enlace por filtro para quitarlo
 * suelto. Sin esto la única salida es "Limpiar" y perder también los demás.
 */
export const ActiveFilters: FC<ActiveFiltersProps> = ({ query, categories, genres, hrefFor }) => {
  if (!hayFiltros(query)) return null;

  const etiquetas: Array<{ texto: string; sin: ReviewQuery }> = [];

  if (query.q) etiquetas.push({ texto: `«${query.q}»`, sin: { ...query, q: undefined, page: 1 } });
  if (query.type) {
    etiquetas.push({ texto: CONTENT_TYPE_LABELS[query.type], sin: { ...query, type: undefined, page: 1 } });
  }
  if (query.category) {
    const nombre = categories.find((c) => c.slug === query.category)?.name ?? query.category;
    etiquetas.push({ texto: nombre, sin: { ...query, category: undefined, page: 1 } });
  }
  if (query.genre) {
    const nombre = genres.find((g) => g.slug === query.genre)?.name ?? query.genre;
    etiquetas.push({ texto: nombre, sin: { ...query, genre: undefined, page: 1 } });
  }
  if (query.sort !== 'recent') {
    etiquetas.push({ texto: REVIEW_SORT_LABELS[query.sort], sin: { ...query, sort: 'recent', page: 1 } });
  }

  return (
    <div class="active-filters">
      <span class="active-filters__label">Filtrando por</span>
      {etiquetas.map((etiqueta) => (
        <a class="chip chip--removable" href={hrefFor(etiqueta.sin, 1)}>
          {etiqueta.texto}
          <Icon name="close" size={13} />
          <span class="visually-hidden">Quitar este filtro</span>
        </a>
      ))}
      <a class="btn btn--link" href="/">
        Limpiar todo
      </a>
    </div>
  );
};
