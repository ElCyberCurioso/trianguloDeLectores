import { describe, it, expect } from 'vitest';
import {
  extractYear, parseYearRange, formatYearRange, yearRangeToInput,
} from '../../src/server/lib/year';

describe('extractYear', () => {
  it('acepta el año con basura alrededor', () => {
    expect(extractYear('c1998')).toBe(1998);
    expect(extractYear('12 de marzo de 1998')).toBe(1998);
  });

  it('rechaza lo que no es un año', () => {
    expect(extractYear('19985')).toBeNull();
    expect(extractYear('')).toBeNull();
    expect(extractYear(null)).toBeNull();
  });
});

describe('parseYearRange', () => {
  it('un año suelto no es un periodo', () => {
    expect(parseYearRange('1999')).toEqual({ year: 1999, yearEnd: null, yearOngoing: false });
  });

  it('entiende el periodo cerrado con cualquier separador', () => {
    const esperado = { year: 2020, yearEnd: 2022, yearOngoing: false };
    expect(parseYearRange('2020-2022')).toEqual(esperado);
    expect(parseYearRange('2020–2022')).toEqual(esperado);
    expect(parseYearRange('2020 - 2022')).toEqual(esperado);
    expect(parseYearRange('2020 a 2022')).toEqual(esperado);
    expect(parseYearRange('2020/2022')).toEqual(esperado);
  });

  it('entiende que sigue en marcha, se diga como se diga', () => {
    const esperado = { year: 2023, yearEnd: null, yearOngoing: true };
    expect(parseYearRange('2023-actualidad')).toEqual(esperado);
    expect(parseYearRange('2023 - Actualidad')).toEqual(esperado);
    expect(parseYearRange('2023-hoy')).toEqual(esperado);
    expect(parseYearRange('2023-presente')).toEqual(esperado);
    expect(parseYearRange('2023 a la actualidad')).toEqual(esperado);
    expect(parseYearRange('desde 2023')).toEqual(esperado);
    expect(parseYearRange('2023-')).toEqual(esperado);
  });

  it('endereza el periodo escrito al revés', () => {
    expect(parseYearRange('2022-2020')).toEqual({ year: 2020, yearEnd: 2022, yearOngoing: false });
  });

  it('el periodo de un solo año no guarda final', () => {
    expect(parseYearRange('2020-2020')).toEqual({ year: 2020, yearEnd: null, yearOngoing: false });
  });

  it('sin año reconocible se queda vacío en vez de romper', () => {
    expect(parseYearRange('el año pasado')).toEqual({ year: null, yearEnd: null, yearOngoing: false });
    expect(parseYearRange('')).toEqual({ year: null, yearEnd: null, yearOngoing: false });
  });

  it('un final ilegible no se lleva por delante el principio', () => {
    expect(parseYearRange('2020-vete a saber')).toEqual({ year: 2020, yearEnd: null, yearOngoing: false });
  });
});

describe('formatYearRange', () => {
  it('pinta el rango con raya y la actualidad por su nombre', () => {
    expect(formatYearRange({ year: 2020, yearEnd: 2022, yearOngoing: false })).toBe('2020–2022');
    expect(formatYearRange({ year: 2023, yearOngoing: true })).toBe('2023–actualidad');
    expect(formatYearRange({ year: 1999 })).toBe('1999');
  });

  it('acepta el 0/1 de SQLite igual que un booleano', () => {
    expect(formatYearRange({ year: 2023, yearEnd: null, yearOngoing: 1 })).toBe('2023–actualidad');
    expect(formatYearRange({ year: 2023, yearEnd: null, yearOngoing: 0 })).toBe('2023');
  });

  it('sin año no hay nada que pintar', () => {
    expect(formatYearRange({ year: null })).toBeNull();
    expect(formatYearRange(null)).toBeNull();
  });
});

describe('yearRangeToInput', () => {
  it('lo que devuelve vuelve a entrar sin perder nada', () => {
    for (const texto of ['1999', '2020-2022', '2023-actualidad', '']) {
      const ida = parseYearRange(texto);
      const vuelta = parseYearRange(yearRangeToInput(ida));
      expect(vuelta).toEqual(ida);
    }
  });
});
