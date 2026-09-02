import type { Container } from './container';
import type { SessionUser } from '../lib/auth';
import { badRequest, conflict, notFound, tooLarge } from '../lib/http';
import {
  buildPdfKey, isSafePdfKey, looksLikePdf, buildBookCoverKey, isSafeBookCoverKey,
  MAX_PDF_BYTES, MIN_PDF_BYTES,
} from '../lib/books';
import { validateImage, type AllowedImageType } from '../lib/images';
import { fetchRemoteImage } from '../lib/remote-image';

const EXT_BY_TYPE: Record<AllowedImageType, 'jpg' | 'png' | 'webp' | 'avif'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/** Mensajes de por qué no se ha podido traer una portada de otro sitio. */
const COVER_URL_ERRORS: Record<string, string> = {
  invalid_url: 'Eso no es una URL válida',
  blocked_host: 'Esa dirección no está permitida. Usa una URL pública http o https',
  fetch_failed: 'No se ha podido descargar la imagen de esa dirección',
  not_an_image: 'Lo que hay en esa dirección no es una imagen',
  too_large: 'La imagen es demasiado grande',
};

export interface UploadedDocument {
  id: string;
  title: string;
  sizeBytes: number;
}

/**
 * PDFs de la biblioteca privada: subida, borrado y servicio con soporte de
 * rangos.
 *
 * La subida va **en streaming** hacia R2. Bufferizar 50 MB en el Worker se
 * acerca demasiado al techo de memoria, y no hace falta: lo único que hay que
 * mirar son los cinco primeros bytes.
 */
export class DocumentService {
  constructor(private readonly c: Container) {}

  /**
   * Sube un PDF.
   *
   * `declaredSize` viene del `Content-Length`, que es un dato del cliente: sirve
   * para rechazar pronto lo evidente, pero el límite real lo impone el contador
   * del propio flujo, que no se puede falsear.
   */
  async upload(
    body: ReadableStream<Uint8Array>,
    declaredSize: number,
    title: string,
    author: string | null,
    actor: SessionUser,
  ): Promise<UploadedDocument> {
    if (declaredSize > MAX_PDF_BYTES) throw tooLarge(`El PDF supera el límite de ${MAX_PDF_BYTES / 1024 / 1024} MB`);
    // R2 necesita saber cuántos bytes va a recibir antes de empezar: sin
    // `Content-Length` no hay subida en streaming posible.
    if (!Number.isInteger(declaredSize) || declaredSize < MIN_PDF_BYTES) {
      throw badRequest('missing_length', 'Falta la longitud del archivo o es demasiado pequeño');
    }

    const key = buildPdfKey();

    /**
     * `FixedLengthStream` es lo que le da a R2 la longitud que exige: el
     * `TransformStream` que comprueba la cabecera no la tiene, y sin esto la
     * subida muere con «Provided readable stream must have a known length».
     * Si el cuerpo real no coincide con lo declarado, R2 rechaza el objeto.
     */
    const fixed = new FixedLengthStream(declaredSize);
    let streamError: Error | null = null;
    const pump = body
      .pipeThrough(guardPdf())
      .pipeTo(fixed.writable)
      .catch((error: unknown) => {
        streamError = error instanceof Error ? error : new Error('stream_failed');
      });

    let object;
    try {
      object = await this.c.env.MEDIA.put(key, fixed.readable, {
        httpMetadata: {
          contentType: 'application/pdf',
          cacheControl: 'private, max-age=0, no-store',
        },
        customMetadata: { uploadedBy: actor.id },
      });
      await pump;
    } catch (error) {
      await pump;
      await this.c.env.MEDIA.delete(key).catch(() => undefined);
      throw translateStreamError(streamError ?? (error instanceof Error ? error : null));
    }

    if (streamError) {
      // El flujo se abortó a mitad: el objeto puede haber quedado a medias.
      await this.c.env.MEDIA.delete(key).catch(() => undefined);
      throw translateStreamError(streamError);
    }

    if (!object) throw badRequest('upload_failed', 'No se ha podido guardar el archivo');

    /**
     * Huella del contenido para detectar el mismo libro subido dos veces. Es el
     * MD5 que calcula R2 al recibirlo: hacerlo aquí obligaría a tener el fichero
     * entero en memoria y a gastar CPU en balde. No es un control de seguridad,
     * sólo antiduplicado.
     */
    const checksum = hex(object.checksums.md5) ?? object.etag;

    const duplicate = await this.c.documents.findByChecksum(checksum);
    if (duplicate) {
      await this.c.env.MEDIA.delete(key).catch(() => undefined);
      throw conflict('duplicate_document', `Ese PDF ya está en la estantería como «${duplicate.title}»`);
    }

    const id = crypto.randomUUID();
    await this.c.documents.create({
      id,
      title,
      author,
      r2Key: key,
      sizeBytes: object.size,
      checksum,
      addedBy: actor.id,
    });

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'document.upload',
      entityType: 'document',
      entityId: id,
      metadata: { size: object.size, title },
    });

    return { id, title, sizeBytes: object.size };
  }

  async delete(id: string, actor: SessionUser): Promise<void> {
    const document = await this.c.documents.get(id);
    if (!document) throw notFound('El documento no existe');

    await this.c.documents.delete(id);
    // Primero la fila, luego el objeto: si falla el borrado en R2 queda un
    // fichero huérfano, que es molesto pero inocuo. Al revés quedaría una ficha
    // que apunta a un fichero que ya no está.
    if (isSafePdfKey(document.r2Key)) await this.c.env.MEDIA.delete(document.r2Key).catch(() => undefined);
    if (document.coverKey) await this.c.env.MEDIA.delete(document.coverKey).catch(() => undefined);

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'document.delete',
      entityType: 'document',
      entityId: id,
      metadata: { title: document.title },
    });
  }

  // ------------------------------------------------------------ portadas --
  /**
   * Guarda una portada para el documento.
   *
   * Da igual de dónde venga —la primera página que ha pintado el visor, un
   * fichero elegido a mano o una imagen de otro sitio—: todas acaban validadas
   * por magic bytes y guardadas en R2 bajo `books/covers/`. **Nunca se guarda
   * una URL ajena para pintarla luego**: eso dejaría el catálogo a merced de un
   * tercero que puede cambiar la imagen, borrarla o contar quién la mira.
   */
  async setCover(documentId: string, bytes: Uint8Array, actor: SessionUser): Promise<string> {
    const document = await this.c.documents.get(documentId);
    if (!document) throw notFound('El documento no existe');

    const result = validateImage(bytes);
    if (!result.ok) throw badRequest('invalid_image', 'La imagen de portada no es válida');

    const key = buildBookCoverKey(EXT_BY_TYPE[result.value.type]);
    await this.c.env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: result.value.type, cacheControl: 'private, max-age=0, no-store' },
    });

    const previous = document.coverKey;
    await this.c.documents.update(documentId, { coverKey: key });

    // La anterior se va: R2 cobra por lo almacenado y nadie la va a mirar.
    if (previous && previous !== key && isSafeBookCoverKey(previous)) {
      await this.c.env.MEDIA.delete(previous).catch(() => undefined);
    }

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'document.update',
      entityType: 'document',
      entityId: documentId,
      metadata: { cover: 'set', bytes: bytes.length },
    });
    return key;
  }

  /** Portada indicada por URL. Se descarga aquí y se guarda como cualquier otra. */
  async setCoverFromUrl(documentId: string, url: string, actor: SessionUser): Promise<string> {
    const fetched = await fetchRemoteImage(url);
    if (!fetched.ok) {
      throw badRequest('cover_fetch_failed', COVER_URL_ERRORS[fetched.error] ?? 'No se ha podido traer la imagen');
    }
    return this.setCover(documentId, fetched.value.bytes, actor);
  }

  /**
   * Sirve el PDF al visor.
   *
   * Con soporte real de `Range`: pdf.js pide el índice del final del fichero y
   * luego sólo las páginas que va mostrando. Sin respuesta 206 se descargaría el
   * libro entero antes de pintar la primera página.
   */
  async serve(key: string, request: Request): Promise<Response> {
    if (!isSafePdfKey(key)) return new Response('Not found', { status: 404 });

    const object = await this.c.env.MEDIA.get(key, { onlyIf: request.headers, range: request.headers });
    if (!object) return new Response('Not found', { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Type', 'application/pdf');
    // Contenido privado: ni caché compartida ni caché del navegador.
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Content-Disposition', 'inline');

    if (!('body' in object) || object.body === null) {
      return new Response(null, { status: 304, headers });
    }

    const range = 'range' in object ? object.range : undefined;
    if (range && 'offset' in range && typeof range.offset === 'number' && typeof range.length === 'number') {
      const start = range.offset;
      const end = start + range.length - 1;
      headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`);
      headers.set('Content-Length', String(range.length));
      return new Response(object.body, { status: 206, headers });
    }

    headers.set('Content-Length', String(object.size));
    return new Response(object.body, { headers });
  }
}

/** Traduce el motivo por el que se abortó el flujo a un error de la aplicación. */
function translateStreamError(error: Error | null): Error {
  switch (error?.message) {
    case 'not_pdf':
      return badRequest('invalid_pdf', 'El archivo no es un PDF');
    case 'too_large':
      return tooLarge(`El PDF supera el límite de ${MAX_PDF_BYTES / 1024 / 1024} MB`);
    case 'too_small':
      return badRequest('invalid_pdf', 'El archivo está vacío o incompleto');
    default:
      return error ?? badRequest('upload_failed', 'No se ha podido guardar el archivo');
  }
}

/** El MD5 de R2 llega como ArrayBuffer. */
function hex(buffer: ArrayBuffer | undefined): string | null {
  if (!buffer) return null;
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Deja pasar el flujo sólo si empieza por `%PDF-` y no se pasa del tamaño
 * máximo. Aborta en cuanto lo sabe, sin esperar al final del fichero.
 */
function guardPdf(): TransformStream<Uint8Array, Uint8Array> {
  let verified = false;
  let head = new Uint8Array(0);
  let total = 0;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.length;
      if (total > MAX_PDF_BYTES) {
        controller.error(new Error('too_large'));
        return;
      }

      if (verified) {
        controller.enqueue(chunk);
        return;
      }

      // Los primeros trozos se retienen hasta poder mirar la cabecera: un
      // fichero puede llegar en trozos de un byte.
      const merged = new Uint8Array(head.length + chunk.length);
      merged.set(head);
      merged.set(chunk, head.length);
      head = merged;
      if (head.length < 5) return;

      if (!looksLikePdf(head)) {
        controller.error(new Error('not_pdf'));
        return;
      }
      verified = true;
      controller.enqueue(head);
      head = new Uint8Array(0);
    },

    flush(controller) {
      if (!verified) controller.error(new Error('not_pdf'));
      else if (total < MIN_PDF_BYTES) controller.error(new Error('too_small'));
    },
  });
}
