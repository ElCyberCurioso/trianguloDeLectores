-- ============================================================================
-- Triángulo de Lectores — esquema inicial (Cloudflare D1 / SQLite)
-- Convenciones:
--   * ids: TEXT (UUID v4 generado con crypto.randomUUID en el Worker)
--   * timestamps: INTEGER unix epoch en milisegundos (UTC)
--   * rating: INTEGER 0..10 == estrellas * 2 (permite medias estrellas exactas)
-- ============================================================================

-- ---------------------------------------------------------------- usuarios --
CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  email_norm     TEXT NOT NULL,
  password_hash  TEXT NOT NULL,          -- "pbkdf2$sha256$<iter>$<saltB64>$<hashB64>"
  display_name   TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('ADMIN','USER')),
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  failed_logins  INTEGER NOT NULL DEFAULT 0,
  locked_until   INTEGER,
  last_login_at  INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_users_email_norm ON users (email_norm);
CREATE INDEX idx_users_role ON users (role);

-- ---------------------------------------------------------------- sesiones --
-- id = SHA-256(token). El token en claro solo vive en la cookie del cliente.
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_secret   TEXT NOT NULL,
  ip_hash       TEXT,
  ua_hash       TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,   -- idle timeout (deslizante)
  absolute_exp  INTEGER NOT NULL,   -- techo absoluto, no se renueva
  revoked_at    INTEGER
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- -------------------------------------------------------------- categorías --
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_categories_slug ON categories (slug);
CREATE INDEX idx_categories_sort ON categories (is_active, sort_order);

-- ------------------------------------------------------------ géneros/tags --
CREATE TABLE genres (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_genres_slug ON genres (slug);

-- ------------------------------------------------------------- plataformas --
CREATE TABLE platforms (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'OTHER'
             CHECK (kind IN ('STREAMING','STORE','LIBRARY','AUDIO','GAME','OTHER')),
  base_url   TEXT,
  color      TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_platforms_slug ON platforms (slug);
CREATE INDEX idx_platforms_active ON platforms (is_active, sort_order);

-- ----------------------------------------------------------------- reseñas --
CREATE TABLE reviews (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL,
  title_es       TEXT NOT NULL,
  title_original TEXT,
  other_titles   TEXT,                    -- JSON array de strings
  content_type   TEXT NOT NULL
                 CHECK (content_type IN ('BOOK','NOVEL','MOVIE','SERIES','ANIME',
                                         'COMIC','MANGA','GAME','OTHER')),
  category_id    TEXT REFERENCES categories(id) ON DELETE SET NULL,
  year           INTEGER CHECK (year IS NULL OR (year >= 1400 AND year <= 2200)),
  creator        TEXT,                    -- autor / director / estudio
  country        TEXT,
  duration_min   INTEGER CHECK (duration_min IS NULL OR duration_min > 0),
  episodes       INTEGER CHECK (episodes IS NULL OR episodes > 0),
  volumes        INTEGER CHECK (volumes IS NULL OR volumes > 0),
  rating         INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 10),
  summary        TEXT,
  body_html      TEXT NOT NULL DEFAULT '',  -- HTML ya saneado en servidor
  has_spoilers   INTEGER NOT NULL DEFAULT 0 CHECK (has_spoilers IN (0,1)),
  status         TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED')),
  comments_mode  TEXT NOT NULL DEFAULT 'INHERIT'
                 CHECK (comments_mode IN ('INHERIT','OPEN','AUTH','CLOSED')),
  cover_key      TEXT,                    -- clave del objeto en R2
  cover_width    INTEGER,
  cover_height   INTEGER,
  cover_alt      TEXT,
  seo_title      TEXT,
  seo_description TEXT,
  comment_count  INTEGER NOT NULL DEFAULT 0,
  published_at   INTEGER,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER
);
CREATE UNIQUE INDEX idx_reviews_slug ON reviews (slug);
CREATE INDEX idx_reviews_feed        ON reviews (status, deleted_at, published_at DESC);
CREATE INDEX idx_reviews_rating      ON reviews (status, deleted_at, rating DESC, published_at DESC);
CREATE INDEX idx_reviews_comments    ON reviews (status, deleted_at, comment_count DESC, published_at DESC);
CREATE INDEX idx_reviews_type        ON reviews (content_type, status, deleted_at);
CREATE INDEX idx_reviews_category    ON reviews (category_id, status, deleted_at);
CREATE INDEX idx_reviews_updated     ON reviews (updated_at DESC);

-- N:M reseña <-> género
CREATE TABLE review_genres (
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  genre_id  TEXT NOT NULL REFERENCES genres(id)  ON DELETE CASCADE,
  PRIMARY KEY (review_id, genre_id)
);
CREATE INDEX idx_review_genres_genre ON review_genres (genre_id, review_id);

-- N:M reseña <-> plataforma, con datos de la relación
CREATE TABLE review_platforms (
  id           TEXT PRIMARY KEY,
  review_id    TEXT NOT NULL REFERENCES reviews(id)   ON DELETE CASCADE,
  platform_id  TEXT NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  url          TEXT,
  availability TEXT NOT NULL DEFAULT 'OTHER'
               CHECK (availability IN ('SUBSCRIPTION','RENT','BUY','FREE',
                                       'LIBRARY','PHYSICAL','OTHER')),
  note         TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_review_platforms_uniq ON review_platforms (review_id, platform_id, availability);
CREATE INDEX idx_review_platforms_review ON review_platforms (review_id, sort_order);

-- -------------------------------------------------------------- comentarios --
-- Árbol por materialized path: path = '/<id>/' o '/<padre>/<id>/'.
-- Permite traer el hilo completo de una reseña en una sola query ordenada.
CREATE TABLE comments (
  id            TEXT PRIMARY KEY,
  review_id     TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  parent_id     TEXT REFERENCES comments(id) ON DELETE SET NULL,
  path          TEXT NOT NULL,
  depth         INTEGER NOT NULL DEFAULT 0 CHECK (depth >= 0),
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_alias  TEXT NOT NULL,
  body          TEXT NOT NULL,             -- texto plano, se escapa al render
  status        TEXT NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','APPROVED','REJECTED','REPORTED','HIDDEN')),
  report_count  INTEGER NOT NULL DEFAULT 0,
  is_deleted    INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1)),
  reply_count   INTEGER NOT NULL DEFAULT 0,
  ip_hash       TEXT,
  ua_hash       TEXT,
  moderated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  moderated_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_comments_thread   ON comments (review_id, path);
CREATE INDEX idx_comments_status   ON comments (status, created_at DESC);
CREATE INDEX idx_comments_reported ON comments (report_count DESC, created_at DESC);
CREATE INDEX idx_comments_parent   ON comments (parent_id);
CREATE INDEX idx_comments_review_status ON comments (review_id, status, created_at);

-- ----------------------------------------------------------------- reportes --
CREATE TABLE comment_reports (
  id            TEXT PRIMARY KEY,
  comment_id    TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  reporter_hash TEXT NOT NULL,   -- HMAC(reporter_id | ip, secret). No guardamos IP cruda.
  reason        TEXT NOT NULL
                CHECK (reason IN ('SPAM','INSULTS','HARASSMENT','SPOILERS','OFFENSIVE','OTHER')),
  details       TEXT,
  status        TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','DISMISSED')),
  created_at    INTEGER NOT NULL,
  resolved_at   INTEGER,
  resolved_by   TEXT REFERENCES users(id) ON DELETE SET NULL
);
-- una persona no puede reportar dos veces el mismo comentario
CREATE UNIQUE INDEX idx_reports_uniq ON comment_reports (comment_id, reporter_hash);
CREATE INDEX idx_reports_open ON comment_reports (status, created_at DESC);

-- ------------------------------------------------------------ configuración --
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,        -- JSON
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------------ auditoría --
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  metadata    TEXT,          -- JSON, nunca secretos ni PII innecesaria
  ip_hash     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log (created_at DESC);
CREATE INDEX idx_audit_entity  ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_actor   ON audit_log (actor_id, created_at DESC);

-- --------------------------------------------------------------- media (R2) --
-- Registro de objetos subidos a R2, para poder limpiar huérfanos y auditar.
CREATE TABLE media_objects (
  key         TEXT PRIMARY KEY,      -- p.ej. reviews/covers/2026/ab/<uuid>.webp
  bucket_path TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  checksum    TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_media_created ON media_objects (created_at DESC);
