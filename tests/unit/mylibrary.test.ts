import { describe, it, expect } from 'vitest';
import {
  mapMyLibraryBook, mapStatus, joinAuthors, composeNotes,
  type MyLibraryBook,
} from '../../src/server/lib/mylibrary';
import { extractYear } from '../../src/server/lib/year';

function ficha(extra: Partial<MyLibraryBook> = {}): MyLibraryBook {
  return {
    sourceId: 1,
    title: 'Fundación',
    author: 'Isaac Asimov',
    additionalAuthors: [],
    isbn: null,
    pages: null,
    publishedDate: null,
    publisher: null,
    summary: null,
    series: null,
    categories: [],
    comments: [],
    readingDates: null,
    read: false,
    inWishlist: false,
    amazonUrl: null,
    fnacUrl: null,
    ...extra,
  };
}

describe('año de publicación', () => {
  it('lo saca del texto libre en el que viene', () => {
    expect(extractYear('1951')).toBe(1951);
    expect(extractYear('12 de marzo de 1998')).toBe(1998);
    expect(extractYear('c1998')).toBe(1998);
  });

  it('no inventa nada cuando no hay año', () => {
    expect(extractYear('')).toBeNull();
    expect(extractYear(null)).toBeNull();
    expect(extractYear('sin fecha')).toBeNull();
    expect(extractYear('9999')).toBeNull();
  });
});

describe('estado del libro', () => {
  it('en casa por omisión, leído si estaba marcado', () => {
    expect(mapStatus({ read: false, inWishlist: false })).toBe('OWNED');
    expect(mapStatus({ read: true, inWishlist: false })).toBe('READ');
  });

  /** Un libro puede estar en la lista de deseos y marcado como leído a la vez.
      Lo que interesa saber es que todavía no está en la estantería. */
  it('la lista de deseos manda sobre leído', () => {
    expect(mapStatus({ read: true, inWishlist: true })).toBe('WISHLIST');
  });
});

describe('autores', () => {
  it('junta el principal con los secundarios', () => {
    expect(joinAuthors({ author: 'Asimov', additionalAuthors: ['Silverberg'] })).toBe('Asimov, Silverberg');
  });

  it('no repite ni deja huecos', () => {
    expect(joinAuthors({ author: 'Asimov', additionalAuthors: ['Asimov', '  ', ''] })).toBe('Asimov');
    expect(joinAuthors({ author: null, additionalAuthors: [] })).toBeNull();
  });
});

describe('conversión completa', () => {
  it('normaliza el ISBN y deriva el de 10 dígitos', () => {
    const mapped = mapMyLibraryBook(ficha({ isbn: '978-84-9800-332-1' }))!;
    expect(mapped.isbn13).toBe('9788498003321');
    expect(mapped.isbn10).toHaveLength(10);
  });

  /**
   * En un catálogo escrito a mano hay ISBN mal copiados. Guardarlos como
   * buenos rompería el antiduplicado, así que se descartan — pero se dejan
   * anotados: casi siempre es un dígito mal tecleado que se puede arreglar.
   */
  it('descarta un ISBN con dígito de control incorrecto, pero lo anota', () => {
    const mapped = mapMyLibraryBook(ficha({ isbn: '9788498003322' }))!;
    expect(mapped.isbn13).toBeNull();
    expect(mapped.notes).toContain('ISBN de origen (no válido): 9788498003322');
  });

  it('conserva en las notas lo que no tiene columna propia', () => {
    const mapped = mapMyLibraryBook(ficha({
      summary: 'Un imperio galáctico',
      series: 'Fundación',
      categories: ['Ciencia ficción', 'Clásicos'],
      comments: ['Regalo de mi hermana'],
      readingDates: 'verano de 2019',
      amazonUrl: 'https://amazon.es/x',
    }))!;
    expect(mapped.notes).toContain('Resumen: Un imperio galáctico');
    expect(mapped.notes).toContain('Serie: Fundación');
    expect(mapped.notes).toContain('Categorías: Ciencia ficción, Clásicos');
    expect(mapped.notes).toContain('Comentarios: Regalo de mi hermana');
    expect(mapped.notes).toContain('Fechas de lectura: verano de 2019');
    expect(mapped.notes).toContain('Amazon: https://amazon.es/x');
  });

  it('deja rastro de la procedencia', () => {
    expect(mapMyLibraryBook(ficha({ sourceId: 77 }))!.notes).toContain('Importado de MyLibrary (id 77)');
  });

  it('recorta las notas al techo del esquema', () => {
    const mapped = mapMyLibraryBook(ficha({ summary: 'x'.repeat(9000) }))!;
    expect(mapped.notes!.length).toBeLessThanOrEqual(4000);
  });

  it('sin título no hay libro', () => {
    expect(mapMyLibraryBook(ficha({ title: '   ' }))).toBeNull();
  });

  it('ignora un número de páginas imposible', () => {
    expect(mapMyLibraryBook(ficha({ pages: 0 }))!.pageCount).toBeNull();
    expect(mapMyLibraryBook(ficha({ pages: 999_999 }))!.pageCount).toBeNull();
    expect(mapMyLibraryBook(ficha({ pages: 300 }))!.pageCount).toBe(300);
  });

  it('no se inventa nota ni idioma: eso no viene en el origen', () => {
    const mapped = mapMyLibraryBook(ficha())!;
    expect(mapped.rating).toBeNull();
    expect(mapped.language).toBeNull();
    expect(mapped.location).toBeNull();
  });
});

describe('composeNotes', () => {
  it('devuelve al menos la procedencia aunque no haya nada más', () => {
    expect(composeNotes(ficha(), true)).toBe('Importado de MyLibrary (id 1)');
  });
});
