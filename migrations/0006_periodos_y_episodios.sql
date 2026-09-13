-- ============================================================================
-- Periodos de emisión, temporadas y reseñas por episodio.
--
-- Tres cosas que el esquema no sabía decir:
--
-- 1. Una obra que dura varios años. `year` era un entero: «2020» cabía y
--    «2020-2022» o «2023 a la actualidad» no. Ahora el año es un **periodo**
--    con principio, final opcional y una marca de «sigue en marcha». El
--    principio se queda en `year`, que es lo que ya estaba indexado y ordenado,
--    así que nada de lo que hay se mueve de sitio.
--
-- 2. Cuántas temporadas tiene. Antes sólo cabía el número total de episodios.
--
-- 3. Qué nota tiene cada temporada y cada episodio. Una serie de sesenta
--    capítulos no se opina de una vez, y la media del conjunto tapa que la
--    tercera temporada es la buena. Eso vive en `review_episodes`, y la reseña
--    de la obra entera se queda donde estaba.
--
-- Todo aditivo: ni una tabla reconstruida, ni una columna retirada.
-- ============================================================================

/*
 * El final del periodo.
 *
 * Nulo con `year_ongoing` a 0 significa «un solo año», que es el caso de
 * siempre y el que tienen todas las filas existentes. Nulo con `year_ongoing`
 * a 1 significa «desde `year` hasta la actualidad»: no se guarda el año en
 * curso porque eso obligaría a repasar la tabla cada enero.
 */
ALTER TABLE reviews ADD COLUMN year_end INTEGER
  CHECK (year_end IS NULL OR (year_end >= 1400 AND year_end <= 2200));

ALTER TABLE reviews ADD COLUMN year_ongoing INTEGER NOT NULL DEFAULT 0
  CHECK (year_ongoing IN (0,1));

/* Número de temporadas. Nulo donde no aplica, que es casi todo. */
ALTER TABLE reviews ADD COLUMN seasons INTEGER
  CHECK (seasons IS NULL OR (seasons > 0 AND seasons <= 200));

ALTER TABLE watchlist_items ADD COLUMN year_end INTEGER
  CHECK (year_end IS NULL OR (year_end >= 1400 AND year_end <= 2200));

ALTER TABLE watchlist_items ADD COLUMN year_ongoing INTEGER NOT NULL DEFAULT 0
  CHECK (year_ongoing IN (0,1));

ALTER TABLE watchlist_items ADD COLUMN seasons INTEGER
  CHECK (seasons IS NULL OR (seasons > 0 AND seasons <= 200));

-- ---------------------------------------------- reseñas por episodio ------
/*
 * Una fila por episodio, o por temporada entera.
 *
 * `episode` vale 0 cuando la fila habla de la **temporada completa** y no de un
 * capítulo. Es un cero y no un nulo a propósito: SQLite considera distintos dos
 * NULL, así que con nulos el índice único no impediría meter dos veces la misma
 * temporada, que es justo lo que tiene que impedir.
 *
 * `rating_half` sí admite nulo: se puede anotar un capítulo sin ponerle nota
 * todavía, y un cero significaría «un cero», que es una opinión muy distinta
 * de «sin opinión». Las estadísticas cuentan sólo las filas con nota.
 *
 * `note` es **texto plano** y se escapa al pintarlo, igual que un comentario.
 * El HTML saneado se queda para el cuerpo de la reseña: aquí son dos líneas por
 * capítulo y no hace falta un editor.
 */
CREATE TABLE review_episodes (
  id           TEXT PRIMARY KEY,
  review_id    TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  season       INTEGER NOT NULL DEFAULT 1 CHECK (season >= 0 AND season <= 200),
  episode      INTEGER NOT NULL DEFAULT 0 CHECK (episode >= 0 AND episode <= 10000),
  title        TEXT,
  rating_half  INTEGER CHECK (rating_half IS NULL OR (rating_half BETWEEN 0 AND 20)),
  note         TEXT,
  has_spoilers INTEGER NOT NULL DEFAULT 0 CHECK (has_spoilers IN (0,1)),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Una fila por capítulo y temporada, sin repetir.
CREATE UNIQUE INDEX idx_review_episodes_uniq ON review_episodes (review_id, season, episode);
-- Orden de lectura: temporada y dentro de ella el capítulo, con la fila de la
-- temporada entera (episode 0) siempre la primera.
CREATE INDEX idx_review_episodes_orden ON review_episodes (review_id, season, episode);
