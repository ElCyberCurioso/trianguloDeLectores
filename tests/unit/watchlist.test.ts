import { describe, it, expect } from 'vitest';
import { watchlistInputSchema, watchlistQuerySchema, watchlistActionSchema } from '../../src/validation/schemas';
import {
  PRIORITY_LABELS, PRIORITIES, WATCHLIST_STATUSES, WATCHLIST_STATUS_LABELS,
  WATCHLIST_ACTIVE_STATUSES,
} from '../../src/types/domain';

describe('watchlistInputSchema', () => {
  const base = { titleEs: 'Vinland Saga', contentType: 'MANGA' };

  it('aplica valores por defecto sensatos', () => {
    const parsed = watchlistInputSchema.parse(base);
    expect(parsed.status).toBe('PENDING');
    expect(parsed.priority).toBe('MEDIUM');
    expect(parsed.isPublic).toBe(true);
    expect(parsed.sortOrder).toBe(0);
  });

  it('exige un título con sustancia', () => {
    expect(watchlistInputSchema.safeParse({ ...base, titleEs: '' }).success).toBe(false);
    expect(watchlistInputSchema.safeParse({ ...base, titleEs: 'x' }).success).toBe(false);
  });

  it('rechaza tipos y prioridades inventadas', () => {
    expect(watchlistInputSchema.safeParse({ ...base, contentType: 'PODCAST' }).success).toBe(false);
    expect(watchlistInputSchema.safeParse({ ...base, priority: 'URGENTE' }).success).toBe(false);
  });

  it('valida el enlace de origen y admite dejarlo vacío', () => {
    expect(watchlistInputSchema.safeParse({ ...base, sourceUrl: 'no-es-una-url' }).success).toBe(false);
    expect(watchlistInputSchema.safeParse({ ...base, sourceUrl: '' }).success).toBe(true);
    expect(watchlistInputSchema.safeParse({ ...base, sourceUrl: 'https://example.com/x' }).success).toBe(true);
  });

  it('acota el año igual que las reseñas', () => {
    expect(watchlistInputSchema.safeParse({ ...base, year: 1200 }).success).toBe(false);
    expect(watchlistInputSchema.parse({ ...base, year: 2024 }).year).toBe(2024);
  });

  it('ignora campos no declarados', () => {
    const parsed = watchlistInputSchema.parse({ ...base, id: 'inyectado', reviewId: 'otro' });
    expect(parsed).not.toHaveProperty('id');
    expect(parsed).not.toHaveProperty('reviewId');
  });

  it('limita la longitud de la nota', () => {
    expect(watchlistInputSchema.safeParse({ ...base, note: 'x'.repeat(800) }).success).toBe(false);
  });
});

describe('watchlistQuerySchema', () => {
  it('por defecto muestra sólo la cola activa', () => {
    expect(watchlistQuerySchema.parse({}).status).toBe('ACTIVE');
    expect(watchlistQuerySchema.parse({}).sort).toBe('priority');
  });

  it('acepta ALL y cada estado concreto', () => {
    expect(watchlistQuerySchema.safeParse({ status: 'ALL' }).success).toBe(true);
    for (const status of WATCHLIST_STATUSES) {
      expect(watchlistQuerySchema.safeParse({ status }).success, status).toBe(true);
    }
  });

  it('rechaza órdenes desconocidos (evita inyección en ORDER BY)', () => {
    expect(watchlistQuerySchema.safeParse({ sort: 'created_at; DROP TABLE x' }).success).toBe(false);
  });

  it('acota perPage', () => {
    expect(watchlistQuerySchema.safeParse({ perPage: 5000 }).success).toBe(false);
  });
});

describe('watchlistActionSchema', () => {
  it('sólo acepta las acciones previstas', () => {
    for (const action of ['start', 'complete', 'drop', 'reopen', 'delete', 'convert', 'toggle-public']) {
      expect(watchlistActionSchema.safeParse({ action }).success, action).toBe(true);
    }
    expect(watchlistActionSchema.safeParse({ action: 'publish' }).success).toBe(false);
  });
});

describe('vocabulario', () => {
  it('cada prioridad y estado tiene etiqueta', () => {
    for (const priority of PRIORITIES) expect(PRIORITY_LABELS[priority]).toBeTruthy();
    for (const status of WATCHLIST_STATUSES) expect(WATCHLIST_STATUS_LABELS[status]).toBeTruthy();
  });

  it('los estados activos son un subconjunto de los estados válidos', () => {
    for (const status of WATCHLIST_ACTIVE_STATUSES) {
      expect(WATCHLIST_STATUSES).toContain(status);
    }
    expect(WATCHLIST_ACTIVE_STATUSES).not.toContain('DONE' as never);
  });
});

describe('URLs de enlace (regresión)', () => {
  const base = { titleEs: 'Con enlace', contentType: 'BOOK' };

  it('rechaza esquemas peligrosos donde z.string().url() los aceptaría', () => {
    // `z.string().url()` se apoya en el constructor URL, que traga cualquier
    // esquema. Como estos valores acaban en un href, hay que restringirlos.
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd']) {
      expect(watchlistInputSchema.safeParse({ ...base, sourceUrl: url }).success, url).toBe(false);
    }
  });

  it('acepta http y https', () => {
    expect(watchlistInputSchema.safeParse({ ...base, sourceUrl: 'https://example.com' }).success).toBe(true);
    expect(watchlistInputSchema.safeParse({ ...base, sourceUrl: 'http://example.com' }).success).toBe(true);
  });
});
