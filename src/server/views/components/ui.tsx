import type { FC, PropsWithChildren } from 'hono/jsx';
import { formatScore } from '../../../types/domain';
import { Icon, type IconName } from './icons';

/**
 * La nota, en la presentación del brand kit: cifra grande sobre 10, con coma
 * decimal, y el denominador en gris al lado. Sustituye a las estrellas, que el
 * sistema no contempla («las notas van sobre 10, con coma»).
 *
 * El tamaño sigue nombrándose sm/md/lg para no cambiar la firma en las decenas
 * de sitios que la usan.
 */
export const StarRating: FC<{ rating: number; size?: 'sm' | 'md' | 'lg'; showValue?: boolean }> = ({
  rating,
  size = 'md',
}) => (
  <span class={`score score--${size}`}>
    <span class="score__value">{formatScore(rating)}</span>
    <span class="score__max" aria-hidden="true">
      / 10
    </span>
    <span class="visually-hidden">de 10</span>
  </span>
);

export const Badge: FC<PropsWithChildren<{ tone?: 'neutral' | 'accent' | 'warn' | 'alert' | 'ok' }>> = ({
  tone = 'neutral',
  children,
}) => <span class={`badge badge--${tone}`}>{children}</span>;

export const EmptyState: FC<{ title: string; hint?: string; icon?: IconName }> = ({
  title,
  hint,
  icon = 'book',
}) => (
  <div class="empty">
    <Icon name={icon} size={30} class="empty__icon" />
    <p class="empty__title">{title}</p>
    {hint ? <p class="empty__hint">{hint}</p> : null}
  </div>
);

export interface PaginationProps {
  page: number;
  totalPages: number;
  /** función que construye la URL de una página */
  hrefFor: (page: number) => string;
}

export const Pagination: FC<PaginationProps> = ({ page, totalPages, hrefFor }) => {
  if (totalPages <= 1) return null;
  const windowSize = 2;
  const pages: number[] = [];
  for (let p = Math.max(1, page - windowSize); p <= Math.min(totalPages, page + windowSize); p++) pages.push(p);

  return (
    <nav class="pagination" aria-label="Paginación">
      <a
        class={`pagination__step${page <= 1 ? ' is-disabled' : ''}`}
        href={page > 1 ? hrefFor(page - 1) : '#'}
        rel="prev"
        aria-disabled={page <= 1 ? 'true' : 'false'}
      >
        Anterior
      </a>
      {pages[0]! > 1 ? (
        <>
          <a class="pagination__page" href={hrefFor(1)}>
            1
          </a>
          {pages[0]! > 2 ? <span class="pagination__gap">…</span> : null}
        </>
      ) : null}
      {pages.map((p) => (
        <a
          class={`pagination__page${p === page ? ' is-current' : ''}`}
          href={hrefFor(p)}
          aria-current={p === page ? 'page' : undefined}
        >
          {p}
        </a>
      ))}
      {pages[pages.length - 1]! < totalPages ? (
        <>
          {pages[pages.length - 1]! < totalPages - 1 ? <span class="pagination__gap">…</span> : null}
          <a class="pagination__page" href={hrefFor(totalPages)}>
            {totalPages}
          </a>
        </>
      ) : null}
      <a
        class={`pagination__step${page >= totalPages ? ' is-disabled' : ''}`}
        href={page < totalPages ? hrefFor(page + 1) : '#'}
        rel="next"
        aria-disabled={page >= totalPages ? 'true' : 'false'}
      >
        Siguiente
      </a>
    </nav>
  );
};

export const SkeletonGrid: FC<{ count?: number }> = ({ count = 6 }) => (
  <div class="grid" aria-hidden="true">
    {Array.from({ length: count }).map(() => (
      <div class="card card--skeleton">
        <div class="skeleton skeleton--cover" />
        <div class="skeleton skeleton--line" />
        <div class="skeleton skeleton--line skeleton--short" />
      </div>
    ))}
  </div>
);

/** Fecha legible en español. Los timestamps son epoch ms en UTC. */
export function formatDate(ts: number | null | undefined): string {
  if (!ts) return '';
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Madrid',
  }).format(new Date(ts));
}

export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return '';
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  }).format(new Date(ts));
}

export function isoDate(ts: number | null | undefined): string | undefined {
  return ts ? new Date(ts).toISOString() : undefined;
}
