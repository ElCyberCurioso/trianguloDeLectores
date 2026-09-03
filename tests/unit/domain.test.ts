import { describe, it, expect } from 'vitest';
import {
  scoreToHalf, halfToScore, formatScore, scoreOptions, MAX_SCORE_HALF,
  CONTENT_TYPE_LABELS, CONTENT_TYPES,
} from '../../src/types/domain';
import { slugify, uniqueSlug } from '../../src/server/lib/slug';
import { decideTransition } from '../../src/do/moderation-rules';

describe('la nota, en medios puntos', () => {
  it('convierte la nota escrita a lo que se guarda', () => {
    expect(scoreToHalf(0)).toBe(0);
    expect(scoreToHalf(7.5)).toBe(15);
    expect(scoreToHalf(8)).toBe(16);
    expect(scoreToHalf(10)).toBe(20);
  });

  it('redondea al medio punto más cercano en vez de rechazar', () => {
    // Una nota con más precisión de la que la escala admite se ajusta: es
    // preferible a un 400 por escribir 7,3 en un campo que dice «de 0 a 10».
    expect(scoreToHalf(7.3)).toBe(15);
    expect(scoreToHalf(7.24)).toBe(14);
  });

  it('acota fuera de rango', () => {
    expect(scoreToHalf(-3)).toBe(0);
    expect(scoreToHalf(99)).toBe(20);
    expect(halfToScore(-1)).toBe(0);
    expect(halfToScore(999)).toBe(10);
  });

  it('es reversible en los 21 valores de la escala', () => {
    for (let half = 0; half <= MAX_SCORE_HALF; half++) {
      expect(scoreToHalf(halfToScore(half))).toBe(half);
    }
  });

  it('formatea siempre con un decimal y coma, como el brand kit', () => {
    expect(formatScore(15)).toBe('7,5');
    expect(formatScore(16)).toBe('8,0');
    expect(formatScore(0)).toBe('0,0');
    expect(formatScore(20)).toBe('10,0');
  });

  it('ofrece los 21 valores para pintar el desplegable', () => {
    expect(scoreOptions()).toHaveLength(21);
    expect(scoreOptions().at(-1)).toBe(20);
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
