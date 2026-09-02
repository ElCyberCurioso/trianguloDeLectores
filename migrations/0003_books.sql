-- ============================================================================
-- Biblioteca privada (subdominio books.).
--
-- Dos mitades que no se mezclan:
--   1. `documents` + `document_progress` + `document_annotations`: los PDFs que
--      se leen dentro de la aplicación, con por dónde va la lectura, las notas
--      y los subrayados.
--   2. `library_books`: el catálogo de los libros que existen en papel. No
--      tienen fichero asociado, sólo ficha y portada.
--
-- Nada de esto es público. Vive detrás del login del subdominio y ninguna
-- consulta del sitio público toca estas tablas.
-- ============================================================================

-- --------------------------------------------------------------- documentos --
CREATE TABLE documents (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  author       TEXT,
  /**
   * Clave del PDF en R2. Bajo el prefijo `books/pdf/`, que `isSafeMediaKey()`
   * NO reconoce: la ruta pública /media/ no puede servir estos ficheros ni por
   * accidente. Se sirven sólo desde el subdominio autenticado.
   */
  r2_key       TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  /** SHA-256 del fichero. Permite detectar subidas duplicadas. */
  checksum     TEXT NOT NULL,
  /** Lo cuenta el lector en el navegador la primera vez que abre el PDF. */
  page_count   INTEGER,
  /** Portada opcional, bajo el prefijo `books/covers/`. */
  cover_key    TEXT,
  notes        TEXT,
  added_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  last_read_at INTEGER
);

-- Estantería: lo leído hace poco primero.
CREATE INDEX idx_documents_recent ON documents (last_read_at DESC, created_at DESC);
-- Antiduplicado por contenido, no por nombre de fichero.
CREATE UNIQUE INDEX idx_documents_checksum ON documents (checksum);

-- ------------------------------------------------------ progreso de lectura --
/**
 * Una fila por documento: por dónde se dejó de leer.
 *
 * `scroll_pct` es la fracción de la página visible en la parte de arriba del
 * visor, en milésimas (0..1000). Con eso se recupera la posición exacta y no
 * sólo el número de página.
 */
CREATE TABLE document_progress (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  page        INTEGER NOT NULL CHECK (page >= 1),
  scroll_pct  INTEGER NOT NULL DEFAULT 0 CHECK (scroll_pct >= 0 AND scroll_pct <= 1000),
  updated_at  INTEGER NOT NULL
);

-- ------------------------------------------------------- notas y subrayados --
/**
 * Notas y subrayados sobre un PDF.
 *
 * `rects` guarda los rectángulos del texto seleccionado en JSON, con
 * coordenadas **normalizadas** (0..1) respecto al tamaño de la página. Así el
 * subrayado cae en su sitio con cualquier zoom y en cualquier pantalla.
 * Una nota suelta no lleva rectángulos, sólo página.
 */
CREATE TABLE document_annotations (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('HIGHLIGHT','NOTE')),
  page        INTEGER NOT NULL CHECK (page >= 1),
  rects       TEXT,
  /** Texto seleccionado, tal cual lo devuelve la capa de texto del visor. */
  quote       TEXT,
  /** Lo que escribe la persona. Texto plano, se escapa al pintar. */
  body        TEXT,
  color       TEXT NOT NULL DEFAULT 'YELLOW'
              CHECK (color IN ('YELLOW','RED','GREEN','BLUE')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Panel lateral del lector: todas las anotaciones de un documento, en orden.
CREATE INDEX idx_annotations_doc  ON document_annotations (document_id, page, created_at);
CREATE INDEX idx_annotations_kind ON document_annotations (document_id, kind);

-- --------------------------------------------------------- libros en papel --
/**
 * Catálogo de la biblioteca física. Sin fichero: lo que hay es el objeto.
 *
 * Los ISBN se guardan normalizados, sólo dígitos y una X final posible, para
 * que la búsqueda y el antiduplicado no dependan de guiones.
 */
CREATE TABLE library_books (
  id             TEXT PRIMARY KEY,
  isbn13         TEXT,
  isbn10         TEXT,
  title          TEXT NOT NULL,
  subtitle       TEXT,
  /** Varios autores separados por coma. No merece tabla propia todavía. */
  authors        TEXT,
  publisher      TEXT,
  published_year INTEGER CHECK (published_year IS NULL OR
                                (published_year >= 1400 AND published_year <= 2200)),
  page_count     INTEGER CHECK (page_count IS NULL OR page_count > 0),
  language       TEXT,
  cover_key      TEXT,
  /** Dónde está el libro en casa: estantería, balda, caja. */
  location       TEXT,
  status         TEXT NOT NULL DEFAULT 'OWNED'
                 CHECK (status IN ('OWNED','READING','READ','LENT','WISHLIST')),
  /** Entero 0..10, igual que la puntuación de las reseñas. */
  rating         INTEGER CHECK (rating IS NULL OR (rating >= 0 AND rating <= 10)),
  notes          TEXT,
  /** De dónde salió la ficha, para saber qué se rellenó solo. */
  source         TEXT NOT NULL DEFAULT 'MANUAL'
                 CHECK (source IN ('MANUAL','OPENLIBRARY')),
  added_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

-- Un ISBN no se repite, pero puede faltar: en SQLite los NULL no chocan entre
-- sí en un índice único, así que los libros sin ISBN conviven sin problema.
CREATE UNIQUE INDEX idx_library_isbn13 ON library_books (isbn13);
CREATE INDEX idx_library_title  ON library_books (title);
CREATE INDEX idx_library_status ON library_books (status, created_at DESC);
