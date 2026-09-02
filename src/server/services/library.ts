import type { Container } from './container';
import type { SessionUser } from '../lib/auth';
import type { LibraryPatch, LibraryRecord, LibrarySource, LibraryStatus } from '../../db/repos/library';
import { badRequest, conflict, notFound } from '../lib/http';
import { validateImage } from '../lib/images';
import { buildBookCoverKey, isSafeBookCoverKey } from '../lib/books';
import { lookupIsbn, fetchCover, type BookDraft } from '../lib/openlibrary';
import { parseIsbn } from '../lib/isbn';

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
} as const;

export interface LookupResult {
  draft: BookDraft;
  /** Si ya está en el catálogo, el registro existente. No se da de alta dos veces. */
  existing: LibraryRecord | null;
}

export interface NewBookInput {
  isbn13: string | null;
  isbn10: string | null;
  title: string;
  subtitle: string | null;
  authors: string | null;
  publisher: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  language: string | null;
  location: string | null;
  status: LibraryStatus;
  rating: number | null;
  notes: string | null;
  coverKey: string | null;
  /** URL de portada de Open Library que el servidor descargará y guardará. */
  coverUrl?: string | null;
  source: LibrarySource;
}

/** Catálogo de la biblioteca física: alta por ISBN, portadas y edición. */
export class LibraryService {
  constructor(private readonly c: Container) {}

  /** Consulta Open Library y avisa si el libro ya estaba. */
  async lookup(rawIsbn: string): Promise<LookupResult> {
    const parsed = parseIsbn(rawIsbn);
    if (!parsed) throw badRequest('invalid_isbn', 'Ese número no es un ISBN válido');

    const existing = await this.c.library.findByIsbn13(parsed.isbn13);
    const draft = await lookupIsbn(parsed.isbn13);

    if (!draft) {
      // Sin ficha en Open Library el alta sigue siendo posible: se devuelve un
      // borrador con lo único que se sabe seguro, el ISBN.
      return {
        existing,
        draft: {
          isbn13: parsed.isbn13,
          isbn10: parsed.isbn10,
          title: '',
          subtitle: null,
          authors: null,
          publisher: null,
          publishedYear: null,
          pageCount: null,
          language: null,
          coverUrl: null,
        },
      };
    }
    return { draft, existing };
  }

  async create(input: NewBookInput, actor: SessionUser): Promise<string> {
    if (input.isbn13) {
      const existing = await this.c.library.findByIsbn13(input.isbn13);
      if (existing) throw conflict('duplicate_isbn', `Ese ISBN ya está en el catálogo como «${existing.title}»`);
    }

    // La portada de Open Library la baja el servidor y se guarda en R2: así no
    // se enlaza a un tercero desde el navegador (ni se le filtra la IP de quien
    // mira) y el catálogo sigue completo aunque ese servicio desaparezca.
    let coverKey = input.coverKey;
    if (!coverKey && input.coverUrl) coverKey = await this.importCover(input.coverUrl);

    const id = crypto.randomUUID();
    await this.c.library.create({
      id,
      isbn13: input.isbn13,
      isbn10: input.isbn10,
      title: input.title,
      subtitle: input.subtitle,
      authors: input.authors,
      publisher: input.publisher,
      publishedYear: input.publishedYear,
      pageCount: input.pageCount,
      language: input.language,
      coverKey,
      location: input.location,
      status: input.status,
      rating: input.rating,
      notes: input.notes,
      source: input.source,
      addedBy: actor.id,
    });

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'library.create',
      entityType: 'library_book',
      entityId: id,
      metadata: { isbn13: input.isbn13, source: input.source },
    });
    return id;
  }

  async update(id: string, patch: LibraryPatch, actor: SessionUser): Promise<void> {
    const book = await this.c.library.get(id);
    if (!book) throw notFound('El libro no existe');

    // Si cambia la portada, la anterior se va: R2 se cobra por lo almacenado.
    if (patch.coverKey !== undefined && book.coverKey && patch.coverKey !== book.coverKey) {
      await this.deleteCover(book.coverKey);
    }

    await this.c.library.update(id, patch);
    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'library.update',
      entityType: 'library_book',
      entityId: id,
      metadata: { keys: Object.keys(patch) },
    });
  }

  async delete(id: string, actor: SessionUser): Promise<void> {
    const book = await this.c.library.get(id);
    if (!book) throw notFound('El libro no existe');

    await this.c.library.delete(id);
    if (book.coverKey) await this.deleteCover(book.coverKey);

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'library.delete',
      entityType: 'library_book',
      entityId: id,
      metadata: { title: book.title },
    });
  }

  /**
   * Portada subida a mano. Mismo pipeline que las portadas de las reseñas
   * —magic bytes, rango de dimensiones, clave generada en servidor— pero bajo
   * el prefijo privado `books/covers/`.
   */
  async uploadCover(file: File | Blob): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = validateImage(bytes);
    if (!result.ok) throw badRequest('invalid_image', 'La imagen no es válida');

    const key = buildBookCoverKey(EXT_BY_TYPE[result.value.type]);
    await this.c.env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: result.value.type, cacheControl: 'private, max-age=0, no-store' },
    });
    return key;
  }

  /**
   * Guarda una portada para un libro, a partir de la imagen en crudo.
   *
   * Es la gemela de `DocumentService.setCover`: misma validación por magic
   * bytes, misma clave generada en servidor y mismo borrado de la anterior. La
   * usa la importación masiva, que trae las portadas ya decodificadas desde el
   * fichero de origen.
   */
  async setCover(bookId: string, bytes: Uint8Array, actor: SessionUser): Promise<string> {
    const book = await this.c.library.get(bookId);
    if (!book) throw notFound('El libro no existe');

    const result = validateImage(bytes);
    if (!result.ok) throw badRequest('invalid_image', 'La imagen de portada no es válida');

    const key = buildBookCoverKey(EXT_BY_TYPE[result.value.type]);
    await this.c.env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: result.value.type, cacheControl: 'private, max-age=0, no-store' },
    });

    const previous = book.coverKey;
    await this.c.library.update(bookId, { coverKey: key });
    if (previous && previous !== key) await this.deleteCover(previous);

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'library.update',
      entityType: 'library_book',
      entityId: bookId,
      metadata: { cover: 'set', bytes: bytes.length },
    });
    return key;
  }

  /** Sirve una portada privada. Nunca pasa por la ruta pública de medios. */
  async serveCover(key: string, request: Request): Promise<Response> {
    if (!isSafeBookCoverKey(key)) return new Response('Not found', { status: 404 });

    const object = await this.c.env.MEDIA.get(key, { onlyIf: request.headers });
    if (!object) return new Response('Not found', { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    // Privada: se permite guardarla en el navegador, nunca en caché compartida.
    headers.set('Cache-Control', 'private, max-age=86400');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Content-Disposition', 'inline');
    headers.set('Content-Security-Policy', "default-src 'none'; sandbox");

    if (!('body' in object) || object.body === null) return new Response(null, { status: 304, headers });
    return new Response(object.body, { headers });
  }

  private async importCover(url: string): Promise<string | null> {
    const bytes = await fetchCover(url);
    if (!bytes) return null;
    // Lo que baja de fuera pasa por la misma validación que lo que se sube: que
    // el origen sea conocido no lo convierte en una imagen válida.
    const result = validateImage(bytes);
    if (!result.ok) return null;

    const key = buildBookCoverKey(EXT_BY_TYPE[result.value.type]);
    await this.c.env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: result.value.type, cacheControl: 'private, max-age=0, no-store' },
    });
    return key;
  }

  private async deleteCover(key: string): Promise<void> {
    if (isSafeBookCoverKey(key)) await this.c.env.MEDIA.delete(key).catch(() => undefined);
  }
}
