import { describe, it, expect } from 'vitest';
import { isAllowedRemoteImageUrl } from '../../src/server/lib/remote-image';

/**
 * Traer una imagen de una URL que escribe alguien es superficie de SSRF, y que
 * detrás haya una sesión de administrador reduce el riesgo pero no lo quita:
 * una URL pegada de cualquier sitio puede apuntar a donde no debe.
 */
describe('URLs permitidas para una portada remota', () => {
  it('acepta direcciones públicas http y https', () => {
    expect(isAllowedRemoteImageUrl('https://ejemplo.test/portada.jpg')).toBe(true);
    expect(isAllowedRemoteImageUrl('http://ejemplo.test:80/a.png')).toBe(true);
    expect(isAllowedRemoteImageUrl('https://ejemplo.test:443/a.png')).toBe(true);
  });

  it('rechaza esquemas que no son http', () => {
    expect(isAllowedRemoteImageUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedRemoteImageUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isAllowedRemoteImageUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedRemoteImageUrl('ftp://ejemplo.test/a.jpg')).toBe(false);
  });

  it('rechaza la red local y el bucle', () => {
    for (const url of [
      'http://localhost/a.jpg',
      'http://127.0.0.1/a.jpg',
      'http://10.0.0.5/a.jpg',
      'http://192.168.1.10/a.jpg',
      'http://172.16.4.4/a.jpg',
      'http://0.0.0.0/a.jpg',
      'http://nas.local/a.jpg',
      'http://algo.internal/a.jpg',
    ]) {
      expect(isAllowedRemoteImageUrl(url), url).toBe(false);
    }
  });

  it('rechaza los endpoints de metadatos de nube', () => {
    // 169.254.169.254 es el destino clásico de un SSRF: credenciales de la
    // instancia. En Workers no aplica, pero el patrón no se deja abierto.
    expect(isAllowedRemoteImageUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isAllowedRemoteImageUrl('http://metadata.google.internal/')).toBe(false);
  });

  it('rechaza IPv6 literal y puertos de servicios internos', () => {
    expect(isAllowedRemoteImageUrl('http://[::1]/a.jpg')).toBe(false);
    expect(isAllowedRemoteImageUrl('http://ejemplo.test:8080/a.jpg')).toBe(false);
    expect(isAllowedRemoteImageUrl('http://ejemplo.test:6379/a.jpg')).toBe(false);
  });

  it('rechaza basura', () => {
    expect(isAllowedRemoteImageUrl('')).toBe(false);
    expect(isAllowedRemoteImageUrl('no es una url')).toBe(false);
  });
});
