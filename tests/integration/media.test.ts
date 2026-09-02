import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { ORIGIN, loginAsAdmin, resetAdminRateLimit, type AdminSession } from './helpers';

let session: AdminSession;

beforeAll(async () => {
  session = await loginAsAdmin();
  await resetAdminRateLimit();
});

function pngFile(name = 'portada.png', width = 800, height = 1200): File {
  const bytes = new Uint8Array(512);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new File([bytes], name, { type: 'image/png' });
}

async function upload(file: File): Promise<Response> {
  const body = new FormData();
  body.append('file', file);
  body.append('_csrf', session.csrf);
  return SELF.fetch(`${ORIGIN}/admin/api/media/portada`, {
    method: 'POST',
    body,
    headers: {
      Cookie: session.cookie,
      Origin: ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
      Accept: 'application/json',
      'X-CSRF-Token': session.csrf,
    },
  });
}

describe('subida de portadas a R2', () => {
  it('sube una imagen válida y la registra', async () => {
    const response = await upload(pngFile());
    expect(response.status).toBe(201);

    const payload = (await response.json()) as { data: { key: string; mime: string; width: number; url: string } };
    expect(payload.data.mime).toBe('image/png');
    // La vista previa del panel se pinta con esta URL. Un `blob:` lo bloquearía
    // la CSP (`img-src 'self' data:` más el dominio de medios).
    expect(payload.data.url).toBeTruthy();
    expect(payload.data.url.startsWith('blob:')).toBe(false);
    expect(payload.data.width).toBe(800);
    expect(payload.data.key).toMatch(/^reviews\/covers\/\d{4}\/[0-9a-f]{2}\/[0-9a-f-]{36}\.png$/);

    const object = await env.MEDIA.get(payload.data.key);
    expect(object).not.toBeNull();

    const row = await env.DB.prepare('SELECT mime, size_bytes FROM media_objects WHERE key = ?')
      .bind(payload.data.key)
      .first<{ mime: string; size_bytes: number }>();
    expect(row!.mime).toBe('image/png');
  });

  it('ignora el nombre de fichero enviado por el cliente', async () => {
    const response = await upload(pngFile('../../../etc/passwd.png'));
    const payload = (await response.json()) as { data: { key: string } };
    expect(payload.data.key).not.toContain('passwd');
    expect(payload.data.key).not.toContain('..');
  });

  it('rechaza contenido que no es imagen aunque el Content-Type mienta', async () => {
    const fake = new File(['<?php system($_GET["c"]); ?>                    '], 'shell.png', { type: 'image/png' });
    const response = await upload(fake);
    expect(response.status).toBe(400);

    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe('invalid_image');
  });

  it('rechaza SVG (vector clásico de XSS)', async () => {
    const svg = new File(
      ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><text>x</text></svg>'],
      'imagen.svg',
      { type: 'image/svg+xml' },
    );
    expect((await upload(svg)).status).toBe(400);
  });

  it('rechaza ficheros que superan el límite de tamaño', async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const response = await upload(new File([big], 'grande.png', { type: 'image/png' }));
    expect([400, 413]).toContain(response.status);
  });

  it('rechaza dimensiones absurdas', async () => {
    const response = await upload(pngFile('bomba.png', 15000, 15000));
    expect(response.status).toBe(400);
  });

  it('exige sesión de administrador', async () => {
    const body = new FormData();
    body.append('file', pngFile());
    const response = await SELF.fetch(`${ORIGIN}/admin/api/media/portada`, {
      method: 'POST',
      body,
      headers: { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', Accept: 'application/json' },
    });
    expect(response.status).toBe(401);
  });

  it('exige token CSRF', async () => {
    const body = new FormData();
    body.append('file', pngFile());
    const response = await SELF.fetch(`${ORIGIN}/admin/api/media/portada`, {
      method: 'POST',
      body,
      headers: {
        Cookie: session.cookie,
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        Accept: 'application/json',
      },
    });
    expect(response.status).toBe(403);
  });
});

describe('servir imágenes', () => {
  it('sirve el objeto con cabeceras seguras y cacheables', async () => {
    const uploaded = (await (await upload(pngFile())).json()) as { data: { key: string } };
    const response = await SELF.fetch(`${ORIGIN}/media/${uploaded.data.key}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toContain('immutable');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });

  it('devuelve 404 ante intentos de path traversal', async () => {
    for (const key of ['../../etc/passwd', 'reviews/covers/../../secreto.png', 'cualquier/cosa.png']) {
      const response = await SELF.fetch(`${ORIGIN}/media/${key}`);
      expect(response.status, key).toBe(404);
    }
  });

  it('devuelve 404 para una clave con formato válido pero inexistente', async () => {
    const response = await SELF.fetch(
      `${ORIGIN}/media/reviews/covers/2026/ab/00000000-0000-4000-8000-000000000000.png`,
    );
    expect(response.status).toBe(404);
  });
});

describe('borrado de portadas', () => {
  it('borra el objeto de R2 y su registro', async () => {
    const uploaded = (await (await upload(pngFile())).json()) as { data: { key: string } };

    const response = await SELF.fetch(
      `${ORIGIN}/admin/api/media/portada?key=${encodeURIComponent(uploaded.data.key)}`,
      {
        method: 'DELETE',
        headers: {
          Cookie: session.cookie,
          Origin: ORIGIN,
          'Sec-Fetch-Site': 'same-origin',
          Accept: 'application/json',
          'X-CSRF-Token': session.csrf,
        },
      },
    );
    expect(response.status).toBe(200);
    expect(await env.MEDIA.get(uploaded.data.key)).toBeNull();
  });

  it('rechaza claves que no genera el servidor', async () => {
    const response = await SELF.fetch(`${ORIGIN}/admin/api/media/portada?key=${encodeURIComponent('../../secreto')}`, {
      method: 'DELETE',
      headers: {
        Cookie: session.cookie,
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        Accept: 'application/json',
        'X-CSRF-Token': session.csrf,
      },
    });
    expect(response.status).toBe(400);
  });
});

describe('rate limiting', () => {
  it('bloquea tras superar el límite de comentarios por IP', async () => {
    const ip = '198.51.100.77';
    const responses: number[] = [];

    for (let i = 0; i < 8; i++) {
      const response = await SELF.fetch(`${ORIGIN}/api/resenas/inexistente/comentarios`, {
        method: 'POST',
        body: new URLSearchParams({ alias: 'Bot', body: 'spam spam spam' }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          Origin: ORIGIN,
          'Sec-Fetch-Site': 'same-origin',
          'CF-Connecting-IP': ip,
        },
      });
      responses.push(response.status);
    }

    expect(responses).toContain(429);
  });

  it('la respuesta 429 incluye Retry-After', async () => {
    const ip = '198.51.100.88';
    let last: Response | null = null;
    for (let i = 0; i < 8; i++) {
      last = await SELF.fetch(`${ORIGIN}/api/resenas/inexistente/comentarios`, {
        method: 'POST',
        body: new URLSearchParams({ alias: 'Bot', body: 'spam spam spam' }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          Origin: ORIGIN,
          'Sec-Fetch-Site': 'same-origin',
          'CF-Connecting-IP': ip,
        },
      });
      if (last.status === 429) break;
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get('Retry-After')).toBeTruthy();
  });
});
