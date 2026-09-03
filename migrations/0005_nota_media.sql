-- ============================================================================
-- Medio punto en las notas.
--
-- La escala publicada es 0..10 y el editor ya prometía «con medio punto de
-- precisión», pero `reviews.rating` es un entero con CHECK 0..10: sólo caben
-- once valores y el 7,5 no existía. La promesa estaba en la etiqueta del
-- formulario y en ningún sitio más.
--
-- Para que quepan los 21 valores hace falta guardar la nota **en medios
-- puntos**, 0..20. Cambiar el CHECK de una columna en SQLite obliga a
-- reconstruir la tabla entera, que es un cambio destructivo y aquí el
-- pipeline es aditivo. Así que la nota se muda a una columna nueva.
--
-- `rating` se queda donde está, con su CHECK y su NOT NULL intactos, y pasa a
-- ser **columna heredada**: se sigue escribiendo con la nota redondeada para
-- que su restricción se cumpla y sus índices sigan siendo válidos, pero ya no
-- la lee nadie. La verdad es `rating_half`. Retirarla del todo es un cambio
-- destructivo y se hará a mano, con copia de seguridad, cuando toque.
-- ============================================================================

/**
 * Nota en medios puntos: 0..20, que son 0,0 a 10,0 de medio en medio.
 *
 * `ALTER TABLE ADD COLUMN` admite CHECK mientras el DEFAULT no sea nulo, así
 * que la restricción viaja con la columna desde el primer día y no como un
 * acuerdo de palabra entre el código y la base.
 */
ALTER TABLE reviews ADD COLUMN rating_half INTEGER NOT NULL DEFAULT 0
  CHECK (rating_half BETWEEN 0 AND 20);

-- Las notas que ya existen valían lo mismo en la escala vieja: un 8 entero son
-- 16 medios puntos. La conversión es exacta y no pierde nada.
UPDATE reviews SET rating_half = rating * 2;

-- Ordenar por «mejor valoradas» pasa a mirar la columna nueva. El índice viejo
-- sobre `rating` se queda: no estorba y desaparecerá con la columna.
CREATE INDEX idx_reviews_rating_half
  ON reviews (status, deleted_at, rating_half DESC, published_at DESC);
