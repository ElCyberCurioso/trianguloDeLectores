import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';
import { ORIGIN, loginAsAdmin, createReview, type AdminSession } from './helpers';

let session: AdminSession;

beforeAll(async () => {
  session = await loginAsAdmin();
});

describe('cabeceras de seguridad', () => {
  it('sirve una CSP estricta, con nonce y sin unsafe-inline ni unsafe-eval', async () => {
    const response = await SELF.fetch(`${ORIGIN}/`, { headers: { Accept: 'text/html' } });
    const csp = response.headers.get('Content-Security-Policy') ?? '';

    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9_-]+'/);
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('el nonce de la CSP coincide con el de las etiquetas script', async () => {
    const response = await SELF.fetch(`${ORIGIN}/`, { headers: { Accept: 'text/html' } });
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    const nonce = /nonce-([A-Za-z0-9_-]+)/.exec(csp)?.[1];
    const html = await response.text();
    expect(nonce).toBeTruthy();
    expect(html).toContain(`nonce="${nonce}"`);
  });

  it('el nonce cambia en cada petición en las páginas no cacheadas', async () => {
    // El panel nunca se cachea: ahí el nonce es estrictamente por petición.
    const a = await SELF.fetch(`${ORIGIN}/admin/login`, { headers: { Accept: 'text/html' } });
    const b = await SELF.fetch(`${ORIGIN}/admin/login`, { headers: { Accept: 'text/html' } });
    expect(a.headers.get('Content-Security-Policy')).not.toBe(b.headers.get('Content-Security-Policy'));
  });

  it('en las páginas cacheadas el nonce de la cabecera sigue casando con el del cuerpo', async () => {
    // Cabecera y cuerpo se guardan juntos en la caché del borde: dentro de su
    // TTL comparten nonce, pero nunca divergen (si lo hicieran, el navegador
    // bloquearía nuestros propios scripts).
    for (let i = 0; i < 3; i++) {
      const response = await SELF.fetch(`${ORIGIN}/`, { headers: { Accept: 'text/html' } });
      const nonce = /nonce-([A-Za-z0-9_-]+)/.exec(response.headers.get('Content-Security-Policy') ?? '')?.[1];
      const html = await response.text();
      expect(nonce).toBeTruthy();
      expect(html).toContain(`nonce="${nonce}"`);
    }
  });

  it('el panel también lleva CSP estricta', async () => {
    const response = await SELF.fetch(`${ORIGIN}/admin/login`, { headers: { Accept: 'text/html' } });
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toMatch(/script-src 'nonce-/);
    expect(csp).not.toContain('unsafe-inline');
  });

  it('incluye el resto de cabeceras obligatorias', async () => {
    const response = await SELF.fetch(`${ORIGIN}/`, { headers: { Accept: 'text/html' } });
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('Permissions-Policy')).toContain('geolocation=()');
    expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });

  it('no filtra la pila tecnológica', async () => {
    const response = await SELF.fetch(`${ORIGIN}/`, { headers: { Accept: 'text/html' } });
    expect(response.headers.get('X-Powered-By')).toBeNull();
  });
});

describe('control de acceso', () => {
  it('redirige al login sin sesión', async () => {
    const response = await SELF.fetch(`${ORIGIN}/admin`, {
      headers: { Accept: 'text/html' },
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toContain('/admin/login');
  });

  it('devuelve 401 en API de admin sin sesión', async () => {
    const response = await SELF.fetch(`${ORIGIN}/admin/api/stats/pendientes`, {
      headers: { Accept: 'application/json' },
    });
    expect(response.status).toBe(401);
  });

  it('una cookie de sesión inventada no da acceso', async () => {
    const response = await SELF.fetch(`${ORIGIN}/admin`, {
      headers: { Accept: 'text/html', Cookie: 'tdl_session=token-falso-pero-largo-1234567890' },
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
  });

  it('no se puede escalar privilegios con cabeceras del cliente', async () => {
    const response = await SELF.fetch(`${ORIGIN}/admin`, {
      headers: {
        Accept: 'text/html',
        'X-User-Role': 'ADMIN',
        'X-Is-Admin': 'true',
        Authorization: 'Bearer admin',
      },
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
  });
});

describe('caché', () => {
  it('el panel nunca se cachea ni se indexa', async () => {
    const response = await SELF.fetch(`${ORIGIN}/admin`, {
      headers: { Cookie: session.cookie, Accept: 'text/html' },
    });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
  });

  it('el catálogo público sí es cacheable', async () => {
    const response = await SELF.fetch(`${ORIGIN}/`, { headers: { Accept: 'text/html' } });
    expect(response.headers.get('Cache-Control')).toContain('s-maxage');
  });

  it('una petición autenticada no se cachea aunque sea GET público', async () => {
    const response = await SELF.fetch(`${ORIGIN}/`, {
      headers: { Accept: 'text/html', Cookie: session.cookie },
    });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
});

describe('SEO', () => {
  it('robots.txt bloquea el panel', async () => {
    const response = await SELF.fetch(`${ORIGIN}/robots.txt`);
    const body = await response.text();
    expect(body).toContain('Disallow: /');
  });

  it('el sitemap incluye las reseñas publicadas', async () => {
    const review = await createReview(session, { title: 'Reseña para sitemap' });
    const response = await SELF.fetch(`${ORIGIN}/sitemap.xml`);
    const xml = await response.text();
    expect(response.headers.get('Content-Type')).toContain('xml');
    expect(xml).toContain(`/resena/${review.slug}`);
  });

  it('la página de reseña lleva canonical, Open Graph y JSON-LD', async () => {
    const review = await createReview(session, { title: 'Reseña con SEO' });
    const response = await SELF.fetch(`${ORIGIN}/resena/${review.slug}`, { headers: { Accept: 'text/html' } });
    const html = await response.text();
    expect(html).toContain('<link rel="canonical"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('name="twitter:card"');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('"@type":"Review"');
  });
});

describe('errores', () => {
  it('404 para una reseña inexistente', async () => {
    const response = await SELF.fetch(`${ORIGIN}/resena/no-existe-esta-resena`, {
      headers: { Accept: 'text/html' },
    });
    expect(response.status).toBe(404);
  });

  it('el error no filtra detalles internos', async () => {
    const response = await SELF.fetch(`${ORIGIN}/resena/no-existe`, { headers: { Accept: 'application/json' } });
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).not.toContain('D1');
    expect(body.error.message).not.toContain('SQL');
  });
});

describe('identidad de la petición', () => {
  it('no deja elegir la propia identidad con X-Real-IP', async () => {
    // `X-Real-IP` la manda el cliente, así que rotarla no debe conceder un cupo
    // nuevo: la identidad sale de `CF-Connecting-IP`, que pone el borde.
    const { slug } = await createReview(session, { title: 'Identidad falsificada' });
    const estados: number[] = [];

    for (let i = 0; i < 8; i++) {
      const response = await SELF.fetch(`${ORIGIN}/api/resenas/${slug}/comentarios`, {
        method: 'POST',
        body: new URLSearchParams({ alias: `Alguien ${i}`, body: 'Comentario de prueba del límite.' }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: ORIGIN,
          'Sec-Fetch-Site': 'same-origin',
          // Cambia en cada intento; no debería servir de nada.
          'X-Real-IP': `10.1.2.${i + 1}`,
        },
        redirect: 'manual',
      });
      await response.text();
      estados.push(response.status);
    }

    expect(estados).toContain(429);
  });
});

describe('tamaño de la petición', () => {
  it('rechaza un formulario público desmesurado antes de parsearlo', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/recomendaciones`, {
      method: 'POST',
      body: new URLSearchParams({ titleEs: 'Enorme', contentType: 'BOOK', note: 'x'.repeat(70 * 1024) }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        'CF-Connecting-IP': '203.0.113.200',
      },
      redirect: 'manual',
    });
    await response.text();
    expect(response.status).toBe(400);
  });
});
