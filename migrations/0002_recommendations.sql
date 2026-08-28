-- ============================================================================
-- Recomendaciones del público.
--
-- Cualquiera puede proponer una obra y contar por qué. La propuesta no se
-- publica: entra en una bandeja interna, y desde ahí se decide qué hacer con
-- ella —convertirla en borrador de reseña, mandarla a la lista de pendientes o
-- descartarla—. El destino queda registrado, así que se puede reconstruir de
-- dónde salió cada reseña.
--
-- No se guarda ningún dato identificativo en claro: la IP y el agente de
-- usuario van pseudonimizados, igual que en los comentarios.
-- ============================================================================

CREATE TABLE recommendations (
  id             TEXT PRIMARY KEY,
  title_es       TEXT NOT NULL,
  content_type   TEXT NOT NULL
                 CHECK (content_type IN ('BOOK','NOVEL','MOVIE','SERIES','ANIME',
                                         'COMIC','MANGA','GAME','OTHER')),
  creator        TEXT,
  year           INTEGER CHECK (year IS NULL OR (year >= 1400 AND year <= 2200)),
  -- Por qué la recomienda. Es el cuerpo de la propuesta, no un extra.
  note           TEXT NOT NULL,
  source_url     TEXT,
  -- Quién la manda. Opcional: se puede recomendar sin dar nombre.
  alias          TEXT,
  status         TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','ACCEPTED','REJECTED')),
  -- A qué se convirtió al aceptarla.
  resolution     TEXT CHECK (resolution IS NULL OR resolution IN ('REVIEW','WATCHLIST')),
  review_id      TEXT REFERENCES reviews(id) ON DELETE SET NULL,
  watchlist_id   TEXT REFERENCES watchlist_items(id) ON DELETE SET NULL,
  -- Pseudonimizados con HMAC + pepper. Nunca en claro.
  ip_hash        TEXT,
  ua_hash        TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  resolved_at    INTEGER,
  resolved_by    TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- La bandeja: primero lo que falta por revisar, y dentro de eso lo más reciente.
CREATE INDEX idx_recommendations_bandeja ON recommendations (status, created_at DESC);
-- Para el contador del panel sin recorrer la tabla.
CREATE INDEX idx_recommendations_pendientes ON recommendations (status);
-- Antiabuso: cuántas ha mandado la misma procedencia en la última hora.
CREATE INDEX idx_recommendations_origen ON recommendations (ip_hash, created_at);
