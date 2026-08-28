import type { FC } from 'hono/jsx';
import type { Paginated, ReviewListItem } from '../../../db/repos/reviews';
import type { Category } from '../../../db/schema';
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, REVIEW_SORTS, REVIEW_SORT_LABELS, formatScore } from '../../../types/domain';
import { AdminPage, CsrfField } from './shared';
import { Pagination, formatDateTime, EmptyState } from '../components/ui';

export interface AdminReviewsProps {
  results: Paginated<ReviewListItem>;
  categories: Category[];
  csrfToken: string;
  query: { q?: string; status: string; type?: string; category?: string; sort: string };
}

function hrefFor(query: AdminReviewsProps['query'], page: number): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status !== 'ALL') params.set('status', query.status);
  if (query.type) params.set('type', query.type);
  if (query.category) params.set('category', query.category);
  if (query.sort !== 'recent') params.set('sort', query.sort);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/admin/resenas?${qs}` : '/admin/resenas';
}

export const AdminReviewsPage: FC<AdminReviewsProps> = ({ results, categories, csrfToken, query }) => (
  <AdminPage
    title="Reseñas"
    actions={
      <a class="btn btn--primary" href="/admin/resenas/nueva">
        Nueva reseña
      </a>
    }
  >
    <form class="filters filters--admin" method="get" action="/admin/resenas">
      <input class="input" type="search" name="q" value={query.q ?? ''} placeholder="Buscar…" maxlength={120} />
      <select class="select" name="status" aria-label="Estado">
        <option value="ALL" selected={query.status === 'ALL'}>
          Todos los estados
        </option>
        <option value="PUBLISHED" selected={query.status === 'PUBLISHED'}>
          Publicadas
        </option>
        <option value="DRAFT" selected={query.status === 'DRAFT'}>
          Borradores
        </option>
      </select>
      <select class="select" name="type" aria-label="Tipo">
        <option value="">Todos los tipos</option>
        {CONTENT_TYPES.map((type) => (
          <option value={type} selected={query.type === type}>
            {CONTENT_TYPE_LABELS[type]}
          </option>
        ))}
      </select>
      <select class="select" name="category" aria-label="Categoría">
        <option value="">Todas las categorías</option>
        {categories.map((category) => (
          <option value={category.slug} selected={query.category === category.slug}>
            {category.name}
          </option>
        ))}
      </select>
      <select class="select" name="sort" aria-label="Orden">
        {REVIEW_SORTS.map((sort) => (
          <option value={sort} selected={query.sort === sort}>
            {REVIEW_SORT_LABELS[sort]}
          </option>
        ))}
      </select>
      <button type="submit" class="btn btn--ghost">
        Filtrar
      </button>
    </form>

    {results.items.length === 0 ? (
      <EmptyState title="No hay reseñas con esos filtros" hint="Crea una nueva o cambia la búsqueda." />
    ) : (
      <table class="table table--admin">
        <thead>
          <tr>
            <th scope="col">Título</th>
            <th scope="col">Tipo</th>
            <th scope="col">Año</th>
            <th scope="col">Nota</th>
            <th scope="col">Estado</th>
            <th scope="col">Coment.</th>
            <th scope="col">Actualizada</th>
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {results.items.map((review) => (
            <tr>
              <td>
                <a href={`/admin/resenas/${review.id}`}>{review.titleEs}</a>
                <span class="table__sub">/{review.slug}</span>
              </td>
              <td>{CONTENT_TYPE_LABELS[review.contentType]}</td>
              <td>{review.year ?? '—'}</td>
              <td class="table__score">{formatScore(review.rating)}</td>
              <td>
                <span class={`badge badge--${review.status === 'PUBLISHED' ? 'ok' : 'neutral'}`}>
                  {review.status === 'PUBLISHED' ? 'Publicada' : 'Borrador'}
                </span>
              </td>
              <td>{review.commentCount}</td>
              <td>{formatDateTime(review.updatedAt)}</td>
              <td class="table__actions">
                <form method="post" action={`/admin/resenas/${review.id}/estado`} class="inline-form">
                  <CsrfField token={csrfToken} />
                  <input
                    type="hidden"
                    name="status"
                    value={review.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED'}
                  />
                  <button type="submit" class="btn btn--sm btn--ghost">
                    {review.status === 'PUBLISHED' ? 'Despublicar' : 'Publicar'}
                  </button>
                </form>
                <form method="post" action={`/admin/resenas/${review.id}/duplicar`} class="inline-form">
                  <CsrfField token={csrfToken} />
                  <button type="submit" class="btn btn--sm btn--ghost">
                    Duplicar
                  </button>
                </form>
                <form
                  method="post"
                  action={`/admin/resenas/${review.id}/eliminar`}
                  class="inline-form"
                  data-confirm="¿Eliminar esta reseña?"
                >
                  <CsrfField token={csrfToken} />
                  <button type="submit" class="btn btn--sm btn--danger">
                    Eliminar
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}

    <Pagination page={results.page} totalPages={results.totalPages} hrefFor={(p) => hrefFor(query, p)} />
  </AdminPage>
);
