import type { FC } from 'hono/jsx';
import type { CategoryWithCount, GenreWithCount } from '../../../db/repos/taxonomy';
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, REVIEW_SORTS, REVIEW_SORT_LABELS } from '../../../types/domain';
import type { ReviewQuery } from '../../../validation/schemas';

export interface FiltersProps {
  query: ReviewQuery;
  categories: CategoryWithCount[];
  genres: GenreWithCount[];
  total: number;
}

/**
 * Filtros combinables. Es un `<form method="get">`: funciona sin JavaScript, y
 * el JS del cliente sólo lo mejora (auto-envío al cambiar un select).
 */
export const Filters: FC<FiltersProps> = ({ query, categories, genres, total }) => (
  <form class="filters" method="get" action="/" data-filters role="search">
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
          Filtrar
        </button>
        <a class="btn btn--ghost" href="/">
          Limpiar
        </a>
      </div>
    </div>

    <p class="filters__summary" aria-live="polite">
      {total === 1 ? '1 reseña' : `${total} reseñas`}
    </p>
  </form>
);
