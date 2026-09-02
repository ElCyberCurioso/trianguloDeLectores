import { describe, it, expect } from 'vitest';
import {
  isSafePdfKey, isSafeBookCoverKey, buildPdfKey, buildBookCoverKey,
  looksLikePdf, bookCoverUrl, bookCoverKeyFromPath, booksHost, isBooksRequest,
} from '../../src/server/lib/books';
import { isSafeMediaKey } from '../../src/server/lib/images';
import { isBackupKey } from '../../src/server/services/backup';
import type { Bindings } from '../../src/types/env';

const env = { SITE_URL: 'https://ejemplo.test' } as Bindings;

describe('claves de la biblioteca privada', () => {
  it('genera claves con el prefijo y la forma esperados', () => {
    expect(isSafePdfKey(buildPdfKey())).toBe(true);
    expect(isSafeBookCoverKey(buildBookCoverKey('jpg'))).toBe(true);
  });

  it('rechaza travesía de rutas y claves ajenas', () => {
    expect(isSafePdfKey('books/pdf/../../secreto.pdf')).toBe(false);
    expect(isSafePdfKey('books/pdf/2026/ab/no-es-un-uuid.pdf')).toBe(false);
    expect(isSafePdfKey('reviews/covers/2026/ab/11111111-1111-4111-8111-111111111111.jpg')).toBe(false);
    expect(isSafeBookCoverKey('books/covers/2026/ab/%2e%2e/otro.jpg')).toBe(false);
  });

  /**
   * La propiedad que sostiene toda la privacidad: la ruta pública `/media/*`
   * usa `isSafeMediaKey`, que sólo conoce las portadas de las reseñas. Si
   * alguien ampliase ese patrón, los PDF y los backups quedarían al alcance de
   * cualquiera sin sesión.
   */
  it('la ruta pública de medios no reconoce nada de la biblioteca', () => {
    expect(isSafeMediaKey(buildPdfKey())).toBe(false);
    expect(isSafeMediaKey(buildBookCoverKey('png'))).toBe(false);
    expect(isSafeMediaKey('backups/library/2026-08-31.json.gz')).toBe(false);
  });

  it('sólo acepta claves de copia con forma de fecha', () => {
    expect(isBackupKey('backups/library/2026-08-31.json.gz')).toBe(true);
    expect(isBackupKey('backups/library/../../reviews/covers/x.jpg')).toBe(false);
    expect(isBackupKey('backups/library/cualquier-cosa.json.gz')).toBe(false);
  });

  it('la URL de una portada va y vuelve sin perder la clave', () => {
    const key = buildBookCoverKey('webp');
    const url = bookCoverUrl(key)!;
    expect(url.startsWith('/portadas/')).toBe(true);
    expect(bookCoverKeyFromPath(url.replace('/portadas/', ''))).toBe(key);
  });

  it('no devuelve URL para una clave que no es suya', () => {
    expect(bookCoverUrl('reviews/covers/2026/ab/11111111-1111-4111-8111-111111111111.jpg')).toBeNull();
    expect(bookCoverKeyFromPath('../../etc/passwd')).toBeNull();
  });
});

describe('detección de PDF por contenido', () => {
  it('acepta lo que empieza por %PDF-', () => {
    expect(looksLikePdf(new TextEncoder().encode('%PDF-1.7'))).toBe(true);
  });

  it('rechaza otros formatos aunque se llamen .pdf', () => {
    // Un PNG con extensión cambiada: el tipo declarado por el cliente no vale.
    expect(looksLikePdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe(false);
    expect(looksLikePdf(new TextEncoder().encode('<html'))).toBe(false);
    expect(looksLikePdf(new Uint8Array([0x25, 0x50]))).toBe(false);
  });
});

describe('reparto por host', () => {
  it('deduce el subdominio a partir del sitio', () => {
    expect(booksHost(env)).toBe('books.ejemplo.test');
  });

  it('respeta BOOKS_URL cuando está declarado', () => {
    expect(booksHost({ ...env, BOOKS_URL: 'http://books.localhost:8787' })).toBe('books.localhost:8787');
  });

  it('sólo desvía las peticiones de ese host', () => {
    expect(isBooksRequest(new Request('https://books.ejemplo.test/'), env)).toBe(true);
    expect(isBooksRequest(new Request('https://ejemplo.test/'), env)).toBe(false);
    // Un host que sólo empieza igual no cuenta.
    expect(isBooksRequest(new Request('https://books.ejemplo.test.malo.test/'), env)).toBe(false);
  });
});
