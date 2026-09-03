import type { Bindings } from '../../types/env';
import { createContainer } from './container';
import { BACKUP_PREFIX } from '../lib/books';

/** Cuántos días de copias se conservan antes de ir borrando las viejas. */
export const BACKUP_RETENTION_DAYS = 30;

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

  const deleted = await pruneOldBackups(env, now);

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

/**
 * Borra las copias que pasan de la retención.
 *
 * La fecha sale del nombre del objeto, no de su fecha de subida: si un día el
 * cron se ejecuta dos veces o se sube una copia a mano, el criterio sigue
 * siendo el día al que corresponde el contenido.
 */
async function pruneOldBackups(env: Bindings, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await env.MEDIA.list({ prefix: BACKUP_PREFIX, cursor, limit: 500 });
    const stale = page.objects
      .map((object) => object.key)
      .filter((key) => {
        const day = key.slice(BACKUP_PREFIX.length).replace('.json.gz', '');
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

/** Copias disponibles, de la más reciente a la más antigua. */
export async function listBackups(env: Bindings): Promise<{ key: string; day: string; size: number; uploadedAt: number }[]> {
  const page = await env.MEDIA.list({ prefix: BACKUP_PREFIX, limit: 500 });
  return page.objects
    .map((object) => ({
      key: object.key,
      day: object.key.slice(BACKUP_PREFIX.length).replace('.json.gz', ''),
      size: object.size,
      uploadedAt: object.uploaded.getTime(),
    }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

/** ¿Es una clave de copia legítima? Cierra el paso a leer cualquier objeto. */
export function isBackupKey(key: string): boolean {
  return /^backups\/library\/\d{4}-\d{2}-\d{2}\.json\.gz$/.test(key);
}
