-- ============================================================================
-- Aplicación Android (`triangulodelectores.site/aplicacion`).
--
-- La aplicación no puede usar la sesión del navegador: la cookie caduca a las
-- dos horas de inactividad y el CSRF exige un Origin que un cliente nativo no
-- manda. Lo que se añade aquí es lo mínimo para que un teléfono hable con el
-- mismo Worker sin abrirle la mano a nadie más:
--
--   1. `device_tokens`: credencial larga por dispositivo, revocable de una en
--      una. Se guarda el SHA-256 del token, nunca el token.
--   2. `document_bookmarks`: páginas marcadas. La aplicación las tiene y la web
--      no las tenía, así que viven en su propia tabla y no forzando un valor
--      raro en `kind` de las anotaciones.
--   3. `deleted_at` en las anotaciones: sin lápida, un subrayado borrado en la
--      web reaparecía en el teléfono en la siguiente sincronización, porque el
--      teléfono lo tenía y el servidor ya no podía decir «esto se borró».
--
-- Todo aditivo. Ninguna columna cambia de tipo ni desaparece.
-- ============================================================================

-- -------------------------------------------------- credencial del móvil --
/**
 * Un token por dispositivo. Comparte la tabla de usuarios con el panel y con la
 * biblioteca, pero no su tabla de sesiones: caducidad distinta (90 días frente
 * a 12 horas) y ámbito distinto (sólo la API del móvil, nunca el panel).
 *
 * `token_hash` es el SHA-256 hexadecimal del token. Quien lea la base de datos
 * no puede autenticarse con lo que ve, igual que con las contraseñas.
 */
CREATE TABLE device_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,
  /** Lo que escribe la persona para reconocerlo, como «Pixel del trabajo». */
  device_name  TEXT NOT NULL,
  platform     TEXT NOT NULL DEFAULT 'ANDROID' CHECK (platform IN ('ANDROID')),
  /** Pseudonimizada con HMAC, como en el resto del proyecto. Nunca en claro. */
  ip_hash      TEXT,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  revoked_at   INTEGER
);

-- La búsqueda de cada petición autenticada va por el hash.
CREATE UNIQUE INDEX idx_device_tokens_hash ON device_tokens (token_hash);
CREATE INDEX idx_device_tokens_user ON device_tokens (user_id, created_at DESC);
CREATE INDEX idx_device_tokens_expires ON device_tokens (expires_at);

-- ------------------------------------------------------ páginas marcadas --
/**
 * Una marca por página y documento. Al desmarcar no se borra la fila: se pone
 * `deleted_at`, que es lo que permite propagar el borrado al otro lado. Volver
 * a marcar la misma página resucita la fila con `ON CONFLICT DO UPDATE`, sin
 * consultar antes si existe.
 */
CREATE TABLE document_bookmarks (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page        INTEGER NOT NULL CHECK (page >= 1),
  label       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE UNIQUE INDEX idx_bookmarks_doc_page ON document_bookmarks (document_id, page);
-- Barrido de la sincronización: «lo que ha cambiado desde tal instante».
CREATE INDEX idx_bookmarks_sync ON document_bookmarks (updated_at);

-- ------------------------------------------- lápida de las anotaciones --
ALTER TABLE document_annotations ADD COLUMN deleted_at INTEGER;

CREATE INDEX idx_annotations_sync ON document_annotations (updated_at);
