import { Hono } from 'hono';
import type { AppEnv } from '../../types/env';
import { rateLimit } from '../middleware/ratelimit';
import { attemptLogin } from '../lib/login';
import { badRequest, clientIp, forbidden, notFound, ok, unauthorized } from '../lib/http';
import {
  requireDevice, currentDevice, deviceIdentity, issueDeviceToken,
  MAX_DEVICES_PER_USER,
} from '../lib/device-auth';
import { DocumentService } from '../services/documents';
import { LibraryService } from '../services/library';
import { bookCoverUrl } from '../lib/books';
import {
  deviceLoginSchema, syncPullSchema, syncPushSchema, pageCountSchema, idSchema,
} from '../../validation/schemas';
import type { DocumentWithProgress } from '../../db/repos/documents';

/**
 * API de la aplicación Android, montada bajo `/api/movil` del subdominio
 * `books.`.
 *
 * Vive en el mismo Worker y sobre los mismos datos que el lector web, pero con
 * su propia credencial: un token de dispositivo en `Authorization: Bearer`, no
 * la cookie de sesión. Ver `lib/device-auth.ts` para el porqué.
 *
 * Todo lo que devuelve es JSON. Ninguna ruta de aquí pinta HTML, así que el
 * manejador de errores del subdominio ya responde en JSON solo (mira el
 * `Accept`), y la aplicación manda `Accept: application/json` en todo.
 */
export const mobileRoutes = new Hono<AppEnv>();

/**
 * El emparejamiento es lo único que puede ocurrir sin token: es justo lo que
 * sirve para conseguirlo. Como en el subdominio, el guardián va **antes** que
 * las rutas y con lista de exenciones explícita, para que una ruta nueva nazca
 * cerrada en vez de nacer abierta.
 */
const PUBLIC_MOBILE_PATHS = new Set(['/api/movil/sesion']);

mobileRoutes.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (c.req.method === 'POST' && PUBLIC_MOBILE_PATHS.has(path)) return next();
  return requireDevice(c, next);
});

// ==================================================== EMPAREJAMIENTO =====
/**
 * Cambia email y contraseña por un token de dispositivo.
 *
 * Reutiliza `attemptLogin()` entera —límite global, hash señuelo, bloqueo de
 * cuenta, auditoría— y sólo le pide que no abra sesión de navegador: aquí la
 * credencial es otra cosa. Duplicar esa lógica para el móvil habría sido la
 * forma más fácil de perder una de sus defensas por el camino.
 */
mobileRoutes.post('/sesion', rateLimit('login'), async (c) => {
  const parsed = deviceLoginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('invalid_input', 'Revisa el email, la contraseña y el nombre del dispositivo');

  const outcome = await attemptLogin(
    c,
    { email: parsed.data.email, password: parsed.data.password },
    { requireTurnstile: false, revokeOtherSessions: false, establishSession: false },
  );
  // El mensaje viaja tal cual sale de `attemptLogin`: distingue credenciales
  // incorrectas de cuenta bloqueada sin decir nunca si el email existe.
  if (!outcome.ok) throw unauthorized(outcome.message);

  const container = c.get('container');
  const user = await container.users.findById(outcome.userId);
  if (!user || user.role !== 'ADMIN') throw forbidden('Esta aplicación requiere permisos de administrador');

  /*
   * Techo de dispositivos. Al llegar al tope se retira el más antiguo en vez de
   * rechazar el nuevo: quien cambia de teléfono cada dos años no tiene por qué
   * saber que hay una lista, y dejarle fuera de su propia biblioteca por una
   * cuota interna sería el peor de los dos fallos posibles.
   */
  if ((await container.devices.countActiveForUser(user.id)) >= MAX_DEVICES_PER_USER) {
    const activos = (await container.devices.listForUser(user.id))
      .filter((d) => d.revokedAt === null && d.expiresAt > Date.now())
      .sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    const viejo = activos[0];
    if (viejo) await container.devices.revoke(viejo.id, user.id);
  }

  const issued = await issueDeviceToken(c.env, user.id, parsed.data.device, clientIp(c));

  await container.audit.record({
    actorId: user.id,
    actorRole: user.role,
    action: 'device.pair',
    entityType: 'device',
    entityId: issued.deviceId,
    // El nombre del dispositivo lo escribe la persona y es lo que le permite
    // reconocerlo después. El token, evidentemente, no se registra.
    metadata: { device: parsed.data.device },
  });

  return ok(
    c,
    {
      token: issued.token,
      deviceId: issued.deviceId,
      expiresAt: issued.expiresAt,
      user: { id: user.id, displayName: user.displayName },
      serverTime: Date.now(),
    },
    201,
  );
});

/** Desempareja este dispositivo. El token deja de valer al instante. */
mobileRoutes.delete('/sesion', async (c) => {
  const device = currentDevice(c);
  const container = c.get('container');
  await container.devices.revoke(device.deviceId, device.userId);
  await container.audit.record({
    actorId: device.userId,
    actorRole: device.role,
    action: 'device.revoke',
    entityType: 'device',
    entityId: device.deviceId,
  });
  return ok(c, { revoked: true });
});

mobileRoutes.get('/yo', (c) => {
  const device = currentDevice(c);
  return ok(c, {
    user: { id: device.userId, displayName: device.displayName },
    device: { id: device.deviceId, name: device.deviceName, expiresAt: device.expiresAt },
    serverTime: Date.now(),
  });
});

// =========================================================== DOCUMENTOS =====
mobileRoutes.get('/documentos', async (c) => {
  const documents = await c.get('container').documents.list();
  return ok(c, { documents: documents.map(toMobileDocument), serverTime: Date.now() });
});

mobileRoutes.get('/documentos/:id', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('El documento no existe');

  const container = c.get('container');
  const document = await container.documents.get(id.data);
  if (!document) throw notFound('El documento no existe');

  const [annotations, bookmarks] = await Promise.all([
    container.documents.listAnnotations(document.id),
    container.documents.listBookmarks(document.id),
  ]);

  return ok(c, {
    document: toMobileDocument(document),
    annotations,
    bookmarks,
    serverTime: Date.now(),
  });
});

/**
 * El PDF. Con `Range`, que aquí importa aún más que en el navegador: la
 * aplicación descarga el fichero entero para leerlo sin red, y una descarga que
 * se corta en el metro tiene que poder continuar donde iba.
 */
mobileRoutes.get('/documentos/:id/fichero', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('El documento no existe');

  const document = await c.get('container').documents.get(id.data);
  if (!document) throw notFound('El documento no existe');

  return new DocumentService(c.get('container')).serve(document.r2Key, c.req.raw);
});

/** Portada, resuelta por documento: el móvil no tiene por qué saber claves de R2. */
mobileRoutes.get('/documentos/:id/portada', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('La portada no existe');

  const document = await c.get('container').documents.get(id.data);
  if (!document?.coverKey) throw notFound('La portada no existe');

  return new LibraryService(c.get('container')).serveCover(document.coverKey, c.req.raw);
});

/**
 * Número de páginas contado por el visor del teléfono. Lo mismo que hace el
 * lector web: en el Worker no hay quién abra un PDF sin traerse una librería
 * entera.
 */
mobileRoutes.put('/documentos/:id/paginas', async (c) => {
  const id = idSchema.safeParse(c.req.param('id'));
  if (!id.success) throw notFound('El documento no existe');

  const parsed = pageCountSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('invalid_page_count', 'Número de páginas no válido');

  const document = await c.get('container').documents.get(id.data);
  if (!document) throw notFound('El documento no existe');

  await c.get('container').documents.setPageCount(id.data, parsed.data.pageCount);
  return ok(c, { pageCount: parsed.data.pageCount });
});

// ======================================================= SINCRONIZACIÓN =====
/**
 * Lo que ha cambiado en el servidor desde la última vez.
 *
 * `desde` es la marca de agua que guardó el dispositivo, que es siempre un
 * `serverTime` devuelto por esta misma API: comparar contra el reloj del
 * teléfono haría que un desfase de minutos se tragara cambios enteros.
 *
 * `documentIds` va entero y no sólo lo cambiado. Es la única forma de que el
 * teléfono se entere de un documento **borrado**: las fichas sí se borran de
 * verdad (se lleva el fichero de R2 por delante), así que no hay lápida que
 * mirar, y sin esta lista el libro se quedaría para siempre en la estantería
 * del móvil apuntando a un fichero que ya no existe.
 */
mobileRoutes.get('/sincronizacion', rateLimit('mobileSync', { identity: deviceIdentity }), async (c) => {
  const parsed = syncPullSchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) throw badRequest('invalid_watermark', 'Marca de sincronización no válida');

  const container = c.get('container');
  const [documents, changes] = await Promise.all([
    container.documents.list(),
    container.documents.changedSince(parsed.data.desde),
  ]);

  return ok(c, {
    serverTime: Date.now(),
    documentIds: documents.map((d) => d.id),
    documents: documents.filter((d) => d.updatedAt > parsed.data.desde).map(toMobileDocument),
    progress: changes.progress,
    annotations: changes.annotations,
    bookmarks: changes.bookmarks,
  });
});

/**
 * Lo que el teléfono escribió sin red.
 *
 * Gana la escritura más reciente, y la comparación la hace SQLite dentro del
 * `ON CONFLICT DO UPDATE` (ver `mergeAnnotation` y compañía). Aquí sólo se
 * hacen dos cosas antes de fusionar:
 *
 *   1. **recortar las marcas de tiempo al reloj del servidor.** Vienen del
 *      cliente, y un teléfono con la fecha adelantada tres años ganaría todos
 *      los conflictos futuros para siempre. Se permite un minuto de desfase,
 *      que es lo que puede haber de deriva honesta.
 *   2. **comprobar que el documento existe.** Sin esto, una anotación con un
 *      `documentId` inventado se quedaría escrita apuntando a nada.
 */
mobileRoutes.post('/sincronizacion', rateLimit('mobileSync', { identity: deviceIdentity }), async (c) => {
  const parsed = syncPushSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('invalid_sync', 'Los cambios enviados no son válidos');

  const container = c.get('container');
  const now = Date.now();
  const MAX_SKEW_MS = 60_000;
  const clamp = (value: number) => Math.min(value, now + MAX_SKEW_MS);

  const conocidos = new Set((await container.documents.list()).map((d) => d.id));

  let aplicados = 0;
  let descartados = 0;
  let desconocidos = 0;

  for (const item of parsed.data.progress) {
    if (!conocidos.has(item.documentId)) { desconocidos += 1; continue; }
    const applied = await container.documents.mergeProgress({ ...item, updatedAt: clamp(item.updatedAt) });
    if (applied) aplicados += 1;
    else descartados += 1;
  }

  for (const item of parsed.data.annotations) {
    if (!conocidos.has(item.documentId)) { desconocidos += 1; continue; }
    const applied = await container.documents.mergeAnnotation({
      ...item,
      rects: item.rects,
      quote: item.quote ?? null,
      body: item.body ?? null,
      createdAt: clamp(item.createdAt),
      updatedAt: clamp(item.updatedAt),
      deletedAt: item.deletedAt === null ? null : clamp(item.deletedAt),
    });
    if (applied) aplicados += 1;
    else descartados += 1;
  }

  for (const item of parsed.data.bookmarks) {
    if (!conocidos.has(item.documentId)) { desconocidos += 1; continue; }
    const applied = await container.documents.mergeBookmark({
      ...item,
      label: item.label ?? null,
      createdAt: clamp(item.createdAt),
      updatedAt: clamp(item.updatedAt),
      deletedAt: item.deletedAt === null ? null : clamp(item.deletedAt),
    });
    if (applied) aplicados += 1;
    else descartados += 1;
  }

  container.log.info('mobile_sync_push', {
    device: currentDevice(c).deviceId,
    aplicados,
    descartados,
    desconocidos,
  });

  // `serverTime` se toma después de fusionar, no antes: es la marca de agua
  // que el teléfono guardará, y tiene que cubrir lo que se acaba de escribir
  // para no volver a bajárselo en la siguiente vuelta.
  return ok(c, { serverTime: Date.now(), aplicados, descartados, desconocidos });
});

/**
 * Lo que la aplicación necesita de un documento. No sale ni `r2Key` ni
 * `checksum` interno de más: la clave del bucket es un detalle del servidor y
 * publicarla sólo invita a construir URL a mano.
 */
function toMobileDocument(document: DocumentWithProgress) {
  return {
    id: document.id,
    title: document.title,
    author: document.author,
    sizeBytes: document.sizeBytes,
    /** MD5 del fichero: le sirve al móvil para saber si su copia sigue valiendo. */
    checksum: document.checksum,
    pageCount: document.pageCount,
    notes: document.notes,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    lastReadAt: document.lastReadAt,
    annotationCount: document.annotationCount,
    progress:
      document.progressPage === null
        ? null
        : { page: document.progressPage, scrollPct: document.progressScrollPct ?? 0 },
    fileUrl: `/api/movil/documentos/${document.id}/fichero`,
    coverUrl: bookCoverUrl(document.coverKey) ? `/api/movil/documentos/${document.id}/portada` : null,
  };
}