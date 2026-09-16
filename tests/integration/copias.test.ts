import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { ORIGIN, loginAsAdmin, resetAdminRateLimit, createReview, type AdminSession } from './helpers';

let session: AdminSession;

beforeAll(async () => {
  session = await loginAsAdmin();
  await resetAdminRateLimit();
});

/**
 * La copia del sitio público.
 *
 * El cron respaldaba sólo la biblioteca privada, que es justo lo contrario de lo
 * que importa: las reseñas y los comentarios no están en ningún otro sitio. Lo
 * que se comprueba aquí no es que la ruta responda, sino que **el contenido está
 * dentro** y que lo que no debe entrar no entra.
 */
async function hacerCopia(): Promise<Response> {
  const response = await SELF.fetch(`${ORIGIN}/admin/copias/ahora`, {
    method: 'POST',
    body: new URLSearchParams({ _csrf: session.csrf }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: session.cookie,
      Origin: ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
    },
    redirect: 'manual',
  });
  await response.text();
  return response;
}

/** El volcado del día, ya descomprimido. */
async function leerCopia(): Promise<Record<string, unknown[]>> {
  const key = `backups/public/${new Date().toISOString().slice(0, 10)}.json.gz`;
  const object = await env.MEDIA.get(key);
  expect(object, `no hay copia en ${key}`).not.toBeNull();

  const plano = new Response(object!.body!.pipeThrough(new DecompressionStream('gzip')));
  return JSON.parse(await plano.text());
}

describe('copia de seguridad del sitio público', () => {
  it('guarda las reseñas, los comentarios y la cola en un volcado comprimido', async () => {
    const { id } = await createReview(session, { title: `Copiable ${crypto.randomUUID().slice(0, 8)}` });

    const response = await hacerCopia();
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/admin/copias?ok=1');

    const copia = await leerCopia();
    expect((copia.reviews as { id: string }[]).some((r) => r.id === id)).toBe(true);
    // Las tablas que se olvidan son las que se pierden enteras: se comprueba que
    // cada una está presente, aunque venga vacía.
    for (const tabla of [
      'reviews', 'reviewGenres', 'reviewPlatforms', 'reviewEpisodes',
      'comments', 'commentReports', 'watchlistItems',
      'categories', 'genres', 'platforms', 'recommendations', 'mediaObjects',
    ]) {
      expect(Array.isArray(copia[tabla]), tabla).toBe(true);
    }
    expect(copia.settings).toBeTypeOf('object');
  });

  it('no se lleva las contraseñas ni el registro de auditoría', async () => {
    await hacerCopia();
    const copia = await leerCopia();

    expect(copia.users).toBeUndefined();
    expect(copia.sessions).toBeUndefined();
    expect(copia.auditLog).toBeUndefined();
    // Por si alguna vez se cuela dentro de otra tabla.
    expect(JSON.stringify(copia)).not.toContain('pbkdf2$');
  });

  it('la lista del panel la enseña y se puede descargar', async () => {
    await hacerCopia();
    const dia = new Date().toISOString().slice(0, 10);

    const listado = await SELF.fetch(`${ORIGIN}/admin/copias`, {
      headers: { Cookie: session.cookie, Accept: 'text/html' },
    });
    const html = await listado.text();
    expect(listado.status).toBe(200);
    expect(html).toContain(dia);

    const descarga = await SELF.fetch(`${ORIGIN}/admin/copias/${dia}`, {
      headers: { Cookie: session.cookie },
    });
    expect(descarga.status).toBe(200);
    expect(descarga.headers.get('Content-Type')).toBe('application/gzip');
    expect(descarga.headers.get('Content-Disposition')).toContain(`sitio-${dia}.json.gz`);
    await descarga.arrayBuffer();
  });

  it('el día de la URL no elige qué objeto del bucket se descarga', async () => {
    for (const intento of ['../library/2026-01-01', 'no-es-una-fecha', '2026-13-99']) {
      const response = await SELF.fetch(`${ORIGIN}/admin/copias/${encodeURIComponent(intento)}`, {
        headers: { Cookie: session.cookie },
      });
      await response.text();
      expect(response.status, intento).toBe(404);
    }
  });

  it('sin sesión no se ve nada', async () => {
    const listado = await SELF.fetch(`${ORIGIN}/admin/copias`, { headers: { Accept: 'text/html' }, redirect: 'manual' });
    await listado.text();
    expect([302, 401]).toContain(listado.status);
  });
});
