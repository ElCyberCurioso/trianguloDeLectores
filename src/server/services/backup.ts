import type { Bindings } from '../../types/env';
import { createContainer } from './container';
import { BACKUP_PREFIX } from '../lib/books';

/** Cuántos días de copias se conservan antes de ir borrando las viejas. */
export const BACKUP_RETENTION_DAYS = 30;

/**
 * Dónde van las copias del sitio público.
 *
 * Separadas de las de la biblioteca (`backups/library/`) y no mezcladas en un
 * único volcado: son dos aplicaciones con datos distintos, y quien restaura una
 * casi nunca quiere restaurar la otra. Además el recorte por retención mira el
 * prefijo, así que mezclarlas ataría el borrado de una al calendario de la otra.
 */
export const PUBLIC_BACKUP_PREFIX = 'backups/public/';

export interface BackupResult {
  key: string;
  bytes: number;
  books: number;
  documents: number;
  annotations: number;
  deleted: number;
}

/**
 * Copia diaria del catálogo.
 *
 * Guarda **los registros, no los ficheros**: fichas de la biblioteca física,
 * fichas de los PDF, progreso de lectura y anotaciones. Los PDF y las portadas
 * ya viven en R2, que es el mismo sitio donde iría la copia — duplicarlos sólo
 * gastaría cuota sin añadir seguridad frente a lo que de verdad puede perderse,
 * que es la base de datos.
 *
 * El volcado va en JSON comprimido con gzip. Es legible con `zcat` y se puede
 * reinsertar sin herramientas especiales.
 */
export async function runLibraryBackup(env: Bindings, requestId: string): Promise<BackupResult> {
  const container = createContainer(env, requestId);
  const now = new Date();

  const [books, documentData] = await Promise.all([
    container.library.exportAll(),
    container.documents.exportAll(),
  ]);

  const payload = {
    generatedAt: now.toISOString(),
    environment: env.ENVIRONMENT,
    schema: '0004_movil',
    libraryBooks: books,
    documents: documentData.documents,
    documentProgress: documentData.progress,
    documentAnnotations: documentData.annotations,
    // Las páginas marcadas llegaron con la aplicación del móvil. Van aquí desde
    // el primer día: una tabla que no entra en la copia es una tabla que se
    // pierde entera, y sólo se descubre al restaurar.
    documentBookmarks: documentData.bookmarks,
  };

  // `CompressionStream` es API web estándar y va nativa en el runtime: no hay
  // que traerse una librería de compresión ni gastar CPU en JavaScript.
  const compressed = new Response(
    new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream('gzip')),
  );
  const bytes = new Uint8Array(await compressed.arrayBuffer());

  const key = `${BACKUP_PREFIX}${now.toISOString().slice(0, 10)}.json.gz`;
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: 'application/gzip' },
    customMetadata: {
      books: String(books.length),
      documents: String(documentData.documents.length),
      annotations: String(documentData.annotations.length),
      bookmarks: String(documentData.bookmarks.length),
    },
  });

  const deleted = await pruneOldBackups(env, now, BACKUP_PREFIX);

  await container.audit.record({
    actorId: null,
    actorRole: null,
    action: 'library.backup',
    entityType: 'backup',
    entityId: key,
    metadata: {
      bytes: bytes.length,
      books: books.length,
      documents: documentData.documents.length,
      annotations: documentData.annotations.length,
      deleted,
    },
  });

  return {
    key,
    bytes: bytes.length,
    books: books.length,
    documents: documentData.documents.length,
    annotations: documentData.annotations.length,
    deleted,
  };
}

export interface PublicBackupResult {
  key: string;
  bytes: number;
  reviews: number;
  comments: number;
  watchlist: number;
  deleted: number;
}

/**
 * Copia diaria del sitio público.
 *
 * Lo que aquí se pierde no se recupera de ningún sitio: las reseñas escritas a
 * mano, los comentarios de quien pasó por allí y la cola de pendientes. El cron
 * ya respaldaba la biblioteca privada y no esto, que es exactamente al revés de
 * lo que importa.
 *
 * **Qué NO entra, y por qué:**
 *
 * - `users` y `sessions`. La tabla de usuarios lleva los hash de contraseña, y
 *   una copia en R2 es un sitio más donde acaban. Restaurar significa volver a
 *   crear la cuenta con `npm run admin:create`, que cuesta un minuto; las
 *   sesiones caducan solas y no hay nada que restaurar.
 * - `audit_log`. Tiene su propia retención configurable y se purga a propósito:
 *   copiarlo cada día resucitaría lo que la política de privacidad borra.
 * - Las portadas. Son ficheros y ya viven en R2, que es donde iría la copia.
 *
 * Igual que la de la biblioteca: JSON con gzip, legible con `zcat`, sin
 * herramientas especiales para volver a meterlo.
 *
 * **Sólo se programa en producción** (`copiaDelSitioProcede`). Lo de staging es
 * un banco de pruebas que se siembra y se tira: guardarlo cada día gastaría
 * cuota de R2 y llenaría el bucket de volcados que nadie va a restaurar. La
 * función en sí no mira el entorno —el botón «Hacer una copia ahora» del panel
 * la usa donde sea, y en staging es justo donde conviene poder probarla—; quien
 * decide es el cron.
 */
export function copiaDelSitioProcede(env: Pick<Bindings, 'ENVIRONMENT'>): boolean {
  return env.ENVIRONMENT === 'production';
}

export async function runPublicBackup(env: Bindings, requestId: string): Promise<PublicBackupResult> {
  const container = createContainer(env, requestId);
  const now = new Date();

  const [reviewData, episodes, comments, reports, watchlist, taxonomy, recommendations, media, settings] =
    await Promise.all([
      container.reviews.exportAll(),
      container.episodes.exportAll(),
      container.comments.exportAll(),
      container.reports.exportAll(),
      container.watchlist.exportAll(),
      container.taxonomy.exportAll(),
      container.recommendations.exportAll(),
      container.media.exportAll(),
      container.settings.all(),
    ]);

  const payload = {
    generatedAt: now.toISOString(),
    environment: env.ENVIRONMENT,
    schema: '0006_periodos_y_episodios',
    reviews: reviewData.reviews,
    reviewGenres: reviewData.reviewGenres,
    reviewPlatforms: reviewData.reviewPlatforms,
    reviewEpisodes: episodes,
    comments,
    commentReports: reports,
    watchlistItems: watchlist,
    categories: taxonomy.categories,
    genres: taxonomy.genres,
    platforms: taxonomy.platforms,
    recommendations,
    mediaObjects: media,
    settings,
  };

  const { key, bytes } = await escribirCopia(env, PUBLIC_BACKUP_PREFIX, now, payload, {
    reviews: String(reviewData.reviews.length),
    comments: String(comments.length),
    watchlist: String(watchlist.length),
  });

  const deleted = await pruneOldBackups(env, now, PUBLIC_BACKUP_PREFIX);

  await container.audit.record({
    actorId: null,
    actorRole: null,
    action: 'public.backup',
    entityType: 'backup',
    entityId: key,
    metadata: {
      bytes,
      reviews: reviewData.reviews.length,
      comments: comments.length,
      watchlist: watchlist.length,
      deleted,
    },
  });

  return {
    key,
    bytes,
    reviews: reviewData.reviews.length,
    comments: comments.length,
    watchlist: watchlist.length,
    deleted,
  };
}

/**
 * Comprime el volcado y lo deja en R2.
 *
 * `CompressionStream` es API web estándar y va nativa en el runtime: no hay que
 * traerse una librería de compresión ni gastar CPU en JavaScript.
 */
async function escribirCopia(
  env: Bindings,
  prefix: string,
  now: Date,
  payload: unknown,
  customMetadata: Record<string, string>,
): Promise<{ key: string; bytes: number }> {
  const compressed = new Response(
    new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream('gzip')),
  );
  const bytes = new Uint8Array(await compressed.arrayBuffer());

  const key = `${prefix}${now.toISOString().slice(0, 10)}.json.gz`;
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: 'application/gzip' },
    customMetadata,
  });

  return { key, bytes: bytes.length };
}

/**
 * Borra las copias que pasan de la retención.
 *
 * La fecha sale del nombre del objeto, no de su fecha de subida: si un día el
 * cron se ejecuta dos veces o se sube una copia a mano, el criterio sigue
 * siendo el día al que corresponde el contenido.
 */
async function pruneOldBackups(env: Bindings, now: Date, prefix: string): Promise<number> {
  const cutoff = new Date(now.getTime() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await env.MEDIA.list({ prefix, cursor, limit: 500 });
    const stale = page.objects
      .map((object) => object.key)
      .filter((key) => {
        const day = key.slice(prefix.length).replace('.json.gz', '');
        return /^\d{4}-\d{2}-\d{2}$/.test(day) && day < cutoff;
      });
    if (stale.length) {
      await env.MEDIA.delete(stale);
      deleted += stale.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return deleted;
}

export interface BackupListing {
  key: string;
  day: string;
  size: number;
  uploadedAt: number;
}

/** Copias disponibles, de la más reciente a la más antigua. */
export async function listBackups(env: Bindings, prefix = BACKUP_PREFIX): Promise<BackupListing[]> {
  const page = await env.MEDIA.list({ prefix, limit: 500 });
  return page.objects
    .map((object) => ({
      key: object.key,
      day: object.key.slice(prefix.length).replace('.json.gz', ''),
      size: object.size,
      uploadedAt: object.uploaded.getTime(),
    }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

/**
 * ¿Es una clave de copia legítima? Cierra el paso a leer cualquier objeto.
 *
 * El prefijo entra como argumento y la fecha se comprueba con un patrón
 * cerrado: lo que nunca se concatena sin mirar es el trozo que viene de la URL.
 */
export function isBackupKey(key: string, prefix = BACKUP_PREFIX): boolean {
  if (!key.startsWith(prefix)) return false;
  return /^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(key.slice(prefix.length));
}
