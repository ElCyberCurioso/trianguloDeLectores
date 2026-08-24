import type { Container } from './container';
import type { SessionUser } from '../lib/auth';
import {
  validateImage, buildCoverKey, isSafeMediaKey, MAX_IMAGE_BYTES,
  type AllowedImageType,
} from '../lib/images';
import { badRequest, notFound, tooLarge, conflict } from '../lib/http';
import { sha256Hex } from '../lib/crypto';

const ERROR_MESSAGES: Record<string, string> = {
  empty: 'El archivo está vacío',
  too_large: `La imagen supera el límite de ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`,
  too_small: 'El archivo no parece una imagen válida',
  unsupported_type: 'Formato no permitido. Usa JPEG, PNG, WebP o AVIF',
  dimensions_out_of_range: 'Las dimensiones deben estar entre 100 y 8000 píxeles',
};

export interface UploadedCover {
  key: string;
  mime: AllowedImageType;
  size: number;
  width: number | null;
  height: number | null;
}

/**
 * Subida y borrado de portadas en R2.
 *
 * Controles: tamaño máximo, sniffing por magic bytes (no confiamos en el
 * Content-Type declarado), rango de dimensiones y **clave generada en servidor**
 * — el cliente no influye en la ruta, lo que cierra path traversal y sobrescritura.
 */
export class MediaService {
  constructor(private readonly c: Container) {}

  async uploadCover(file: File | Blob, actor: SessionUser): Promise<UploadedCover> {
    if (file.size > MAX_IMAGE_BYTES) throw tooLarge(ERROR_MESSAGES.too_large);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = validateImage(bytes);
    if (!result.ok) {
      throw badRequest('invalid_image', ERROR_MESSAGES[result.error] ?? 'Imagen no válida');
    }

    const { type, size, dimensions } = result.value;
    const key = buildCoverKey(type);
    const checksum = await sha256Hex(bytes);

    await this.c.env.MEDIA.put(key, bytes, {
      httpMetadata: {
        contentType: type,
        // Clave inmutable (UUID): puede cachearse indefinidamente.
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        uploadedBy: actor.id,
        checksum,
      },
    });

    await this.c.media.register({
      key,
      bucketPath: key,
      mime: type,
      sizeBytes: size,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      checksum,
      uploadedBy: actor.id,
      createdAt: Date.now(),
    });

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'media.upload',
      entityType: 'media',
      entityId: key,
      metadata: { mime: type, size, width: dimensions?.width, height: dimensions?.height },
    });

    return { key, mime: type, size, width: dimensions?.width ?? null, height: dimensions?.height ?? null };
  }

  /** Borra un objeto de R2. Se niega si alguna reseña lo sigue usando. */
  async deleteCover(key: string, actor: SessionUser, opts: { force?: boolean } = {}): Promise<void> {
    if (!isSafeMediaKey(key)) throw badRequest('invalid_key', 'Clave de imagen no válida');

    const record = await this.c.media.get(key);
    if (!record) throw notFound('La imagen no existe');

    if (!opts.force) {
      const usage = await this.c.reviews.coverUsageCount(key);
      if (usage > 0) throw conflict('cover_in_use', 'Esa imagen está en uso por una reseña');
    }

    await this.c.env.MEDIA.delete(key);
    await this.c.media.remove(key);
    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'media.delete',
      entityType: 'media',
      entityId: key,
    });
  }

  /** Sirve un objeto de R2 a través del Worker (bucket nunca público). */
  async serve(key: string, request: Request): Promise<Response> {
    if (!isSafeMediaKey(key)) return new Response('Not found', { status: 404 });

    const object = await this.c.env.MEDIA.get(key, {
      onlyIf: request.headers,
      range: request.headers,
    });
    if (!object) return new Response('Not found', { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('X-Content-Type-Options', 'nosniff');
    // Una imagen jamás debe interpretarse como documento.
    headers.set('Content-Disposition', 'inline');
    headers.set('Content-Security-Policy', "default-src 'none'; sandbox");

    if (!('body' in object) || object.body === null) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(object.body, { headers });
  }
}
