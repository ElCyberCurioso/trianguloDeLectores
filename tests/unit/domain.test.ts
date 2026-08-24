import { describe, it, expect } from 'vitest';
import { ratingToStars, starsToRating, formatStars, CONTENT_TYPE_LABELS, CONTENT_TYPES } from '../../src/types/domain';
import { slugify, uniqueSlug } from '../../src/server/lib/slug';
import { decideTransition } from '../../src/do/moderation-rules';

describe('puntuación en medias estrellas', () => {
  it('convierte el entero interno a estrellas', () => {
    expect(ratingToStars(0)).toBe(0);
    expect(ratingToStars(1)).toBe(0.5);
    expect(ratingToStars(5)).toBe(2.5);
    expect(ratingToStars(9)).toBe(4.5);
    expect(ratingToStars(10)).toBe(5);
  });

  it('acota fuera de rango', () => {
    expect(ratingToStars(-3)).toBe(0);
    expect(ratingToStars(99)).toBe(5);
  });

  it('convierte estrellas a entero interno', () => {
    expect(starsToRating(0)).toBe(0);
    expect(starsToRating(2.5)).toBe(5);
    expect(starsToRating(5)).toBe(10);
    expect(starsToRating(7)).toBe(10);
  });

  it('es reversible en los 11 valores válidos', () => {
    for (let value = 0; value <= 10; value++) {
      expect(starsToRating(ratingToStars(value))).toBe(value);
    }
  });

  it('formatea con coma decimal en español', () => {
    expect(formatStars(7)).toBe('3,5');
    expect(formatStars(8)).toBe('4');
  });
});

describe('etiquetas de tipo de contenido', () => {
  it('cubre todos los tipos', () => {
    for (const type of CONTENT_TYPES) {
      expect(CONTENT_TYPE_LABELS[type]).toBeTruthy();
    }
  });
});

describe('slugify', () => {
  it('normaliza acentos y eñes', () => {
    expect(slugify('El Corazón de la Niña Española')).toBe('el-corazon-de-la-nina-espanola');
  });

  it('elimina puntuación y colapsa separadores', () => {
    expect(slugify('¡¿Dune: Parte Uno?!')).toBe('dune-parte-uno');
  });

  it('nunca devuelve cadena vacía', () => {
    expect(slugify('!!!')).toBe('sin-titulo');
  });

  it('trunca sin dejar guion final', () => {
    const out = slugify('a'.repeat(200));
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith('-')).toBe(false);
  });
});

describe('uniqueSlug', () => {
  it('sufija cuando hay colisión', async () => {
    const taken = new Set(['dune', 'dune-2']);
    const slug = await uniqueSlug('Dune', async (candidate) => !taken.has(candidate));
    expect(slug).toBe('dune-3');
  });
});

describe('umbral de reportes', () => {
  it('no transiciona por debajo del umbral', () => {
    expect(decideTransition(2, 'APPROVED', 3, 10)).toBeNull();
  });

  it('pasa a REPORTED al alcanzar el umbral', () => {
    expect(decideTransition(3, 'APPROVED', 3, 10)).toBe('REPORTED');
    expect(decideTransition(4, 'PENDING', 3, 10)).toBe('REPORTED');
  });

  it('pasa a HIDDEN al alcanzar el umbral de ocultación', () => {
    expect(decideTransition(10, 'REPORTED', 3, 10)).toBe('HIDDEN');
  });

  it('no vuelve a transicionar un comentario ya oculto', () => {
    expect(decideTransition(50, 'HIDDEN', 3, 10)).toBeNull();
  });

  it('no reactiva un comentario rechazado', () => {
    expect(decideTransition(5, 'REJECTED', 3, 10)).toBeNull();
  });
});
