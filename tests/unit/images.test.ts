import { describe, it, expect } from 'vitest';
import {
  sniffImageType, validateImage, buildCoverKey, isSafeMediaKey, readDimensions, MAX_IMAGE_BYTES,
} from '../../src/server/lib/images';

function pngBytes(width = 800, height = 1200): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpegBytes(): Uint8Array {
  // SOI + APP0 mínimo + SOF0 con 800x1200
  const bytes = new Uint8Array(32);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, 16); // longitud del APP0
  bytes[20] = 0xff;
  bytes[21] = 0xc0;
  view.setUint16(22, 17);
  view.setUint16(25, 1200); // alto
  view.setUint16(27, 800); // ancho
  return bytes;
}

function webpBytes(): Uint8Array {
  const bytes = new Uint8Array(64);
  const enc = new TextEncoder();
  bytes.set(enc.encode('RIFF'), 0);
  bytes.set(enc.encode('WEBP'), 8);
  bytes.set(enc.encode('VP8X'), 12);
  bytes[24] = 0x1f; bytes[25] = 0x03; bytes[26] = 0x00; // 799 + 1
  bytes[27] = 0xaf; bytes[28] = 0x04; bytes[29] = 0x00; // 1199 + 1
  return bytes;
}

describe('detección de tipo por magic bytes', () => {
  it('reconoce PNG, JPEG y WebP', () => {
    expect(sniffImageType(pngBytes())).toBe('image/png');
    expect(sniffImageType(jpegBytes())).toBe('image/jpeg');
    expect(sniffImageType(webpBytes())).toBe('image/webp');
  });

  it('rechaza contenido que no es imagen aunque diga serlo', () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    expect(sniffImageType(html)).toBeNull();
  });

  it('rechaza un PHP con extensión de imagen (MIME spoofing)', () => {
    const php = new TextEncoder().encode('<?php system($_GET["c"]); ?>            ');
    expect(sniffImageType(php)).toBeNull();
  });

  it('rechaza SVG (vector de XSS)', () => {
    const svg = new TextEncoder().encode('<svg onload="alert(1)" xmlns="http://www.w3.org/2000/svg"/>');
    expect(sniffImageType(svg)).toBeNull();
  });
});

describe('lectura de dimensiones', () => {
  it('lee PNG', () => {
    expect(readDimensions(pngBytes(640, 960), 'image/png')).toEqual({ width: 640, height: 960 });
  });
  it('lee JPEG', () => {
    expect(readDimensions(jpegBytes(), 'image/jpeg')).toEqual({ width: 800, height: 1200 });
  });
  it('lee WebP VP8X', () => {
    expect(readDimensions(webpBytes(), 'image/webp')).toEqual({ width: 800, height: 1200 });
  });
});

describe('validateImage', () => {
  it('acepta una imagen válida', () => {
    const result = validateImage(pngBytes());
    expect(result.ok).toBe(true);
  });

  it('rechaza ficheros vacíos y minúsculos', () => {
    expect(validateImage(new Uint8Array(0))).toEqual({ ok: false, error: 'empty' });
    expect(validateImage(new Uint8Array(10))).toEqual({ ok: false, error: 'too_small' });
  });

  it('rechaza por tamaño máximo', () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    expect(validateImage(big)).toEqual({ ok: false, error: 'too_large' });
  });

  it('rechaza formatos no permitidos', () => {
    const gif = new TextEncoder().encode('GIF89a' + 'x'.repeat(80));
    expect(validateImage(gif)).toEqual({ ok: false, error: 'unsupported_type' });
  });

  it('rechaza dimensiones absurdas (bomba de descompresión)', () => {
    expect(validateImage(pngBytes(20000, 20000))).toEqual({ ok: false, error: 'dimensions_out_of_range' });
    expect(validateImage(pngBytes(10, 10))).toEqual({ ok: false, error: 'dimensions_out_of_range' });
  });
});

describe('claves de objeto en R2', () => {
  it('genera claves impredecibles bajo el prefijo esperado', () => {
    const key = buildCoverKey('image/webp');
    expect(key).toMatch(/^reviews\/covers\/\d{4}\/[0-9a-f]{2}\/[0-9a-f-]{36}\.webp$/);
    expect(buildCoverKey('image/webp')).not.toBe(key);
  });

  it('acepta sólo claves generadas por el servidor', () => {
    expect(isSafeMediaKey(buildCoverKey('image/png'))).toBe(true);
  });

  it('rechaza path traversal y rutas arbitrarias', () => {
    const maliciosas = [
      '../../etc/passwd',
      'reviews/covers/../../secret.png',
      'reviews/covers/2026/ab/../../../x.png',
      '/etc/passwd',
      'reviews/covers/2026/ab/file.php',
      'reviews//covers/2026/ab/00000000-0000-4000-8000-000000000000.png',
      'reviews/covers/2026/ab/%2e%2e%2fx.png',
      'reviews/covers/2026/ab/' + 'a'.repeat(200) + '.png',
    ];
    for (const key of maliciosas) {
      expect(isSafeMediaKey(key), key).toBe(false);
    }
  });
});
