import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  BOOKS_ORIGIN, ADMIN_EMAIL, ADMIN_PASSWORD, loginAsBooks, booksHeaders,
  pdfBytes, resetAdminRateLimit, type AdminSession,
} from './helpers';

/**
 * API de la aplicación Android.
 *
 * Lo que se prueba aquí es sobre todo lo que **no** debe pasar: que el token no
 * abra el panel, que la cookie no abra la API, que un teléfono con la fecha
 * adelantada no gane todos los conflictos y que un borrado no reviva en la
 * siguiente sincronización.
 */

let books: AdminSession;
let deviceToken: string;
let documentoId: string;

/** Cabeceras de la aplicación: token, sin cookie, sin Origin y sin CSRF. */
function movil(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${deviceToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function emparejar(
  email = ADMIN_EMAIL,
  password = ADMIN_PASSWORD,
  device = 'Pixel de pruebas',
): Promise<Response> {
  return SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sesion`, {
    method: 'POST',
    body: JSON.stringify({ email, password, device }),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'CF-Connecting-IP': `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
    },
  });
}

beforeAll(async () => {
  books = await loginAsBooks();
  await resetAdminRateLimit();

  // Un documento con el que trabajar, subido por la vía normal del navegador.
  const subida = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos?title=${encodeURIComponent('Libro del móvil')}`, {
    method: 'POST',
    body: pdfBytes('movil'),
    headers: booksHeaders(books, { 'Content-Type': 'application/pdf' }),
  });
  const creado = (await subida.json()) as { data: { id: string } };
  documentoId = creado.data.id;

  const respuesta = await emparejar();
  const emparejado = (await respuesta.json()) as { data: { token: string } };
  deviceToken = emparejado.data.token;
});

describe('emparejamiento', () => {
  it('devuelve un token con las credenciales correctas', async () => {
    const response = await emparejar(ADMIN_EMAIL, ADMIN_PASSWORD, 'Otro teléfono');
    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      data: { token: string; deviceId: string; expiresAt: number; user: { displayName: string } };
    };
    expect(body.data.token.length).toBeGreaterThan(20);
    expect(body.data.expiresAt).toBeGreaterThan(Date.now());
    expect(body.data.user.displayName).toBeTruthy();
  });

  it('no escribe cookie de sesión: la credencial del móvil es otra cosa', async () => {
    const response = await emparejar(ADMIN_EMAIL, ADMIN_PASSWORD, 'Sin cookie');
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('guarda el token hasheado, nunca en claro', async () => {
    const response = await emparejar(ADMIN_EMAIL, ADMIN_PASSWORD, 'Hasheado');
    const body = (await response.json()) as { data: { token: string; deviceId: string } };

    const fila = await env.DB.prepare('SELECT token_hash FROM device_tokens WHERE id = ?')
      .bind(body.data.deviceId)
      .first<{ token_hash: string }>();

    expect(fila?.token_hash).toBeTruthy();
    expect(fila?.token_hash).not.toBe(body.data.token);
    expect(fila?.token_hash).toHaveLength(64);
  });

  it('rechaza la contraseña incorrecta sin decir si el email existe', async () => {
    const malaClave = await emparejar(ADMIN_EMAIL, 'LoQueSeaPeroMal1');
    const desconocido = await emparejar('nadie@test.local', 'LoQueSeaPeroMal1');

    expect(malaClave.status).toBe(401);
    expect(desconocido.status).toBe(401);

    const a = (await malaClave.json()) as { error: { message: string } };
    const b = (await desconocido.json()) as { error: { message: string } };
    expect(a.error.message).toBe(b.error.message);
  });

  it('exige nombre de dispositivo', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sesion`, {
      method: 'POST',
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    expect(response.status).toBe(400);
  });
});

describe('guardián de la API del móvil', () => {
  it('rechaza sin token', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/documentos`, {
      headers: { Accept: 'application/json' },
    });
    expect(response.status).toBe(401);
  });

  it('rechaza un token inventado', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/documentos`, {
      headers: { Authorization: 'Bearer noExisteEsteTokenDeDispositivo123456', Accept: 'application/json' },
    });
    expect(response.status).toBe(401);
  });

  it('no acepta la cookie del navegador como credencial del móvil', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/documentos`, {
      headers: { Cookie: books.cookie, Accept: 'application/json' },
    });
    expect(response.status).toBe(401);
  });

  it('el token del móvil no abre las rutas del navegador', async () => {
    // La estantería web sigue pidiendo cookie: son dos credenciales para dos
    // aplicaciones, y que una valga en la otra sería el fallo.
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/`, {
      headers: { Authorization: `Bearer ${deviceToken}`, Accept: 'application/json' },
    });
    expect(response.status).toBe(401);
  });

  it('funciona sin Origin ni token CSRF, que es el motivo de existir', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sincronizacion`, {
      method: 'POST',
      body: JSON.stringify({ progress: [], annotations: [], bookmarks: [] }),
      headers: movil(),
    });
    expect(response.status).toBe(200);
  });
});

describe('documentos', () => {
  it('lista los documentos con su progreso y sin claves de R2', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/documentos`, { headers: movil() });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { documents: Record<string, unknown>[] } };
    const documento = body.data.documents.find((d) => d.id === documentoId);
    expect(documento).toBeTruthy();
    expect(documento).not.toHaveProperty('r2Key');
    expect(documento!.fileUrl).toBe(`/api/movil/documentos/${documentoId}/fichero`);
  });

  it('sirve el PDF y admite rangos', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/documentos/${documentoId}/fichero`, {
      headers: { Authorization: `Bearer ${deviceToken}`, Range: 'bytes=0-9' },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toContain('/');
    expect((await response.arrayBuffer()).byteLength).toBe(10);
  });

  it('el PDF tampoco sale sin token', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/documentos/${documentoId}/fichero`, {
      headers: { Accept: 'application/pdf' },
    });
    expect(response.status).toBe(401);
  });
});

describe('sincronización', () => {
  it('sube progreso y lo devuelve en la bajada siguiente', async () => {
    const antes = Date.now();
    const subida = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sincronizacion`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify({
        progress: [{ documentId: documentoId, page: 42, scrollPct: 250, updatedAt: Date.now() }],
      }),
    });
    expect(subida.status).toBe(200);
    expect(((await subida.json()) as { data: { aplicados: number } }).data.aplicados).toBe(1);

    const bajada = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sincronizacion?desde=${antes - 1}`, {
      headers: movil(),
    });
    const body = (await bajada.json()) as {
      data: { progress: { documentId: string; page: number; scrollPct: number }[] };
    };
    const progreso = body.data.progress.find((p) => p.documentId === documentoId);
    expect(progreso?.page).toBe(42);
    expect(progreso?.scrollPct).toBe(250);
  });

  it('descarta lo más viejo: gana la última escritura, no la última llegada', async () => {
    const ahora = Date.now();
    await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sincronizacion`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify({ progress: [{ documentId: documentoId, page: 100, scrollPct: 0, updatedAt: ahora }] }),
    });

    const vieja = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sincronizacion`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify({
        progress: [{ documentId: documentoId, page: 7, scrollPct: 0, updatedAt: ahora - 60_000 }],
      }),
    });
    const resultado = (await vieja.json()) as { data: { aplicados: number; descartados: number } };
    expect(resultado.data.aplicados).toBe(0);
    expect(resultado.data.descartados).toBe(1);

    const fila = await env.DB.prepare('SELECT page FROM document_progress WHERE document_id = ?')
      .bind(documentoId)
      .first<{ page: number }>();
    expect(fila?.page).toBe(100);
  });

  it('recorta una fecha del futuro al reloj del servidor', async () => {
    const dentroDeUnAno = Date.now() + 365 * 24 * 60 * 60 * 1000;
    await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sincronizacion`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify({
        progress: [{ documentId: documentoId, page: 500, scrollPct: 0, updatedAt: dentroDeUnAno }],
      }),
    });

    const fila = await env.DB.prepare('SELECT updated_at FROM document_progress WHERE document_id = ?')
      .bind(documentoId)
      .first<{ updated_at: number }>();

    // Se acepta el cambio, pero con fecha de ahora: si no, ese teléfono ganaría
    // todos los conflictos durante un año.
    expect(fila!.updated_at).toBeLessThan(Date.now() + 120_000);
  });

  it('ignora anotaciones de un documento que no existe', async () => {
    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sincronizacion`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify({
        annotations: [
          {
            id: crypto.randomUUID(),
            documentId: crypto.randomUUID(),
            kind: 'NOTE',
            page: 1,
            rects: [],
            body: 'Nota huérfana',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      }),
    });
    const body = (await response.json()) as { data: { desconocidos: number; aplicados: number } };
    expect(body.data.desconocidos).toBe(1);
    expect(body.data.aplicados).toBe(0);
  });

  it('sube un subrayado creado sin red y lo ve el lector web', async () => {
    const id = crypto.randomUUID();
    const ahora = Date.now();
    await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sincronizacion`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify({
        annotations: [
          {
            id,
            documentId: documentoId,
            kind: 'HIGHLIGHT',
            page: 3,
            rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }],
            quote: 'Una frase',
            body: null,
            color: 'GREEN',
            createdAt: ahora,
            updatedAt: ahora,
          },
        ],
      }),
    });

    const web = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos/${documentoId}/anotaciones`, {
      headers: booksHeaders(books),
    });
    const lista = (await web.json()) as { data: { id: string; color: string; page: number }[] };
    const subrayado = lista.data.find((a) => a.id === id);
    expect(subrayado?.color).toBe('GREEN');
    expect(subrayado?.page).toBe(3);
  });

  it('un borrado en la web no revive al sincronizar el móvil', async () => {
    const id = crypto.randomUUID();
    const ahora = Date.now();

    await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sincronizacion`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify({
        annotations: [
          {
            id, documentId: documentoId, kind: 'NOTE', page: 5, rects: [],
            body: 'Se va a borrar', createdAt: ahora, updatedAt: ahora,
          },
        ],
      }),
    });

    const borrado = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos/${documentoId}/anotaciones/${id}`, {
      method: 'DELETE',
      headers: booksHeaders(books),
    });
    expect(borrado.status).toBe(200);

    // El móvil vuelve a subir la suya, con la fecha que tenía: es más vieja que
    // la lápida, así que no debe resucitar.
    await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sincronizacion`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify({
        annotations: [
          {
            id, documentId: documentoId, kind: 'NOTE', page: 5, rects: [],
            body: 'Se va a borrar', createdAt: ahora, updatedAt: ahora,
          },
        ],
      }),
    });

    const web = await SELF.fetch(`${BOOKS_ORIGIN}/api/documentos/${documentoId}/anotaciones`, {
      headers: booksHeaders(books),
    });
    const lista = (await web.json()) as { data: { id: string }[] };
    expect(lista.data.find((a) => a.id === id)).toBeUndefined();

    // Y la lápida sí baja al móvil, para que borre su copia.
    const bajada = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sincronizacion?desde=${ahora - 1}`, {
      headers: movil(),
    });
    const cambios = (await bajada.json()) as { data: { annotations: { id: string; deletedAt: number | null }[] } };
    expect(cambios.data.annotations.find((a) => a.id === id)?.deletedAt).toBeTruthy();
  });

  it('guarda y quita páginas marcadas', async () => {
    const id = crypto.randomUUID();
    const ahora = Date.now();

    await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sincronizacion`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify({
        bookmarks: [{ id, documentId: documentoId, page: 12, label: 'El capítulo bueno', createdAt: ahora, updatedAt: ahora }],
      }),
    });

    const detalle = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/documentos/${documentoId}`, { headers: movil() });
    const body = (await detalle.json()) as { data: { bookmarks: { page: number; label: string }[] } };
    expect(body.data.bookmarks.find((b) => b.page === 12)?.label).toBe('El capítulo bueno');

    await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sincronizacion`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify({
        bookmarks: [
          { id, documentId: documentoId, page: 12, label: 'El capítulo bueno', createdAt: ahora, updatedAt: ahora + 10, deletedAt: ahora + 10 },
        ],
      }),
    });

    const despues = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/documentos/${documentoId}`, { headers: movil() });
    const body2 = (await despues.json()) as { data: { bookmarks: { page: number }[] } };
    expect(body2.data.bookmarks.find((b) => b.page === 12)).toBeUndefined();
  });

  it('rechaza un lote desmesurado en vez de intentar escribirlo', async () => {
    const anotaciones = Array.from({ length: 501 }, () => ({
      id: crypto.randomUUID(),
      documentId: documentoId,
      kind: 'NOTE' as const,
      page: 1,
      rects: [],
      body: 'x',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    const response = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sincronizacion`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify({ annotations: anotaciones }),
    });
    expect(response.status).toBe(400);
  });
});

/**
 * La biblioteca en papel desde el teléfono.
 *
 * Lo que se comprueba es que no hay una segunda implementación: el alta pasa
 * por el mismo servicio que la web, así que hereda su antiduplicado por ISBN y
 * su auditoría. Y que sin token no se ve nada, como el resto de la API.
 */
describe('biblioteca desde el móvil', () => {
  let libroId: string;

  it('da de alta un libro a mano', async () => {
    const respuesta = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/biblioteca`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify({
        title: 'Un libro sin ISBN',
        authors: 'Autora de Prueba',
        status: 'OWNED',
        location: 'Balda de arriba',
      }),
    });
    expect(respuesta.status).toBe(201);

    const cuerpo = (await respuesta.json()) as { data: { book: { id: string; title: string; source: string } } };
    expect(cuerpo.data.book.title).toBe('Un libro sin ISBN');
    // Sin ISBN y sin portada remota, la ficha es manual.
    expect(cuerpo.data.book.source).toBe('MANUAL');
    libroId = cuerpo.data.book.id;
  });

  it('lo devuelve en el listado, con sus contadores', async () => {
    const respuesta = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/biblioteca?sort=title`, {
      headers: movil(),
    });
    expect(respuesta.status).toBe(200);

    const cuerpo = (await respuesta.json()) as {
      data: { books: Array<{ id: string }>; counters: { total: number } };
    };
    expect(cuerpo.data.books.some((b) => b.id === libroId)).toBe(true);
    expect(cuerpo.data.counters.total).toBeGreaterThan(0);
  });

  it('busca por texto', async () => {
    const respuesta = await SELF.fetch(
      `${BOOKS_ORIGIN}/api/movil/biblioteca?q=${encodeURIComponent('sin ISBN')}`,
      { headers: movil() },
    );
    const cuerpo = (await respuesta.json()) as { data: { books: Array<{ id: string }> } };
    expect(cuerpo.data.books.some((b) => b.id === libroId)).toBe(true);
  });

  it('edita la ficha', async () => {
    const respuesta = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/biblioteca/${libroId}`, {
      method: 'PATCH',
      headers: movil(),
      body: JSON.stringify({ title: 'Un libro sin ISBN', status: 'LENT', location: 'Prestado a alguien' }),
    });
    expect(respuesta.status).toBe(200);

    const cuerpo = (await respuesta.json()) as { data: { book: { status: string; location: string } } };
    expect(cuerpo.data.book.status).toBe('LENT');
    expect(cuerpo.data.book.location).toBe('Prestado a alguien');
  });

  it('rechaza una ficha sin título', async () => {
    const respuesta = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/biblioteca`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify({ authors: 'Nadie' }),
    });
    expect(respuesta.status).toBe(400);
  });

  it('no acepta un estado inventado', async () => {
    const respuesta = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/biblioteca`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify({ title: 'Estado raro', status: 'REGALADO' }),
    });
    expect(respuesta.status).toBe(400);
  });

  it('no se traga un ISBN repetido', async () => {
    // ISBN propio de este fichero: la base de datos de integración es la misma
    // para todos, y reutilizar uno de otro test hacía que el primer alta ya
    // chocara con la del vecino.
    const alta = {
      title: 'Con ISBN',
      isbn13: '9788400000004',
      status: 'OWNED',
    };
    const primera = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/biblioteca`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify(alta),
    });
    expect(primera.status).toBe(201);

    const segunda = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/biblioteca`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify(alta),
    });
    // 409 y no 400: el teléfono puede decir «ya lo tienes» en vez de «revisa
    // los campos», que sería mentira.
    expect(segunda.status).toBe(409);
  });

  it('un ISBN con letras es un 400, no una consulta a Open Library', async () => {
    const respuesta = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/isbn`, {
      method: 'POST',
      headers: movil(),
      body: JSON.stringify({ isbn: 'no-es-un-isbn' }),
    });
    expect(respuesta.status).toBe(400);
  });

  it('sin token no se ve el catálogo', async () => {
    const respuesta = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/biblioteca`, {
      headers: { Accept: 'application/json' },
    });
    expect(respuesta.status).toBe(401);
  });

  it('la cookie del panel tampoco abre el catálogo del móvil', async () => {
    const respuesta = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/biblioteca`, {
      headers: booksHeaders(books, { Accept: 'application/json' }),
    });
    expect(respuesta.status).toBe(401);
  });

  it('borra la ficha', async () => {
    const respuesta = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/biblioteca/${libroId}`, {
      method: 'DELETE',
      headers: movil(),
    });
    expect(respuesta.status).toBe(200);

    const despues = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/biblioteca/${libroId}`, {
      headers: movil(),
    });
    expect(despues.status).toBe(404);
  });
});

describe('revocación', () => {
  it('un token revocado deja de valer al instante', async () => {
    const emparejado = (await (await emparejar(ADMIN_EMAIL, ADMIN_PASSWORD, 'Teléfono perdido')).json()) as {
      data: { token: string };
    };
    const token = emparejado.data.token;

    const antes = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/yo`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    expect(antes.status).toBe(200);

    const baja = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/sesion`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    expect(baja.status).toBe(200);

    const despues = await SELF.fetch(`${BOOKS_ORIGIN}/api/movil/yo`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    expect(despues.status).toBe(401);
  });
});
