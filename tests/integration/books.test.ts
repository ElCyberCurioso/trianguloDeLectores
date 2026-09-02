import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  ORIGIN, BOOKS_ORIGIN, ADMIN_EMAIL, ADMIN_PASSWORD, loginAsBooks, booksHeaders,
  pdfBytes, pngBytes, resetAdminRateLimit, type AdminSession,
} from './helpers';

let books: AdminSession;

beforeAll(async () => {
  books = await loginAsBooks();
  await resetAdminRateLimit();
});

async function uploadPdf(title: string, marker = title): Promise<Response> {
  return SELF.fetch(`${BOOKS_ORIGIN}/api/documentos?title=${encodeURIComponent(title)}`, {
    method: 'POST',
    body: pdfBytes(marker),
    headers: booksHeaders(books, { 'Content-Type': 'application/pdf' }),
  });
}

describe('acceso al subdominio', () => {
  it('manda al login a quien no tiene sesión', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/`, {
      headers: { Accept: 'text/html' },
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toContain('/login');
  });

  it('protege también las rutas de API sin sesión', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos?title=x`, {
      method: 'POST',
      body: pdfBytes(),
      headers: { 'Content-Type': 'application/pdf', Origin: BOOKS_ORIGIN, 'Sec-Fetch-Site': 'same-origin' },
    });
    expect(response.status).toBe(401);
  });

  /**
   * La separación entre el panel y la biblioteca la impone el navegador: la
   * cookie lleva prefijo `__Host-`, que exige `Secure`, `Path=/` y **sin
   * `Domain`**, y eso la ata al host exacto. Aquí se comprueba lo que sí
   * depende del servidor: que la cookie sale con esos atributos y sin
   * `Domain`, que es lo que la hace host-only. El nombre con prefijo se
   * verifica en tests/unit/auth-cookie.test.ts, porque en desarrollo se sirve
   * por http y allí el prefijo no es válido.
   */
  it('la cookie de sesión no lleva Domain, así que no cruza de subdominio', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/login`, {
      method: 'POST',
      body: new URLSearchParams({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: BOOKS_ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        'CF-Connecting-IP': `192.0.2.${Math.floor(Math.random() * 250) + 1}`,
      },
      redirect: 'manual',
    });
    const setCookie = response.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie.toLowerCase()).not.toContain('domain=');
  });

  it('rechaza una escritura sin token CSRF', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos?title=sin-csrf`, {
      method: 'POST',
      body: pdfBytes('sin-csrf'),
      headers: {
        Cookie: books.cookie,
        Origin: BOOKS_ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/pdf',
      },
    });
    expect(response.status).toBe(403);
  });

  it('no se indexa y no se cachea', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/`, {
      headers: { Cookie: books.cookie, Accept: 'text/html' },
    });
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('la CSP permite WASM pero sigue sin unsafe-inline ni unsafe-eval', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/`, {
      headers: { Cookie: books.cookie, Accept: 'text/html' },
    });
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval';");
    expect(response.headers.get('Permissions-Policy')).toContain('camera=(self)');
  });

  it('el sitio público no abre la cámara', async () => {
    const response = await SELF.fetch(`${ORIGIN}/`, { headers: { Accept: 'text/html' } });
    expect(response.headers.get('Permissions-Policy')).toContain('camera=()');
  });
});

describe('documentos PDF', () => {
  it('sube un PDF y lo deja en la estantería', async () => {
    const response = await uploadPdf('Dune');
    expect(response.status).toBe(201);

    const payload = (await response.json()) as { data: { id: string; sizeBytes: number } };
    expect(payload.data.sizeBytes).toBeGreaterThan(0);

    const row = await env.DB.prepare('SELECT title, r2_key FROM documents WHERE id = ?')
      .bind(payload.data.id)
      .first<{ title: string; r2_key: string }>();
    expect(row!.title).toBe('Dune');
    expect(row!.r2_key.startsWith('books/pdf/')).toBe(true);
    expect(await env.MEDIA.get(row!.r2_key)).not.toBeNull();
  });

  it('rechaza lo que no es un PDF aunque lo declare como tal', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos?title=falso`, {
      method: 'POST',
      body: new TextEncoder().encode('<html>esto no es un PDF</html>'),
      headers: booksHeaders(books, { 'Content-Type': 'application/pdf' }),
    });
    expect(response.status).toBe(400);
  });

  it('no guarda dos veces el mismo fichero', async () => {
    await uploadPdf('Primera copia', 'identico');
    const repeated = await uploadPdf('Segunda copia', 'identico');
    expect(repeated.status).toBe(409);
  });

  it('sirve el PDF por rangos, que es lo que pide el visor', async () => {
    const created = await uploadPdf('Con rangos');
    const { data } = (await created.json()) as { data: { id: string } };

    const response = await SELF.fetch(`${BOOKS_ORIGIN}/documentos/${data.id}/fichero`, {
      headers: { Cookie: books.cookie, Range: 'bytes=0-9' },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toMatch(/^bytes 0-9\/\d+$/);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect((await response.arrayBuffer()).byteLength).toBe(10);
  });

  it('el PDF no sale por la ruta pública de medios', async () => {
    const created = await uploadPdf('Privado');
    const { data } = (await created.json()) as { data: { id: string } };
    const row = await env.DB.prepare('SELECT r2_key FROM documents WHERE id = ?')
      .bind(data.id)
      .first<{ r2_key: string }>();

    const response = await SELF.fetch(`${ORIGIN}/media/${row!.r2_key}`);
    expect(response.status).toBe(404);
  });

  it('borrar el documento se lleva el fichero de R2', async () => {
    const created = await uploadPdf('Para borrar');
    const { data } = (await created.json()) as { data: { id: string } };
    const row = await env.DB.prepare('SELECT r2_key FROM documents WHERE id = ?')
      .bind(data.id)
      .first<{ r2_key: string }>();

    const response = await SELF.fetch(`${BOOKS_ORIGIN}/documentos/${data.id}/eliminar`, {
      method: 'POST',
      body: new URLSearchParams({ _csrf: books.csrf }),
      headers: booksHeaders(books, { 'Content-Type': 'application/x-www-form-urlencoded' }),
      redirect: 'manual',
    });
    expect(response.status).toBe(303);
    expect(await env.MEDIA.get(row!.r2_key)).toBeNull();
  });
});

describe('portadas de los documentos', () => {
  let documentId: string;

  beforeAll(async () => {
    const created = await uploadPdf('Con portada');
    documentId = ((await created.json()) as { data: { id: string } }).data.id;
  });

  /** Es el camino de la portada por omisión: el visor pinta la primera página
      del PDF y manda la imagen en crudo. */
  it('guarda una imagen en crudo como portada', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos/${documentId}/portada`, {
      method: 'PUT',
      body: pngBytes(),
      headers: booksHeaders(books, { 'Content-Type': 'image/png' }),
    });
    expect(response.status).toBe(200);

    const payload = (await response.json()) as { data: { key: string; url: string } };
    expect(payload.data.key.startsWith('books/covers/')).toBe(true);
    expect(await env.MEDIA.get(payload.data.key)).not.toBeNull();

    const row = await env.DB.prepare('SELECT cover_key FROM documents WHERE id = ?')
      .bind(documentId)
      .first<{ cover_key: string }>();
    expect(row!.cover_key).toBe(payload.data.key);
  });

  it('sustituir la portada se lleva la anterior de R2', async () => {
    const first = await env.DB.prepare('SELECT cover_key FROM documents WHERE id = ?')
      .bind(documentId)
      .first<{ cover_key: string }>();

    await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos/${documentId}/portada`, {
      method: 'PUT',
      body: pngBytes(600, 900),
      headers: booksHeaders(books, { 'Content-Type': 'image/png' }),
    });

    expect(await env.MEDIA.get(first!.cover_key)).toBeNull();
  });

  it('rechaza lo que no es una imagen', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos/${documentId}/portada`, {
      method: 'PUT',
      body: new TextEncoder().encode('<html>no soy una imagen</html>'),
      headers: booksHeaders(books, { 'Content-Type': 'image/png' }),
    });
    expect(response.status).toBe(400);
  });

  /**
   * La URL nunca se guarda para pintarla luego: se descarga y se queda el
   * fichero. Aquí sólo se comprueba que las direcciones prohibidas ni se
   * intentan — el resto de la lógica de destino vive en
   * tests/unit/remote-image.test.ts.
   */
  it('no va a buscar una portada a una dirección interna', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos/${documentId}/portada`, {
      method: 'PUT',
      body: JSON.stringify({ url: 'http://192.168.1.10/portada.jpg' }),
      headers: booksHeaders(books, { 'Content-Type': 'application/json' }),
    });
    expect(response.status).toBe(400);
  });

  it('la portada sólo se sirve con sesión', async () => {
    const row = await env.DB.prepare('SELECT cover_key FROM documents WHERE id = ?')
      .bind(documentId)
      .first<{ cover_key: string }>();
    const path = `/portadas/${row!.cover_key.replace('books/covers/', '')}`;

    const conSesion = await SELF.fetch(`${BOOKS_ORIGIN}${path}`, { headers: { Cookie: books.cookie } });
    expect(conSesion.status).toBe(200);

    const sinSesion = await SELF.fetch(`${BOOKS_ORIGIN}${path}`, { redirect: 'manual' });
    expect(sinSesion.status).toBe(401);

    // Y desde luego no por la ruta pública de medios.
    const publica = await SELF.fetch(`${ORIGIN}/media/${row!.cover_key}`);
    expect(publica.status).toBe(404);
  });
});

describe('progreso y anotaciones', () => {
  let documentId: string;

  beforeAll(async () => {
    const created = await uploadPdf('Libro anotado');
    documentId = ((await created.json()) as { data: { id: string } }).data.id;
  });

  it('guarda por dónde va la lectura y lo sobrescribe', async () => {
    for (const page of [12, 34]) {
      const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos/${documentId}/progreso`, {
        method: 'PUT',
        body: JSON.stringify({ page, scrollPct: 250 }),
        headers: booksHeaders(books, { 'Content-Type': 'application/json' }),
      });
      expect(response.status).toBe(200);
    }

    const rows = await env.DB.prepare('SELECT page, scroll_pct FROM document_progress WHERE document_id = ?')
      .bind(documentId)
      .all<{ page: number; scroll_pct: number }>();
    // Una sola fila por documento: es un upsert, no un historial.
    expect(rows.results.length).toBe(1);
    expect(rows.results[0]!.page).toBe(34);
  });

  it('rechaza una posición imposible', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos/${documentId}/progreso`, {
      method: 'PUT',
      body: JSON.stringify({ page: 0, scrollPct: 5000 }),
      headers: booksHeaders(books, { 'Content-Type': 'application/json' }),
    });
    expect(response.status).toBe(400);
  });

  it('crea un subrayado con sus rectángulos y lo lista', async () => {
    const created = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos/${documentId}/anotaciones`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'HIGHLIGHT',
        page: 3,
        rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }],
        quote: 'El especiado debe fluir',
        color: 'GREEN',
      }),
      headers: booksHeaders(books, { 'Content-Type': 'application/json' }),
    });
    expect(created.status).toBe(201);

    const list = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos/${documentId}/anotaciones`, {
      headers: booksHeaders(books),
    });
    const payload = (await list.json()) as { data: { quote: string; rects: unknown[] }[] };
    expect(payload.data.some((a) => a.quote === 'El especiado debe fluir')).toBe(true);
    expect(payload.data[0]!.rects.length).toBeGreaterThan(0);
  });

  /**
   * Regresión: un subrayado sin nota mandaba `body: null`, y el esquema sólo
   * admitía `undefined`. Todo intento de resaltar terminaba en 400.
   */
  it('acepta un subrayado sin nota, con body a null', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos/${documentId}/anotaciones`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'HIGHLIGHT',
        page: 2,
        rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 }],
        quote: 'sin nota',
        body: null,
        color: 'YELLOW',
      }),
      headers: booksHeaders(books, { 'Content-Type': 'application/json' }),
    });
    expect(response.status).toBe(201);
  });

  /**
   * Regresión: los rectángulos salen de medir el DOM y traen error de
   * subpíxel. Un `-0.0004` al seleccionar desde el borde tumbaba la anotación
   * entera. Ahora se recortan al margen en vez de rechazarse.
   */
  it('recorta el error de subpíxel en vez de rechazar la anotación', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos/${documentId}/anotaciones`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'HIGHLIGHT',
        page: 4,
        rects: [{ x: -0.0004, y: 0.5, w: 0.3, h: 1.0002 }],
        quote: 'borde',
      }),
      headers: booksHeaders(books, { 'Content-Type': 'application/json' }),
    });
    expect(response.status).toBe(201);

    const payload = (await response.json()) as { data: { rects: { x: number; h: number }[] } };
    expect(payload.data.rects[0]!.x).toBe(0);
    expect(payload.data.rects[0]!.h).toBe(1);
  });

  it('un subrayado sin rectángulos no se guarda', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos/${documentId}/anotaciones`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'HIGHLIGHT', page: 1, rects: [], quote: 'nada' }),
      headers: booksHeaders(books, { 'Content-Type': 'application/json' }),
    });
    expect(response.status).toBe(400);
  });

  /**
   * El identificador del documento va en el WHERE además del de la anotación.
   * Sin eso, conocer el id de una anotación bastaría para borrar la de otro
   * documento.
   */
  it('no se puede borrar una anotación desde otro documento', async () => {
    const otro = await uploadPdf('Otro libro');
    const otroId = ((await otro.json()) as { data: { id: string } }).data.id;

    const created = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos/${documentId}/anotaciones`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'NOTE', page: 1, rects: [], body: 'mía' }),
      headers: booksHeaders(books, { 'Content-Type': 'application/json' }),
    });
    const { data } = (await created.json()) as { data: { id: string } };

    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos/${otroId}/anotaciones/${data.id}`, {
      method: 'DELETE',
      headers: booksHeaders(books),
    });
    expect(response.status).toBe(404);

    const still = await env.DB.prepare('SELECT id FROM document_annotations WHERE id = ?').bind(data.id).first();
    expect(still).not.toBeNull();
  });
});

describe('biblioteca física', () => {
  async function createBook(fields: Record<string, string>): Promise<Response> {
    return SELF.fetch(`${BOOKS_ORIGIN}/biblioteca`, {
      method: 'POST',
      body: new URLSearchParams({ _csrf: books.csrf, status: 'OWNED', ...fields }),
      headers: booksHeaders(books, { 'Content-Type': 'application/x-www-form-urlencoded' }),
      redirect: 'manual',
    });
  }

  it('da de alta un libro y normaliza su ISBN', async () => {
    const response = await createBook({
      title: 'El nombre de la rosa',
      authors: 'Umberto Eco',
      isbn13: '978-84-376-0494-7',
    });
    expect(response.status).toBe(303);

    const row = await env.DB.prepare('SELECT isbn13, isbn10, title FROM library_books WHERE title = ?')
      .bind('El nombre de la rosa')
      .first<{ isbn13: string; isbn10: string }>();
    // Se guarda sin guiones y con el ISBN-10 derivado.
    expect(row!.isbn13).toBe('9788437604947');
    expect(row!.isbn10).toHaveLength(10);
  });

  it('no admite dos veces el mismo ISBN', async () => {
    await createBook({ title: 'Duplicado A', isbn13: '9780306406157' });
    const repeated = await createBook({ title: 'Duplicado B', isbn13: '9780306406157' });
    expect(repeated.status).toBe(409);
  });

  it('rechaza un ISBN con dígito de control incorrecto', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/isbn`, {
      method: 'POST',
      body: JSON.stringify({ isbn: '9788437604948' }),
      headers: booksHeaders(books, { 'Content-Type': 'application/json' }),
    });
    expect(response.status).toBe(400);
  });

  it('un libro sin ISBN se guarda igual', async () => {
    const response = await createBook({ title: 'Cuaderno sin ISBN' });
    expect(response.status).toBe(303);
  });
});

describe('ordenación del catálogo', () => {
  beforeAll(async () => {
    const now = Date.now();
    // Se insertan por SQL para fijar `created_at` y que «recientes» sea
    // comprobable, cosa que por HTTP no se puede.
    await env.DB.batch(
      [
        ['Zapatos rojos', 'Zoe Zapata', 1990, 100, now - 3000],
        ['Árboles', 'Ana Álvarez', 2020, 900, now - 2000],
        ['Barcos', 'Miguel de Cervantes', null, null, now - 1000],
      ].map(([titulo, autores, anyo, paginas, creado]) =>
        env.DB.prepare(
          `INSERT INTO library_books (id, title, authors, published_year, page_count, status, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'OWNED', 'MANUAL', ?, ?)`,
        ).bind(crypto.randomUUID(), titulo, autores, anyo, paginas, creado, creado),
      ),
    );
  });

  async function ordenar(sort: string): Promise<string[]> {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/biblioteca?sort=${sort}`, {
      headers: { Cookie: books.cookie, Accept: 'text/html' },
    });
    const html = await response.text();
    return [...html.matchAll(/class="bookcard__title">([^<]+)</g)].map((m) => m[1]!);
  }

  it('por apellido, con las tildes en su sitio', async () => {
    const titulos = await ordenar('apellido');
    // Álvarez, de Cervantes (por la C) y Zapata.
    expect(titulos.indexOf('Árboles')).toBeLessThan(titulos.indexOf('Barcos'));
    expect(titulos.indexOf('Barcos')).toBeLessThan(titulos.indexOf('Zapatos rojos'));
  });

  it('por título', async () => {
    const titulos = await ordenar('titulo');
    expect(titulos.indexOf('Árboles')).toBeLessThan(titulos.indexOf('Barcos'));
    expect(titulos.indexOf('Barcos')).toBeLessThan(titulos.indexOf('Zapatos rojos'));
  });

  it('por año, dejando al final lo que no lo tiene', async () => {
    const titulos = await ordenar('anyo-desc');
    expect(titulos.indexOf('Árboles')).toBeLessThan(titulos.indexOf('Zapatos rojos'));
    expect(titulos.indexOf('Zapatos rojos')).toBeLessThan(titulos.indexOf('Barcos'));
  });

  it('por páginas', async () => {
    const titulos = await ordenar('paginas-desc');
    expect(titulos.indexOf('Árboles')).toBeLessThan(titulos.indexOf('Zapatos rojos'));
  });

  /** Un criterio inventado en la URL no puede romper la página ni elegir columna. */
  it('un criterio desconocido cae al de por omisión', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/biblioteca?sort=;DROP+TABLE`, {
      headers: { Cookie: books.cookie, Accept: 'text/html' },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Orden: Apellido del autor (A–Z)');
  });

  /**
   * Sin pedir orden, el catálogo sale como está la biblioteca en papel: por
   * apellido del autor.
   */
  it('sin criterio en la URL ordena por apellido', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/biblioteca`, {
      headers: { Cookie: books.cookie, Accept: 'text/html' },
    });
    const html = await response.text();
    expect(html).toContain('Orden: Apellido del autor (A–Z)');

    const titulos = [...html.matchAll(/class="bookcard__title">([^<]+)</g)].map((m) => m[1]!);
    // Álvarez, de Cervantes (por la C) y Zapata.
    expect(titulos.indexOf('Árboles')).toBeLessThan(titulos.indexOf('Barcos'));
    expect(titulos.indexOf('Barcos')).toBeLessThan(titulos.indexOf('Zapatos rojos'));
  });

  it('el criterio se conserva junto con la búsqueda', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/biblioteca?q=Barcos&sort=titulo`, {
      headers: { Cookie: books.cookie, Accept: 'text/html' },
    });
    const html = await response.text();
    expect(html).toContain('value="Barcos"');
    expect(html).toContain('Orden: Título (A–Z)');
  });
});

describe('importación desde MyLibrary', () => {
  async function importar(ficha: Record<string, unknown>): Promise<Response> {
    return SELF.fetch(`${BOOKS_ORIGIN}/api/biblioteca/importar`, {
      method: 'POST',
      body: JSON.stringify(ficha),
      headers: booksHeaders(books, { 'Content-Type': 'application/json' }),
    });
  }

  it('traduce una ficha completa del formato de origen', async () => {
    const response = await importar({
      sourceId: 501,
      title: 'Yo, robot',
      author: 'Isaac Asimov',
      additionalAuthors: ['Otro Autor'],
      isbn: '978-84-9800-408-3',
      pages: 300,
      publishedDate: 'c1950',
      publisher: 'Edhasa',
      summary: 'Relatos de robots',
      series: 'Robots',
      categories: ['Ciencia ficción'],
      comments: ['Prestado a nadie'],
      readingDates: 'verano de 2019',
      read: true,
      inWishlist: false,
    });
    expect(response.status).toBe(201);

    const row = await env.DB.prepare(
      'SELECT authors, isbn13, published_year, status, notes FROM library_books WHERE title = ?',
    )
      .bind('Yo, robot')
      .first<{ authors: string; isbn13: string; published_year: number; status: string; notes: string }>();

    expect(row!.authors).toBe('Isaac Asimov, Otro Autor');
    expect(row!.isbn13).toBe('9788498004083');
    // «c1950» es la forma en que estas exportaciones escriben «hacia 1950».
    expect(row!.published_year).toBe(1950);
    expect(row!.status).toBe('READ');
    expect(row!.notes).toContain('Serie: Robots');
    expect(row!.notes).toContain('Importado de MyLibrary (id 501)');
  });

  /** Es lo que permite volver a lanzar la importación sin duplicar el catálogo. */
  it('un ISBN que ya está da 409 en vez de duplicar', async () => {
    const ficha = { sourceId: 502, title: 'Repetido', isbn: '9788498003321' };
    expect((await importar(ficha)).status).toBe(201);
    expect((await importar({ ...ficha, sourceId: 503 })).status).toBe(409);
  });

  it('rechaza una ficha sin título', async () => {
    expect((await importar({ sourceId: 504, title: '   ' })).status).toBe(400);
  });

  it('guarda la portada que trae la importación', async () => {
    const created = await importar({ sourceId: 505, title: 'Con portada importada' });
    const { data } = (await created.json()) as { data: { id: string } };

    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/biblioteca/${data.id}/portada`, {
      method: 'PUT',
      body: pngBytes(),
      headers: booksHeaders(books, { 'Content-Type': 'image/png' }),
    });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare('SELECT cover_key FROM library_books WHERE id = ?')
      .bind(data.id)
      .first<{ cover_key: string }>();
    expect(row!.cover_key.startsWith('books/covers/')).toBe(true);
    expect(await env.MEDIA.get(row!.cover_key)).not.toBeNull();
  });

  it('no entra nadie sin sesión', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/biblioteca/importar`, {
      method: 'POST',
      body: JSON.stringify({ sourceId: 1, title: 'Colado' }),
      headers: { 'Content-Type': 'application/json', Origin: BOOKS_ORIGIN, 'Sec-Fetch-Site': 'same-origin' },
    });
    expect(response.status).toBe(401);
  });
});

describe('copia de seguridad', () => {
  it('genera un volcado comprimido y lo deja en R2', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/copias/ahora`, {
      method: 'POST',
      body: new URLSearchParams({ _csrf: books.csrf }),
      headers: booksHeaders(books, { 'Content-Type': 'application/x-www-form-urlencoded' }),
      redirect: 'manual',
    });
    expect(response.status).toBe(303);

    const day = new Date().toISOString().slice(0, 10);
    const object = await env.MEDIA.get(`backups/library/${day}.json.gz`);
    expect(object).not.toBeNull();

    // Se comprueba que el gzip es legible y que dentro está el catálogo.
    const json = await new Response(
      object!.body!.pipeThrough(new DecompressionStream('gzip')),
    ).json() as { libraryBooks: unknown[]; documentAnnotations: unknown[] };
    expect(Array.isArray(json.libraryBooks)).toBe(true);
    expect(json.libraryBooks.length).toBeGreaterThan(0);
  });

  it('sólo deja descargar copias con forma de fecha', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/copias/..%2F..%2Fsecreto`, {
      headers: { Cookie: books.cookie },
    });
    expect(response.status).toBe(404);
  });
});

describe('estáticos del subdominio', () => {
  /**
   * La hoja de estilos, la tipografía y pdf.js salen del mismo binding ASSETS
   * que en el sitio público, y sin sesión: son los mismos ficheros que ya sirve
   * el dominio principal. Sin esto, la propia página de acceso se pintaba sin
   * estilos y el visor no llegaba a cargar.
   */
  it('sirve los estáticos sin pedir sesión', async () => {
    for (const path of ['/assets/styles.css', '/assets/books.js']) {
      const response = await SELF.fetch(`${BOOKS_ORIGIN}${path}`);
      expect(response.status, path).toBe(200);
    }
  });

  it('pero una página sí pide sesión', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/biblioteca`, {
      headers: { Accept: 'text/html' },
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
  });
});

/**
 * Regresión.
 *
 * El login de la biblioteca no pinta el widget de Turnstile a propósito, para
 * no meter un tercero en su CSP. Pero `attemptLogin()` miraba el ajuste
 * `security.turnstile_login` —activado por omisión— y exigía un token que ese
 * formulario no puede generar: 401 en cada intento, con un mensaje que hablaba
 * de un recuadro que no existe.
 *
 * Aquí se fija la premisa —esta página no tiene widget—. Que de esa premisa se
 * siga no pedir el token lo comprueba `shouldCheckTurnstile()` en
 * tests/unit/turnstile-message.test.ts: el entorno de pruebas trae
 * `TURNSTILE_ENABLED` en `'false'`, así que por HTTP la comprobación se salta
 * entera y un test de integración no distinguiría el arreglo del fallo.
 */
describe('el login de la biblioteca y la comprobación anti-bot', () => {
  it('no pinta widget de Turnstile', async () => {
    const html = await (await SELF.fetch(`${BOOKS_ORIGIN}/login`, { headers: { Accept: 'text/html' } })).text();
    expect(html).not.toContain('cf-turnstile');
    expect(html).toContain('name="password"');
  });
});
