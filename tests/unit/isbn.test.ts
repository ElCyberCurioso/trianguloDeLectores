import { describe, it, expect } from 'vitest';
import { normalizeIsbn, isValidIsbn10, isValidIsbn13, isbn10To13, parseIsbn } from '../../src/server/lib/isbn';

describe('ISBN', () => {
  it('quita guiones y espacios', () => {
    expect(normalizeIsbn('978-84-376-0494-7')).toBe('9788437604947');
    expect(normalizeIsbn(' 0 306 40615 2 ')).toBe('0306406152');
    expect(normalizeIsbn('080442957x')).toBe('080442957X');
  });

  it('valida el dígito de control del ISBN-10, incluida la X', () => {
    expect(isValidIsbn10('0306406152')).toBe(true);
    expect(isValidIsbn10('080442957X')).toBe(true);
    expect(isValidIsbn10('0306406153')).toBe(false);
  });

  it('valida el dígito de control del ISBN-13', () => {
    expect(isValidIsbn13('9788437604947')).toBe(true);
    expect(isValidIsbn13('9780306406157')).toBe(true);
    expect(isValidIsbn13('9788437604948')).toBe(false);
  });

  it('rechaza un EAN-13 que no es de un libro', () => {
    // Código de barras de un producto cualquiera: dígito de control correcto,
    // pero sin el prefijo 978/979 de la industria del libro.
    expect(isValidIsbn13('4006381333931')).toBe(false);
  });

  it('convierte ISBN-10 a ISBN-13', () => {
    expect(isbn10To13('0306406152')).toBe('9780306406157');
    expect(isbn10To13('0306406153')).toBeNull();
  });

  it('devuelve siempre el 13 y, si existe, el 10', () => {
    expect(parseIsbn('0306406152')).toEqual({ isbn13: '9780306406157', isbn10: '0306406152' });
    expect(parseIsbn('978-0-306-40615-7')).toEqual({ isbn13: '9780306406157', isbn10: '0306406152' });
  });

  it('no inventa un ISBN-10 para los que empiezan por 979', () => {
    // El espacio 979 no tiene equivalente en ISBN-10: no existe, no se rellena.
    const parsed = parseIsbn('9791234567896');
    expect(parsed?.isbn13).toBe('9791234567896');
    expect(parsed?.isbn10).toBeNull();
  });

  it('rechaza lo que no es un ISBN', () => {
    expect(parseIsbn('')).toBeNull();
    expect(parseIsbn('hola')).toBeNull();
    expect(parseIsbn('123')).toBeNull();
  });
});
