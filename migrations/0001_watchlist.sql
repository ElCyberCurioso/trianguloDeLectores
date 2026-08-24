-- ============================================================================
-- Lista de pendientes por ver / leer / jugar.
--
-- Es la cola de trabajo del administrador: lo que quiere consumir y reseñar
-- más adelante. Deliberadamente más ligera que `reviews` — sin puntuación ni
-- cuerpo — porque todavía no hay opinión que dar. Cuando se convierte en
-- reseña, `review_id` enlaza ambos registros y el item queda como DONE.
-- ============================================================================

CREATE TABLE watchlist_items (
  id             TEXT PRIMARY KEY,
  title_es       TEXT NOT NULL,
  title_original TEXT,
  content_type   TEXT NOT NULL
                 CHECK (content_type IN ('BOOK','NOVEL','MOVIE','SERIES','ANIME',
                                         'COMIC','MANGA','GAME','OTHER')),
  category_id    TEXT REFERENCES categories(id) ON DELETE SET NULL,
  year           INTEGER CHECK (year IS NULL OR (year >= 1400 AND year <= 2200)),
  creator        TEXT,
  /** Por qué está en la lista: quién lo recomendó, qué se espera de ello. */
  note           TEXT,
  /** Ficha, tráiler o sitio donde se encontró. */
  source_url     TEXT,
  priority       TEXT NOT NULL DEFAULT 'MEDIUM'
                 CHECK (priority IN ('LOW','MEDIUM','HIGH')),
  status         TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','IN_PROGRESS','DONE','DROPPED')),
  /** 0 = sólo visible en el panel; 1 = aparece en /pendientes. */
  is_public      INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0,1)),
  cover_key      TEXT,
  cover_alt      TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  /** Reseña resultante, si el item ya se convirtió. */
  review_id      TEXT REFERENCES reviews(id) ON DELETE SET NULL,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  completed_at   INTEGER
);

-- Cola del panel: primero lo activo, dentro de eso por prioridad y antigüedad.
CREATE INDEX idx_watchlist_queue  ON watchlist_items (status, priority, sort_order, created_at);
-- Página pública: sólo lo público y todavía sin terminar.
CREATE INDEX idx_watchlist_public ON watchlist_items (is_public, status, priority, created_at);
CREATE INDEX idx_watchlist_type   ON watchlist_items (content_type, status);
CREATE INDEX idx_watchlist_review ON watchlist_items (review_id);
