import type { EpisodeRow } from '../../db/repos/episodes';

/**
 * Las cuentas de una serie a partir de sus episodios.
 *
 * La media del conjunto tapa lo que se quiere ver: una serie de sesenta
 * capítulos con un 7 de nota global puede tener una tercera temporada de
 * sobresaliente y una quinta que se cae. Esto saca eso a la superficie —media
 * por temporada, mejor y peor episodio, y cómo se reparten las notas— sin
 * tocar la nota de la reseña, que sigue siendo una opinión y no un promedio.
 *
 * Se calcula **en el Worker y no en SQL** por lo mismo que el orden del
 * catálogo: son unas decenas de filas, la cuenta se lee de un vistazo y así se
 * puede probar sin base de datos.
 */

export interface SeasonStats {
  season: number;
  /** Capítulos apuntados de esa temporada, con nota o sin ella. */
  total: number;
  /** De ésos, cuántos tienen nota. Es el divisor de la media. */
  rated: number;
  /** Media en medios puntos, sin redondear a medio punto: es un promedio. */
  averageHalf: number | null;
  bestHalf: number | null;
  worstHalf: number | null;
  /** Nota de la temporada entera, si se le puso una (la fila con `episode` 0). */
  seasonHalf: number | null;
}

export interface EpisodeStats {
  total: number;
  rated: number;
  averageHalf: number | null;
  best: EpisodeRow | null;
  worst: EpisodeRow | null;
  seasons: SeasonStats[];
  /**
   * Cuántos episodios hay en cada nota entera, de 0 a 10.
   *
   * Se agrupa por nota entera y no por medio punto: veintiún barras para
   * cuarenta episodios son veintiún huecos casi vacíos, y lo que se quiere ver
   * es la forma del reparto, no el detalle.
   */
  distribution: Array<{ score: number; count: number }>;
}

/** Media aritmética de una lista, o `null` si no hay nada que promediar. */
function media(valores: number[]): number | null {
  if (!valores.length) return null;
  return valores.reduce((suma, v) => suma + v, 0) / valores.length;
}

export function computeEpisodeStats(rows: EpisodeRow[]): EpisodeStats {
  // La fila de la temporada entera (`episode` 0) no es un capítulo: entra en la
  // ficha de su temporada pero no en la media de episodios, o contaría dos
  // veces lo mismo y arrastraría el promedio hacia su propia nota.
  const capitulos = rows.filter((r) => r.episode > 0);
  const conNota = capitulos.filter((r) => r.ratingHalf !== null);

  const porTemporada = new Map<number, EpisodeRow[]>();
  for (const fila of rows) {
    const lista = porTemporada.get(fila.season);
    if (lista) lista.push(fila);
    else porTemporada.set(fila.season, [fila]);
  }

  const seasons: SeasonStats[] = [...porTemporada.entries()]
    .sort(([a], [b]) => a - b)
    .map(([season, filas]) => {
      const suyos = filas.filter((r) => r.episode > 0);
      const notas = suyos.map((r) => r.ratingHalf).filter((n): n is number => n !== null);
      return {
        season,
        total: suyos.length,
        rated: notas.length,
        averageHalf: media(notas),
        bestHalf: notas.length ? Math.max(...notas) : null,
        worstHalf: notas.length ? Math.min(...notas) : null,
        seasonHalf: filas.find((r) => r.episode === 0)?.ratingHalf ?? null,
      };
    });

  const distribucion = new Map<number, number>();
  for (const fila of conNota) {
    // De medios puntos a nota entera: 15 (7,5) cuenta como 8. Es el mismo
    // redondeo que se ve al leer la nota en voz alta.
    const entera = Math.round(fila.ratingHalf! / 2);
    distribucion.set(entera, (distribucion.get(entera) ?? 0) + 1);
  }

  return {
    total: capitulos.length,
    rated: conNota.length,
    averageHalf: media(conNota.map((r) => r.ratingHalf!)),
    best: mejorPor(conNota, (a, b) => b.ratingHalf! - a.ratingHalf!),
    worst: mejorPor(conNota, (a, b) => a.ratingHalf! - b.ratingHalf!),
    seasons,
    distribution: Array.from({ length: 11 }, (_, score) => ({
      score,
      count: distribucion.get(score) ?? 0,
    })),
  };
}

/**
 * El primero según un criterio, con el empate resuelto por orden de emisión.
 *
 * `sort()` de JavaScript no garantiza qué hace con los empates en todos los
 * motores, y aquí «el mejor episodio» empatado tiene que salir siempre el
 * mismo: si cambiara entre dos cargas de la misma página parecería un error.
 */
function mejorPor(filas: EpisodeRow[], criterio: (a: EpisodeRow, b: EpisodeRow) => number): EpisodeRow | null {
  if (!filas.length) return null;
  return [...filas].sort((a, b) => {
    const orden = criterio(a, b);
    if (orden !== 0) return orden;
    return a.season - b.season || a.episode - b.episode;
  })[0]!;
}
