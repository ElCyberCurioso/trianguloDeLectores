import { describe, it, expect } from 'vitest';
import {
  sortLibrary, surnameKey, givenKey,
  LIBRARY_SORTS, LIBRARY_SORT_DEFAULT, LIBRARY_SORT_LABELS,
} from '../../src/server/lib/library-sort';
import type { LibraryRecord } from '../../src/db/repos/library';

function libro(extra: Partial<LibraryRecord> = {}): LibraryRecord {
  return {
    id: crypto.randomUUID(),
    isbn13: null, isbn10: null,
    title: 'Título', subtitle: null, authors: null, publisher: null,
    publishedYear: null, pageCount: null, language: null, coverKey: null,
    location: null, status: 'OWNED', rating: null, notes: null, source: 'MANUAL',
    createdAt: 1, updatedAt: 1,
    ...extra,
  };
}

const titulos = (libros: LibraryRecord[]) => libros.map((l) => l.title);

describe('apellido con el que se archiva un autor', () => {
  it('nombre y apellido simples', () => {
    expect(surnameKey('Isaac Asimov')).toBe('Asimov');
    expect(givenKey('Isaac Asimov')).toBe('Isaac');
  });

  /** En español se archiva por el primer apellido, no por el último. */
  it('dos apellidos se conservan enteros', () => {
    expect(surnameKey('Gabriel García Márquez')).toBe('García Márquez');
  });

  /** «Miguel de Cervantes» se busca por la C, no por la D. */
  it('quita las partículas del principio', () => {
    expect(surnameKey('Miguel de Cervantes')).toBe('Cervantes');
    expect(surnameKey('Ludwig van Beethoven')).toBe('Beethoven');
    expect(surnameKey('Lope de Vega')).toBe('Vega');
  });

  it('conserva la partícula si va dentro del apellido', () => {
    expect(surnameKey('Félix Rodríguez de la Fuente')).toBe('Rodríguez de la Fuente');
  });

  it('un autor de una sola palabra se archiva por ella', () => {
    expect(surnameKey('Homero')).toBe('Homero');
    expect(givenKey('Homero')).toBe('Homero');
  });

  it('con varios autores manda el primero', () => {
    expect(surnameKey('Isaac Asimov, Robert Silverberg')).toBe('Asimov');
  });

  it('sin autor no revienta', () => {
    expect(surnameKey(null)).toBe('');
    expect(givenKey(null)).toBe('');
  });
});

describe('orden alfabético en español', () => {
  /**
   * Es la razón de ordenar en el Worker y no en SQL: SQLite compara códigos de
   * carácter, y así «Álvarez» queda detrás de «Zapata».
   */
  it('las tildes no mandan las palabras al final', () => {
    const libros = sortLibrary(
      [
        libro({ title: 'Zapatos', authors: 'Zoe Zapata' }),
        libro({ title: 'Árboles', authors: 'Ana Álvarez' }),
        libro({ title: 'Barcos', authors: 'Beto Borges' }),
      ],
      'apellido',
    );
    expect(titulos(libros)).toEqual(['Árboles', 'Barcos', 'Zapatos']);
  });

  it('ordena por título sin que la mayúscula altere el sitio', () => {
    const libros = sortLibrary(
      [libro({ title: 'zorro' }), libro({ title: 'Ámbar' }), libro({ title: 'Bosque' })],
      'titulo',
    );
    expect(titulos(libros)).toEqual(['Ámbar', 'Bosque', 'zorro']);
  });
});

describe('criterios numéricos', () => {
  /**
   * De 229 fichas, 137 no traen año. Si lo que no tiene dato saliera primero al
   * pedir «más reciente», el orden escondería el catálogo en vez de mostrarlo.
   */
  it('lo que no tiene dato va al final, se ordene como se ordene', () => {
    const libros = [
      libro({ title: 'Sin año' }),
      libro({ title: 'Viejo', publishedYear: 1950 }),
      libro({ title: 'Nuevo', publishedYear: 2020 }),
    ];
    expect(titulos(sortLibrary(libros, 'anyo-desc'))).toEqual(['Nuevo', 'Viejo', 'Sin año']);
    expect(titulos(sortLibrary(libros, 'anyo-asc'))).toEqual(['Viejo', 'Nuevo', 'Sin año']);
  });

  it('ordena por páginas en los dos sentidos', () => {
    const libros = [
      libro({ title: 'Corto', pageCount: 100 }),
      libro({ title: 'Largo', pageCount: 900 }),
      libro({ title: 'Sin dato' }),
    ];
    expect(titulos(sortLibrary(libros, 'paginas-desc'))).toEqual(['Largo', 'Corto', 'Sin dato']);
    expect(titulos(sortLibrary(libros, 'paginas-asc'))).toEqual(['Corto', 'Largo', 'Sin dato']);
  });

  it('la nota mejor primero', () => {
    const libros = [
      libro({ title: 'Regular', rating: 5 }),
      libro({ title: 'Bueno', rating: 9 }),
      libro({ title: 'Sin nota' }),
    ];
    expect(titulos(sortLibrary(libros, 'nota'))).toEqual(['Bueno', 'Regular', 'Sin nota']);
  });
});

describe('estado', () => {
  it('primero lo que se está leyendo y al final lo que no se tiene', () => {
    const libros = [
      libro({ title: 'Deseado', status: 'WISHLIST' }),
      libro({ title: 'Leyendo', status: 'READING' }),
      libro({ title: 'Prestado', status: 'LENT' }),
      libro({ title: 'En casa', status: 'OWNED' }),
    ];
    expect(titulos(sortLibrary(libros, 'estado'))).toEqual(['Leyendo', 'En casa', 'Prestado', 'Deseado']);
  });
});

describe('estabilidad', () => {
  /** Sin desempate, dos libros del mismo autor cambiarían de sitio entre
      recargas y la lista parecería moverse sola. */
  it('todos los criterios desempatan por título', () => {
    const libros = [
      libro({ title: 'Zeta', authors: 'Isaac Asimov' }),
      libro({ title: 'Alfa', authors: 'Isaac Asimov' }),
    ];
    expect(titulos(sortLibrary(libros, 'apellido'))).toEqual(['Alfa', 'Zeta']);
  });

  it('no modifica el array que recibe', () => {
    const libros = [libro({ title: 'B' }), libro({ title: 'A' })];
    sortLibrary(libros, 'titulo');
    expect(titulos(libros)).toEqual(['B', 'A']);
  });

  it('todos los criterios declarados tienen comparador', () => {
    const libros = [libro({ title: 'A' }), libro({ title: 'B' })];
    for (const criterio of LIBRARY_SORTS) {
      expect(sortLibrary(libros, criterio), criterio).toHaveLength(2);
    }
  });
});

describe('orden por omisión', () => {
  /** Es el mismo criterio con el que está ordenada la biblioteca en papel. */
  it('es el apellido del autor', () => {
    expect(LIBRARY_SORT_DEFAULT).toBe('apellido');
  });

  it('encabeza el desplegable', () => {
    expect(Object.keys(LIBRARY_SORT_LABELS)[0]).toBe(LIBRARY_SORT_DEFAULT);
    expect(LIBRARY_SORTS[0]).toBe(LIBRARY_SORT_DEFAULT);
  });

  /** Un criterio que no existe no puede dejar la lista sin ordenar. */
  it('un criterio desconocido cae en él', () => {
    const libros = [
      libro({ title: 'Zeta', authors: 'Zoe Zapata' }),
      libro({ title: 'Alfa', authors: 'Ana Álvarez' }),
    ];
    expect(titulos(sortLibrary(libros, 'inventado' as never))).toEqual(['Alfa', 'Zeta']);
  });
});
