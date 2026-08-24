import { describe, it, expect } from 'vitest';
import {
  loginSchema, reviewInputSchema, reviewQuerySchema, commentInputSchema,
  reportInputSchema, passwordSchema, fieldErrors,
} from '../../src/validation/schemas';
import { SettingsSchema, DEFAULT_SETTINGS } from '../../src/server/lib/settings';

describe('loginSchema', () => {
  it('normaliza el email a minúsculas', () => {
    const parsed = loginSchema.parse({ email: '  Admin@Example.COM ', password: 'contraseña123' });
    expect(parsed.email).toBe('admin@example.com');
  });

  it('rechaza emails inválidos y contraseñas cortas', () => {
    expect(loginSchema.safeParse({ email: 'no-es-email', password: 'contraseña123' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'corta' }).success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('exige longitud y variedad', () => {
    expect(passwordSchema.safeParse('corta1A').success).toBe(false);
    expect(passwordSchema.safeParse('todominusculas123').success).toBe(false);
    expect(passwordSchema.safeParse('ClaveLargaSegura123').success).toBe(true);
  });
});

describe('reviewInputSchema', () => {
  const base = { titleEs: 'Dune', contentType: 'MOVIE' };

  it('aplica valores por defecto', () => {
    const parsed = reviewInputSchema.parse(base);
    expect(parsed.status).toBe('DRAFT');
    expect(parsed.rating).toBe(0);
    expect(parsed.genreIds).toEqual([]);
    expect(parsed.commentsMode).toBe('INHERIT');
  });

  it('acota la puntuación al rango 0..10', () => {
    expect(reviewInputSchema.safeParse({ ...base, rating: 11 }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...base, rating: -1 }).success).toBe(false);
    expect(reviewInputSchema.parse({ ...base, rating: 7 }).rating).toBe(7);
  });

  it('rechaza tipos de contenido desconocidos (anti mass assignment)', () => {
    expect(reviewInputSchema.safeParse({ ...base, contentType: 'HACK' }).success).toBe(false);
  });

  it('ignora campos no declarados', () => {
    const parsed = reviewInputSchema.parse({ ...base, isAdmin: true, id: 'inyectado' });
    expect(parsed).not.toHaveProperty('isAdmin');
    expect(parsed).not.toHaveProperty('id');
  });

  it('valida el año', () => {
    expect(reviewInputSchema.safeParse({ ...base, year: 1200 }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...base, year: 2024 }).success).toBe(true);
  });

  it('limita el número de géneros y plataformas', () => {
    const many = Array.from({ length: 30 }, () => crypto.randomUUID());
    expect(reviewInputSchema.safeParse({ ...base, genreIds: many }).success).toBe(false);
  });
});

describe('reviewQuerySchema', () => {
  it('aplica los valores por defecto del catálogo', () => {
    const parsed = reviewQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.sort).toBe('recent');
    expect(parsed.perPage).toBe(12);
  });

  it('acota perPage para evitar consultas gigantes', () => {
    expect(reviewQuerySchema.safeParse({ perPage: 1000 }).success).toBe(false);
  });

  it('rechaza slugs con caracteres raros', () => {
    expect(reviewQuerySchema.safeParse({ category: "libros' OR 1=1--" }).success).toBe(false);
  });

  it('rechaza órdenes desconocidos (evita inyección en ORDER BY)', () => {
    expect(reviewQuerySchema.safeParse({ sort: 'rating; DROP TABLE reviews' }).success).toBe(false);
  });
});

describe('commentInputSchema', () => {
  const reviewId = '44444444-4444-4444-8444-000000000001';

  it('exige alias y cuerpo mínimos', () => {
    expect(commentInputSchema.safeParse({ reviewId, alias: 'a', body: 'hola' }).success).toBe(false);
    expect(commentInputSchema.safeParse({ reviewId, alias: 'Ana', body: 'x' }).success).toBe(false);
    expect(commentInputSchema.safeParse({ reviewId, alias: 'Ana', body: 'hola' }).success).toBe(true);
  });

  it('limita la longitud del comentario', () => {
    const parsed = commentInputSchema.safeParse({ reviewId, alias: 'Ana', body: 'x'.repeat(3000) });
    expect(parsed.success).toBe(false);
  });

  it('exige que reviewId sea un UUID', () => {
    expect(commentInputSchema.safeParse({ reviewId: '1 OR 1=1', alias: 'Ana', body: 'hola' }).success).toBe(false);
  });
});

describe('reportInputSchema', () => {
  it('sólo acepta motivos conocidos', () => {
    const commentId = '66666666-6666-4666-8666-000000000001';
    expect(reportInputSchema.safeParse({ commentId, reason: 'SPAM' }).success).toBe(true);
    expect(reportInputSchema.safeParse({ commentId, reason: 'INVENTADO' }).success).toBe(false);
  });
});

describe('SettingsSchema', () => {
  it('tiene valores por defecto coherentes', () => {
    expect(DEFAULT_SETTINGS['moderation.report_threshold']).toBe(3);
    expect(DEFAULT_SETTINGS['comments.require_approval']).toBe(true);
    expect(DEFAULT_SETTINGS['comments.max_depth']).toBe(4);
  });

  it('acota el umbral de reportes', () => {
    expect(SettingsSchema.partial().safeParse({ 'moderation.report_threshold': 0 }).success).toBe(false);
    expect(SettingsSchema.partial().safeParse({ 'moderation.report_threshold': 5 }).success).toBe(true);
  });
});

describe('fieldErrors', () => {
  it('devuelve un mapa campo -> mensaje', () => {
    const result = reviewInputSchema.safeParse({ titleEs: '', contentType: 'MOVIE' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrors(result.error);
      expect(errors.titleEs).toBeTruthy();
    }
  });
});
