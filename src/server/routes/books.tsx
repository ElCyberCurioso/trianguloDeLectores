import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../../types/env';
import { BooksLayout } from '../views/books/layout';
import { LoginPage } from '../views/admin/login';
import { ShelfPage } from '../views/books/shelf';
import { ReaderPage } from '../views/books/reader';
import { LibraryPage, BookEditorPage } from '../views/books/library';
import { BackupsPage } from '../views/books/backups';
import { requireAdminAt, requireCsrf } from '../middleware/auth';
import { rateLimit } from '../middleware/ratelimit';
import { attemptLogin } from '../lib/login';
import { clearSessionCookie, revokeSession } from '../lib/auth';
import { badRequest, notFound, ok, tooLarge } from '../lib/http';
import { DocumentService } from '../services/documents';
import { LibraryService } from '../services/library';
import { runLibraryBackup, listBackups, isBackupKey } from '../services/backup';
import { bookCoverKeyFromPath, MAX_PDF_BYTES } from '../lib/books';
import { parseIsbn } from '../lib/isbn';
import { mapMyLibraryBook } from '../lib/mylibrary';
import { sortLibrary, LIBRARY_SORT_DEFAULT } from '../lib/library-sort';
import {
  documentMetaSchema, documentPatchSchema, readingProgressSchema,
  annotationCreateSchema, annotationPatchSchema, isbnSchema,
  libraryBookSchema, librarySearchSchema, idSchema, coverUrlSchema, myLibraryBookSchema,
} from '../../validation/schemas';
import * as F from '../lib/form';
import type { LibraryStatus } from '../../db/repos/library';

/**
 * Subdominio privado `books.`.
 *
 * Es una aplicación aparte montada en el mismo Worker, no un trozo del sitio
 * público: cabeceras propias (`booksSecurityHeaders`), navegación propia y una
 * sesión que **no** se comparte con el panel. La cookie lleva el prefijo
 * `__Host-`, que la ata al host exacto, así que entrar aquí no da acceso a
 * /admin ni al revés. Eso es deliberado.
 *
 * Todas las rutas salvo el login exigen ADMIN, y el rol se lee de la sesión en
 * base de datos.
 */
export const booksRoutes = new Hono<AppEnv>();

/**
 * Puerta de entrada.
 *
 * El guardián va **antes** que las rutas y con lista de exenciones explícita,
 * no después: así una ruta nueva nace protegida y hay que acordarse de abrirla,
 * en vez de nacer abierta y haber que acordarse de cerrarla. Sólo el login y su
 * robots.txt quedan fuera.
 */
const PUBLIC_PATHS = new Set(['/login', '/robots.txt', '/favicon.ico', '/apple-touch-icon.png']);

/**
 * Los estáticos quedan fuera del guardián. Son exactamente los mismos ficheros
 * que ya sirve el sitio público —hoja de estilos, tipografía, pdf.js—, así que
 * pedir sesión para ellos no protegería nada y dejaría la propia página de
 * acceso sin estilos.
 */
function isStatic(path: string): boolean {
  return path.startsWith('/assets/');
}

/** La página de acceso de este subdominio, no la del panel. */
const requireBooksAdmin = requireAdminAt('/login');

booksRoutes.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (PUBLIC_PATHS.has(path) || isStatic(path)) return next();
  return requireBooksAdmin(c, next);
});

booksRoutes.use('*', async (c, next) => {
  // El POST de login no puede llevar token de sesión porque todavía no hay
  // sesión. Lo protegen el límite de intentos, el bloqueo de cuenta y
  // `SameSite=Strict` en la cookie que se acaba de emitir.
  const path = new URL(c.req.url).pathname;
  if (PUBLIC_PATHS.has(path) || isStatic(path)) return next();
  return requireCsrf(c, next);
});

// ================================================================ LOGIN =====
booksRoutes.get('/login', (c) => {
  if (c.get('user')?.role === 'ADMIN') return c.redirect('/', 302);
  return renderLogin(c, c.req.query('error') === '1' ? 'Credenciales incorrectas.' : null, 200);
});

booksRoutes.post('/login', rateLimit('login'), async (c) => {
  const body = await c.req.parseBody({ all: true });
  const outcome = await attemptLogin(c, body, {
    // Este formulario no pinta el widget de Turnstile —ver `renderLogin`—, así
    // que tampoco puede exigir su token: hacerlo devolvía 401 siempre.
    requireTurnstile: false,
    // Sin cerrar las demás sesiones: el panel y la biblioteca son aplicaciones
    // distintas de la misma persona y se usan a la vez.
    revokeOtherSessions: false,
  });
  if (!outcome.ok) return renderLogin(c, outcome.message, 401);

  // Sólo se acepta un destino interno y de una barra: `//otro.sitio` es una URL
  // absoluta disfrazada y sería un open redirect.
  const next = F.str(body, 'next', 300);
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return c.redirect(target, 303);
});

booksRoutes.post('/logout', requireCsrf, async (c) => {
  const sessionId = c.get('sessionId');
  const user = c.get('user')!;
  if (sessionId) await revokeSession(c.env, sessionId);
  clearSessionCookie(c);
  await c.get('container').audit.record({ actorId: user.id, actorRole: user.role, action: 'auth.logout' });
  return c.redirect('/login', 303);
});

function renderLogin(c: Context<AppEnv>, error: string | null, status: 200 | 401) {
  c.status(status);
  return c.html(
    <BooksLayout nonce={c.get('nonce')} title="Acceso" bodyClass="body--login">
      {/* Sin Turnstile: es un subdominio privado de una sola cuenta, y meterlo
          obligaría a abrir la CSP a un tercero. El freno son el límite de
          intentos por IP, el límite global y el bloqueo de la cuenta. */}
      <LoginPage
        siteName="Biblioteca"
        subtitle="Acceso a la biblioteca privada"
        action="/login"
        turnstileSiteKey={null}
        next={c.req.query('next')}
        error={error}
      />
    </BooksLayout>,
  );
}

function shell(
  c: Context<AppEnv>,
  title: string,
  node: unknown,
  opts: { wide?: boolean; scripts?: string[]; bodyClass?: string } = {},
) {
  return c.html(
    <BooksLayout
      nonce={c.get('nonce')}
      title={title}
      path={new URL(c.req.url).pathname}
      csrfToken={c.get('csrfToken')}
      user={c.get('user')}
      scripts={opts.scripts ?? ['/assets/books.js']}
      wide={opts.wide}
      bodyClass={opts.bodyClass ?? ''}
    >
      {node as never}
    </BooksLayout>,
  );
}

// =========================================================== ESTANTERÍA =====
booksRoutes.get('/', async (c) => {
  const documents = await c.get('container').documents.list();
  return shell(c, 'Estantería', <ShelfPage documents={documents} csrfToken={c.get('csrfToken')} />);
});

/**
 * Subida de un PDF.
 *
 * El cuerpo es el fichero en crudo, no un formulario multipart: `parseBody()`
 * lo tendría entero en memoria y son hasta 50 MB. Así va en streaming hacia R2.
 * El título y el autor viajan en la query, que es texto corto.
 */
booksRoutes.post('/api/documentos', rateLimit('upload', { identity: (c) => c.get('user')?.id ?? null }), async (c) => {
  const meta = documentMetaSchema.safeParse({
    title: c.req.query('title') ?? '',
    author: c.req.query('author') ?? '',
  });
  if (!meta.success) throw badRequest('invalid_meta', 'Falta el título del documento');

  const declared = Number(c.req.header('Content-Length') ?? '0');
  if (declared > MAX_PDF_BYTES) throw tooLarge(`El PDF supera los ${MAX_PDF_BYTES / 1024 / 1024} MB`);

  const body = c.req.raw.body;
  if (!body) throw badRequest('missing_file', 'No se ha recibido ningún archivo');

  const service = new DocumentService(c.get('container'));
  const result = await service.upload(body, declared, meta.data.title, meta.data.author ?? null, c.get('user')!);
  return ok(c, result, 201);
});

booksRoutes.post('/documentos/:id/eliminar', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('El documento no existe');
  await new DocumentService(c.get('container')).delete(id.data, c.get('user')!);
  return c.redirect('/', 303);
});

// =============================================================== LECTOR =====
booksRoutes.get('/documentos/:id', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('El documento no existe');

  const container = c.get('container');
  const document = await container.documents.get(id.data);
  if (!document) throw notFound('El documento no existe');

  const annotations = await container.documents.listAnnotations(document.id);
  return shell(
    c,
    document.title,
    <ReaderPage document={document} annotations={annotations} csrfToken={c.get('csrfToken')} />,
    // El lector ocupa la ventana entera y no debe desplazarse el documento
    // completo: el que se mueve es el panel de páginas.
    { wide: true, bodyClass: 'body--reader' },
  );
});

/** El PDF en sí. Con soporte de `Range`, que es lo que pdf.js necesita. */
booksRoutes.get('/documentos/:id/fichero', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('El documento no existe');

  const document = await c.get('container').documents.get(id.data);
  if (!document) throw notFound('El documento no existe');

  return new DocumentService(c.get('container')).serve(document.r2Key, c.req.raw);
});

booksRoutes.patch('/api/documentos/:id', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('El documento no existe');

  const parsed = documentPatchSchema.safeParse(await c.req.json());
  if (!parsed.success) throw badRequest('invalid_input', 'Datos no válidos');

  await c.get('container').documents.update(id.data, {
    title: parsed.data.title,
    author: parsed.data.author ?? null,
    notes: parsed.data.notes ?? null,
  });
  return ok(c, { updated: true });
});

/**
 * Número de páginas, que lo cuenta el visor al abrir el PDF por primera vez.
 * En el Worker no hay forma de saberlo sin traerse una librería de PDF entera.
 */
booksRoutes.put('/api/documentos/:id/paginas', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('El documento no existe');

  const payload = (await c.req.json()) as { pageCount?: unknown };
  const pageCount = Number(payload.pageCount);
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 100_000) {
    throw badRequest('invalid_page_count', 'Número de páginas no válido');
  }
  await c.get('container').documents.setPageCount(id.data, pageCount);
  return ok(c, { pageCount });
});

// ============================================================ PROGRESO =====
booksRoutes.put('/api/documentos/:id/progreso', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('El documento no existe');

  const parsed = readingProgressSchema.safeParse(await c.req.json());
  if (!parsed.success) throw badRequest('invalid_progress', 'Posición no válida');

  await c.get('container').documents.saveProgress(id.data, parsed.data.page, parsed.data.scrollPct);
  return ok(c, { saved: true });
});

// ========================================================= ANOTACIONES =====
booksRoutes.get('/api/documentos/:id/anotaciones', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('El documento no existe');
  return ok(c, await c.get('container').documents.listAnnotations(id.data));
});

booksRoutes.post('/api/documentos/:id/anotaciones', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('El documento no existe');

  const container = c.get('container');
  const document = await container.documents.get(id.data);
  if (!document) throw notFound('El documento no existe');

  const parsed = annotationCreateSchema.safeParse(await c.req.json());
  if (!parsed.success) throw badRequest('invalid_annotation', 'Anotación no válida');
  if (parsed.data.kind === 'HIGHLIGHT' && parsed.data.rects.length === 0) {
    throw badRequest('invalid_annotation', 'Un subrayado necesita al menos un rectángulo');
  }

  const annotation = await container.documents.createAnnotation({
    id: crypto.randomUUID(),
    documentId: document.id,
    kind: parsed.data.kind,
    page: parsed.data.page,
    rects: parsed.data.rects.length ? parsed.data.rects : null,
    quote: parsed.data.quote ?? null,
    body: parsed.data.body ?? null,
    color: parsed.data.color,
  });
  return ok(c, annotation, 201);
});

booksRoutes.patch('/api/documentos/:docId/anotaciones/:id', async (c) => {
  const docId = idSchema.safeParse(c.req.param('docId'));
  const id = idSchema.safeParse(c.req.param('id'));
  if (!docId.success || !id.success) throw notFound('La anotación no existe');

  const parsed = annotationPatchSchema.safeParse(await c.req.json());
  if (!parsed.success) throw badRequest('invalid_annotation', 'Anotación no válida');

  const changed = await c.get('container').documents.updateAnnotation(docId.data, id.data, {
    body: parsed.data.body ?? null,
    color: parsed.data.color,
  });
  if (!changed) throw notFound('La anotación no existe');
  return ok(c, { updated: true });
});

booksRoutes.delete('/api/documentos/:docId/anotaciones/:id', async (c) => {
  const docId = idSchema.safeParse(c.req.param('docId'));
  const id = idSchema.safeParse(c.req.param('id'));
  if (!docId.success || !id.success) throw notFound('La anotación no existe');

  const deleted = await c.get('container').documents.deleteAnnotation(docId.data, id.data);
  if (!deleted) throw notFound('La anotación no existe');
  return ok(c, { deleted: true });
});

/**
 * Portada de un documento.
 *
 * Tres orígenes, un solo camino: la primera página que ha pintado el visor
 * (llega como imagen en crudo), un fichero elegido a mano (igual) o una
 * dirección de otro sitio (`{ "url": … }`, que descarga el servidor). En los
 * tres casos acaba validada y guardada en R2 — nunca se guarda la URL ajena.
 */
booksRoutes.put(
  '/api/documentos/:id/portada',
  rateLimit('upload', { identity: (c) => c.get('user')?.id ?? null }),
  async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) throw notFound('El documento no existe');

    const service = new DocumentService(c.get('container'));
    const contentType = c.req.header('Content-Type') ?? '';

    if (contentType.includes('application/json')) {
      const parsed = coverUrlSchema.safeParse(await c.req.json());
      if (!parsed.success) throw badRequest('invalid_url', 'La dirección de la imagen no es válida');
      const key = await service.setCoverFromUrl(id.data, parsed.data.url, c.get('user')!);
      return ok(c, { key, url: `/portadas/${key.replace('books/covers/', '')}` });
    }

    // Imagen en crudo. Se lee entera porque una portada son unos pocos cientos
    // de kilobytes, no los 50 MB de un PDF.
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length) throw badRequest('missing_file', 'No se ha recibido ninguna imagen');
    const key = await service.setCover(id.data, bytes, c.get('user')!);
    return ok(c, { key, url: `/portadas/${key.replace('books/covers/', '')}` });
  },
);

// ========================================================== BIBLIOTECA =====
booksRoutes.get('/biblioteca', async (c) => {
  const parsed = librarySearchSchema.safeParse({
    q: c.req.query('q') ?? '',
    status: c.req.query('status') ?? 'ALL',
    sort: c.req.query('sort') ?? LIBRARY_SORT_DEFAULT,
  });
  const query = parsed.success
    ? parsed.data
    : { q: undefined, status: 'ALL' as const, sort: LIBRARY_SORT_DEFAULT };

  const container = c.get('container');
  const [books, counters] = await Promise.all([
    container.library.list({ q: query.q, status: query.status }),
    container.library.counters(),
  ]);

  return shell(
    c,
    'Biblioteca',
    <LibraryPage
      books={sortLibrary(books, query.sort)}
      counters={counters}
      query={{ q: query.q, status: query.status, sort: query.sort }}
      csrfToken={c.get('csrfToken')}
    />,
  );
});

booksRoutes.get('/biblioteca/nuevo', (c) =>
  shell(
    c,
    'Añadir libro',
    <BookEditorPage book={null} csrfToken={c.get('csrfToken')} scanOnLoad={c.req.query('escanear') === '1'} />,
  ),
);

/** Consulta a Open Library. La hace el servidor, nunca el navegador. */
booksRoutes.post('/api/isbn', rateLimit('publicApi'), async (c) => {
  const parsed = isbnSchema.safeParse(await c.req.json());
  if (!parsed.success) throw badRequest('invalid_isbn', 'Ese número no es un ISBN válido');

  const result = await new LibraryService(c.get('container')).lookup(parsed.data.isbn);
  return ok(c, {
    draft: result.draft,
    existing: result.existing ? { id: result.existing.id, title: result.existing.title } : null,
  });
});

/**
 * Guarda una imagen de portada y devuelve su clave. La usan tanto los libros en
 * papel como los PDF: lo que hace es siempre lo mismo —validar por magic bytes
 * y dejarla en R2—, así que no cuelga de ninguna de las dos secciones.
 */
booksRoutes.post('/api/portadas', rateLimit('upload', { identity: (c) => c.get('user')?.id ?? null }), async (c) => {
  const body = await c.req.parseBody({ all: true });
  const upload = F.file(body, 'file');
  if (!upload) throw badRequest('missing_file', 'No se ha recibido ningún archivo');

  const key = await new LibraryService(c.get('container')).uploadCover(upload);
  return ok(c, { key, url: `/portadas/${key.replace('books/covers/', '')}` }, 201);
});

booksRoutes.post('/biblioteca', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const parsed = libraryBookSchema.safeParse(formToBook(body));
  if (!parsed.success) {
    return shell(c, 'Añadir libro', <BookEditorPage book={null} csrfToken={c.get('csrfToken')} error="Revisa los campos marcados: el título es obligatorio." />);
  }

  const isbn = parsed.data.isbn13 ? parseIsbn(parsed.data.isbn13) : null;
  const id = await new LibraryService(c.get('container')).create(
    {
      isbn13: isbn?.isbn13 ?? null,
      isbn10: isbn?.isbn10 ?? null,
      title: parsed.data.title,
      subtitle: parsed.data.subtitle ?? null,
      authors: parsed.data.authors ?? null,
      publisher: parsed.data.publisher ?? null,
      publishedYear: parsed.data.publishedYear ?? null,
      pageCount: parsed.data.pageCount ?? null,
      language: parsed.data.language ?? null,
      location: parsed.data.location ?? null,
      status: parsed.data.status as LibraryStatus,
      rating: parsed.data.rating ?? null,
      notes: parsed.data.notes ?? null,
      coverKey: parsed.data.coverKey || null,
      coverUrl: parsed.data.coverUrl || null,
      source: parsed.data.coverUrl || isbn ? 'OPENLIBRARY' : 'MANUAL',
    },
    c.get('user')!,
  );
  return c.redirect(`/biblioteca/${id}`, 303);
});

/**
 * Alta de una ficha importada desde MyLibrary.
 *
 * Endpoint aparte del formulario porque son cosas distintas: aquí llega una
 * ficha en el vocabulario de la aplicación de origen y se traduce en el
 * servidor —donde la traducción se puede probar— en vez de en el script.
 *
 * Devuelve 409 si el ISBN ya está en el catálogo, que es lo que permite volver
 * a lanzar la importación sin duplicar nada.
 */
booksRoutes.post('/api/biblioteca/importar', rateLimit('import'), async (c) => {
  const parsed = myLibraryBookSchema.safeParse(await c.req.json());
  if (!parsed.success) throw badRequest('invalid_input', 'La ficha de origen no es válida');

  const mapped = mapMyLibraryBook({
    sourceId: parsed.data.sourceId,
    title: parsed.data.title,
    author: parsed.data.author ?? null,
    additionalAuthors: parsed.data.additionalAuthors,
    isbn: parsed.data.isbn ?? null,
    pages: parsed.data.pages ?? null,
    publishedDate: parsed.data.publishedDate ?? null,
    publisher: parsed.data.publisher ?? null,
    summary: parsed.data.summary ?? null,
    series: parsed.data.series ?? null,
    categories: parsed.data.categories,
    comments: parsed.data.comments,
    readingDates: parsed.data.readingDates ?? null,
    read: parsed.data.read,
    inWishlist: parsed.data.inWishlist,
    amazonUrl: parsed.data.amazonUrl ?? null,
    fnacUrl: parsed.data.fnacUrl ?? null,
  });
  if (!mapped) throw badRequest('invalid_input', 'La ficha no tiene título');

  const id = await new LibraryService(c.get('container')).create(
    { ...mapped, coverKey: parsed.data.coverKey || null, source: 'MANUAL' },
    c.get('user')!,
  );
  return ok(c, { id, isbn13: mapped.isbn13, title: mapped.title }, 201);
});

booksRoutes.get('/biblioteca/:id', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('El libro no existe');

  const book = await c.get('container').library.get(id.data);
  if (!book) throw notFound('El libro no existe');
  return shell(c, book.title, <BookEditorPage book={book} csrfToken={c.get('csrfToken')} />);
});

booksRoutes.post('/biblioteca/:id', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('El libro no existe');

  const body = await c.req.parseBody({ all: true });
  const parsed = libraryBookSchema.safeParse(formToBook(body));
  if (!parsed.success) throw badRequest('invalid_input', 'Revisa los datos del libro');

  const isbn = parsed.data.isbn13 ? parseIsbn(parsed.data.isbn13) : null;
  await new LibraryService(c.get('container')).update(
    id.data,
    {
      isbn13: isbn?.isbn13 ?? null,
      isbn10: isbn?.isbn10 ?? null,
      title: parsed.data.title,
      subtitle: parsed.data.subtitle ?? null,
      authors: parsed.data.authors ?? null,
      publisher: parsed.data.publisher ?? null,
      publishedYear: parsed.data.publishedYear ?? null,
      pageCount: parsed.data.pageCount ?? null,
      language: parsed.data.language ?? null,
      location: parsed.data.location ?? null,
      status: parsed.data.status as LibraryStatus,
      rating: parsed.data.rating ?? null,
      notes: parsed.data.notes ?? null,
      coverKey: parsed.data.coverKey || null,
    },
    c.get('user')!,
  );
  return c.redirect('/biblioteca', 303);
});

booksRoutes.post('/biblioteca/:id/eliminar', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('El libro no existe');
  await new LibraryService(c.get('container')).delete(id.data, c.get('user')!);
  return c.redirect('/biblioteca', 303);
});

/**
 * Portada de un libro del catálogo, en crudo.
 *
 * Con el límite de importación y no el de subida: 229 portadas agotarían las 30
 * por hora del segundo. La misma ruta sirve para cambiar una portada suelta.
 */
booksRoutes.put('/api/biblioteca/:id/portada', rateLimit('import'), async (c) => {
  const id = idSchema.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('El libro no existe');

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.length) throw badRequest('missing_file', 'No se ha recibido ninguna imagen');

  const key = await new LibraryService(c.get('container')).setCover(id.data, bytes, c.get('user')!);
  return ok(c, { key, url: `/portadas/${key.replace('books/covers/', '')}` });
});

/** Portadas privadas. Nunca salen por la ruta pública `/media/*`. */
booksRoutes.get('/portadas/*', async (c) => {
  const path = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/portadas\//, ''));
  const key = bookCoverKeyFromPath(path);
  if (!key) throw notFound('La portada no existe');
  return new LibraryService(c.get('container')).serveCover(key, c.req.raw);
});

// =============================================================== COPIAS =====
booksRoutes.get('/copias', async (c) => {
  const backups = await listBackups(c.env);
  return shell(c, 'Copias', <BackupsPage backups={backups} csrfToken={c.get('csrfToken')} />);
});

booksRoutes.post('/copias/ahora', async (c) => {
  await runLibraryBackup(c.env, c.get('requestId'));
  return c.redirect('/copias', 303);
});

booksRoutes.get('/copias/:day', async (c) => {
  const day = c.req.param('day');
  const key = `backups/library/${day}.json.gz`;
  // La clave se compone aquí y se valida con un patrón cerrado: sin esto, el
  // parámetro de la URL elegiría qué objeto del bucket se descarga.
  if (!isBackupKey(key)) throw notFound('Esa copia no existe');

  const object = await c.env.MEDIA.get(key);
  if (!object) throw notFound('Esa copia no existe');

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="biblioteca-${day}.json.gz"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

// ================================================================ VARIOS =====
booksRoutes.get('/robots.txt', (c) =>
  c.text('User-agent: *\nDisallow: /\n', 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  }),
);

/** Los campos del formulario, tal cual llegan, listos para Zod. */
function formToBook(body: Record<string, string | File | (string | File)[]>) {
  return {
    isbn13: F.strOrEmpty(body, 'isbn13', 20),
    isbn10: F.strOrEmpty(body, 'isbn10', 20),
    title: F.strOrEmpty(body, 'title', 300),
    subtitle: F.strOrEmpty(body, 'subtitle', 300),
    authors: F.strOrEmpty(body, 'authors', 300),
    publisher: F.strOrEmpty(body, 'publisher', 200),
    publishedYear: F.str(body, 'publishedYear', 10) || undefined,
    pageCount: F.str(body, 'pageCount', 10) || undefined,
    language: F.strOrEmpty(body, 'language', 20),
    location: F.strOrEmpty(body, 'location', 120),
    status: F.strOrEmpty(body, 'status', 20) || 'OWNED',
    rating: F.str(body, 'rating', 4) || undefined,
    notes: F.strOrEmpty(body, 'notes', 4000),
    coverKey: F.strOrEmpty(body, 'coverKey', 120),
    coverUrl: F.strOrEmpty(body, 'coverUrl', 500),
  };
}
