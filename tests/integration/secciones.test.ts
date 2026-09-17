import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { ORIGIN, loginAsAdmin, resetAdminRateLimit, createReview, CATEGORY_ID, GENRE_ID, type AdminSession } from './helpers';

let session: AdminSession;

beforeAll(async () => {
  session = await loginAsAdmin();
  await resetAdminRateLimit();
});

async function get(path: string): Promise<{ status: number; html: string }> {
  const response = await SELF.fetch(`${ORIGIN}${path}`, { headers: { Accept: 'text/html' } });
  return { status: response.status, html: await response.text() };
}

/** El `<link rel=canonical>` que sale en el HTML. */
function canonical(html: string): string | null {
  return /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? null;
}

function robots(html: string): string | null {
  return /<meta name="robots" content="([^"]+)"/.exec(html)?.[1] ?? null;
}

/** Los bloques JSON-LD de la página, ya parseados. */
function jsonLd(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]!.replace(/\\u003c/g, '<')) as Record<string, unknown>);
}

async function slugDeCategoria(): Promise<string> {
  const row = await env.DB.prepare('SELECT slug FROM categories WHERE id = ?').bind(CATEGORY_ID)
    .first<{ slug: string }>();
  return row!.slug;
}

async function slugDeGenero(): Promise<string> {
  const row = await env.DB.prepare('SELECT slug FROM genres WHERE id = ?').bind(GENRE_ID)
    .first<{ slug: string }>();
  return row!.slug;
}

describe('páginas propias de categoría y de género', () => {
  beforeAll(async () => {
    await createReview(session, { title: `Indexable ${crypto.randomUUID().slice(0, 8)}` });
  });

  it('la de categoría tiene su titular, su descripción y su canónica', async () => {
    const slug = await slugDeCategoria();
    const { status, html } = await get(`/categoria/${slug}`);

    expect(status).toBe(200);
    // Un único h1, y es el de la sección: no la marca.
    expect([...html.matchAll(/<h1[^>]*>/g)]).toHaveLength(1);
    expect(canonical(html)).toBe(`${ORIGIN}/categoria/${slug}`);
    expect(robots(html)).toContain('index');
  });

  it('la de género también, y lista lo suyo', async () => {
    const slug = await slugDeGenero();
    const { status, html } = await get(`/genero/${slug}`);

    expect(status).toBe(200);
    expect(canonical(html)).toBe(`${ORIGIN}/genero/${slug}`);
    expect([...html.matchAll(/<h1[^>]*>/g)]).toHaveLength(1);
  });

  it('una sección que no existe es un 404, no una página vacía', async () => {
    expect((await get('/genero/no-existe-este-genero')).status).toBe(404);
    expect((await get('/categoria/no-existe-esta-categoria')).status).toBe(404);
  });

  it('el filtro de la ruta manda sobre el de la query', async () => {
    const genero = await slugDeGenero();
    // Pedir otro género por la query no puede cambiar de qué va la página.
    const { html } = await get(`/genero/${genero}?genre=inventado`);
    expect(canonical(html)).toBe(`${ORIGIN}/genero/${genero}`);
  });

  it('refinar dentro de una sección no crea otra página que indexar', async () => {
    const genero = await slugDeGenero();
    const { html } = await get(`/genero/${genero}?sort=rating&page=2`);

    expect(canonical(html)).toBe(`${ORIGIN}/genero/${genero}`);
    expect(robots(html)).toContain('noindex');
  });

  it('publican su listado y su miga de pan en JSON-LD', async () => {
    const slug = await slugDeCategoria();
    const bloques = jsonLd((await get(`/categoria/${slug}`)).html);
    const tipos = bloques.map((b) => b['@type']);

    expect(tipos).toContain('ItemList');
    expect(tipos).toContain('BreadcrumbList');

    const miga = bloques.find((b) => b['@type'] === 'BreadcrumbList')!;
    const pasos = miga.itemListElement as { name: string; item: string }[];
    expect(pasos[pasos.length - 1]!.item).toBe(`${ORIGIN}/categoria/${slug}`);
  });

  it('los contadores cuentan de verdad', async () => {
    /*
     * La prueba que faltaba.
     *
     * El subselect correlado salía sin cualificar —`r.category_id = "id"`, que
     * dentro de `FROM reviews r` es `r.id`—, así que **todas las categorías y
     * todos los géneros contaban cero** desde siempre: en los filtros del
     * catálogo, en la portada y en el sitemap. No fallaba nada; simplemente el
     * número era cero. Con dos reseñas publicadas nadie lo mira.
     */
    const categoria = await slugDeCategoria();
    const { html } = await get('/');
    // El desplegable de filtros pinta «Nombre (N)»: si N vuelve a ser 0, esto
    // se cae aunque todo lo demás siga respondiendo 200.
    const opcion = new RegExp(`<option value="${categoria}"[^>]*>[^(]+\\((\\d+)\\)`).exec(html);
    expect(opcion, 'no se encontró la opción de categoría en los filtros').not.toBeNull();
    expect(Number(opcion![1])).toBeGreaterThan(0);
  });

  it('entran en el sitemap, y sólo si tienen algo dentro', async () => {
    const categoria = await slugDeCategoria();
    const xml = (await get('/sitemap.xml')).html;

    expect(xml).toContain(`${ORIGIN}/categoria/${categoria}`);
    // Un género recién creado y sin reseñas no se manda a indexar: sería pedir
    // que el buscador guarde un hueco.
    await env.DB.prepare('INSERT INTO genres (id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), 'genero-vacio', 'Género vacío', Date.now(), Date.now())
      .run();
    const xml2 = (await get('/sitemap.xml?nocache=1')).html;
    expect(xml2).not.toContain('/genero/genero-vacio');
  });
});

describe('el catálogo filtrado ya no compite consigo mismo', () => {
  it('la portada limpia canoniza a sí misma y se indexa', async () => {
    const { html } = await get('/');
    expect(canonical(html)).toBe(`${ORIGIN}/`);
    expect(robots(html)).toContain('index');
    expect(robots(html)).not.toContain('noindex');
  });

  it('filtrar sólo por género canoniza a la página de ese género', async () => {
    const genero = await slugDeGenero();
    const { html } = await get(`/?genre=${genero}`);
    // No es una página nueva: es otra forma de escribir `/genero/<slug>`.
    expect(canonical(html)).toBe(`${ORIGIN}/genero/${genero}`);
  });

  it('filtrar sólo por categoría canoniza a su página', async () => {
    const categoria = await slugDeCategoria();
    const { html } = await get(`/?category=${categoria}`);
    expect(canonical(html)).toBe(`${ORIGIN}/categoria/${categoria}`);
  });

  it('cualquier otra combinación canoniza a la portada y lleva noindex', async () => {
    const genero = await slugDeGenero();
    for (const query of ['?q=algo', '?type=MOVIE', '?sort=rating', '?page=2', `?genre=${genero}&sort=rating`]) {
      const { html } = await get(`/${query}`);
      expect(canonical(html), query).toBe(`${ORIGIN}/`);
      expect(robots(html), query).toContain('noindex');
    }
  });
});

describe('reseñas relacionadas', () => {
  it('propone las que comparten género y nunca la propia', async () => {
    const marca = crypto.randomUUID().slice(0, 8);
    const una = await createReview(session, { title: `Vecina A ${marca}` });
    await createReview(session, { title: `Vecina B ${marca}` });

    const { html } = await get(`/resena/${una.slug}`);
    expect(html).toContain('Si te ha gustado');
    expect(html).toContain(`Vecina B ${marca}`);

    // La propia no se recomienda a sí misma: su título sale en el titular, así
    // que lo que se mira es que no haya una tarjeta suya en las relacionadas.
    const seccion = /<section class="related"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(seccion).not.toContain(`Vecina A ${marca}`);
  });

  it('un borrador no se cuela entre las relacionadas', async () => {
    const marca = crypto.randomUUID().slice(0, 8);
    const publicada = await createReview(session, { title: `Publicada ${marca}` });
    await createReview(session, { title: `Borrador ${marca}`, status: 'DRAFT' });

    const seccion = /<section class="related"[\s\S]*?<\/section>/.exec((await get(`/resena/${publicada.slug}`)).html)?.[0] ?? '';
    expect(seccion).not.toContain(`Borrador ${marca}`);
  });

  it('el modal no las lleva: el catálogo está justo detrás', async () => {
    const una = await createReview(session, { title: `Modal ${crypto.randomUUID().slice(0, 8)}` });
    const { html } = await get(`/resena/${una.slug}?parcial=1`);
    expect(html).not.toContain('Si te ha gustado');
  });
});
