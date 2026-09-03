import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { ORIGIN } from './helpers';

/**
 * Descarga del APK desde el sitio público.
 *
 * Lo que se fija aquí es que la clave del objeto la manda el manifiesto **y se
 * vuelve a validar**: aunque el manifiesto lo escriba el script de publicación,
 * es un fichero de un bucket, y lo que decide qué se sirve no puede depender de
 * que nadie lo haya tocado.
 */

const MANIFIESTO = {
  version: '1.0.0',
  versionCode: 1,
  key: 'apps/android/tdl-1.0.0-1.apk',
  sizeBytes: 4,
  sha256: 'a'.repeat(64),
  publishedAt: '2026-09-02T10:00:00.000Z',
  minSdk: 26,
  notes: null,
};

async function publicar(manifiesto: unknown, apk: Uint8Array | null = new Uint8Array([0x50, 0x4b, 0x03, 0x04])) {
  await env.MEDIA.put('apps/android/latest.json', JSON.stringify(manifiesto));
  if (apk) await env.MEDIA.put(MANIFIESTO.key, apk);
}

describe('página de la aplicación', () => {
  it('se pinta sin descarga cuando todavía no hay versión publicada', async () => {
    await env.MEDIA.delete('apps/android/latest.json');
    const response = await SELF.fetch(`${ORIGIN}/aplicacion`, { headers: { Accept: 'text/html' } });
    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain('Todavía no hay ninguna versión publicada');
    expect(html).not.toContain('/aplicacion/descargar');
  });

  it('anuncia la versión y su suma de comprobación', async () => {
    await publicar(MANIFIESTO);
    const html = await (await SELF.fetch(`${ORIGIN}/aplicacion`, { headers: { Accept: 'text/html' } })).text();

    expect(html).toContain('Descargar la versión 1.0.0');
    expect(html).toContain(MANIFIESTO.sha256);
  });

  it('sirve el APK como descarga, no para abrirlo en el navegador', async () => {
    await publicar(MANIFIESTO);
    const response = await SELF.fetch(`${ORIGIN}/aplicacion/descargar`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/vnd.android.package-archive');
    expect(response.headers.get('Content-Disposition')).toContain('attachment');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('rechaza un manifiesto con una clave que no es de un APK nuestro', async () => {
    // Si un manifiesto manipulado pudiera elegir la clave, la ruta pública
    // serviría cualquier objeto del bucket: un PDF privado o una copia de
    // seguridad.
    await publicar({ ...MANIFIESTO, key: 'backups/library/2026-09-01.json.gz' }, null);
    const response = await SELF.fetch(`${ORIGIN}/aplicacion/descargar`);
    expect(response.status).toBe(404);
  });

  it('publica el manifiesto en JSON para que la aplicación busque actualización', async () => {
    await publicar(MANIFIESTO);
    const response = await SELF.fetch(`${ORIGIN}/aplicacion/version.json`, { headers: { Accept: 'application/json' } });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { versionCode: number; url: string; key?: string };
    expect(body.versionCode).toBe(1);
    expect(body.url).toContain('/aplicacion/descargar');
    // La clave de R2 es un detalle del servidor y no sale.
    expect(body.key).toBeUndefined();
  });

  it('la página está en el sitemap', async () => {
    const xml = await (await SELF.fetch(`${ORIGIN}/sitemap.xml`)).text();
    expect(xml).toContain('/aplicacion');
  });
});
