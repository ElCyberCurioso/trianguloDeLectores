import type { FC } from 'hono/jsx';
import type { EpisodeRow } from '../../../db/repos/episodes';
import { computeEpisodeStats, type EpisodeStats } from '../../lib/episode-stats';
import { formatAverageScore, formatScore, MAX_SCORE_HALF } from '../../../types/domain';
import { Icon } from './icons';
import { StarRating } from './ui';

/**
 * Las notas por temporada y capítulo, con sus cuentas.
 *
 * Va después del cuerpo de la reseña y no antes: lo primero es la opinión, y
 * esto es el detalle de quien ya ha decidido que le interesa. La nota de la
 * reseña sigue siendo la de la obra entera; aquí no se recalcula nada, sólo se
 * cuenta lo que hay.
 */
export const EpisodesSection: FC<{ episodes: EpisodeRow[] }> = ({ episodes }) => {
  if (!episodes.length) return null;
  const stats = computeEpisodeStats(episodes);

  const porTemporada = new Map<number, EpisodeRow[]>();
  for (const fila of episodes) {
    const lista = porTemporada.get(fila.season);
    if (lista) lista.push(fila);
    else porTemporada.set(fila.season, [fila]);
  }

  return (
    <section class="episodes" aria-labelledby="episodios">
      <h2 class="episodes__title" id="episodios">
        Temporada a temporada
      </h2>

      <EpisodeStatsView stats={stats} />

      {[...porTemporada.entries()]
        .sort(([a], [b]) => a - b)
        .map(([season, filas]) => {
          const ficha = filas.find((f) => f.episode === 0) ?? null;
          const capitulos = filas.filter((f) => f.episode > 0);
          const resumen = stats.seasons.find((s) => s.season === season);

          return (
            <section class="episodes__season" aria-labelledby={`temporada-${season}`}>
              <header class="episodes__season-head">
                <h3 class="episodes__season-title" id={`temporada-${season}`}>
                  {season === 0 ? 'Especiales' : `Temporada ${season}`}
                </h3>
                {ficha?.ratingHalf !== null && ficha?.ratingHalf !== undefined ? (
                  <StarRating rating={ficha.ratingHalf} size="sm" showValue />
                ) : null}
                {resumen && resumen.averageHalf !== null ? (
                  <p class="episodes__season-avg">
                    Media de los capítulos: <strong>{formatAverageScore(resumen.averageHalf)}</strong>{' '}
                    <span class="episodes__muted">
                      ({resumen.rated} de {resumen.total})
                    </span>
                  </p>
                ) : null}
              </header>

              {ficha?.note ? <p class="episodes__season-note">{ficha.note}</p> : null}

              {capitulos.length ? (
                <ol class="episodes__list">
                  {capitulos.map((episode) => (
                    <li class="episodes__item">
                      <span class="episodes__number" aria-hidden="true">
                        {episode.episode}
                      </span>
                      <div class="episodes__body">
                        <p class="episodes__name">
                          <span class="visually-hidden">Capítulo {episode.episode}. </span>
                          {episode.title ?? `Capítulo ${episode.episode}`}
                        </p>
                        {episode.note ? (
                          /*
                            Texto plano escapado por el motor de plantillas, igual
                            que un comentario: esto no pasa por el saneador de
                            HTML porque no es HTML.
                          */
                          <p class={`episodes__note${episode.hasSpoilers ? ' episodes__note--spoiler' : ''}`}>
                            {episode.hasSpoilers ? (
                              <span class="episodes__spoiler-flag">
                                <Icon name="warning" size={12} />
                                <span class="visually-hidden">Contiene spoilers: </span>
                              </span>
                            ) : null}
                            {episode.note}
                          </p>
                        ) : null}
                      </div>
                      <div class="episodes__score">
                        {episode.ratingHalf === null ? (
                          <span class="episodes__muted">Sin nota</span>
                        ) : (
                          <span class="episodes__value">{formatScore(episode.ratingHalf)}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : null}
            </section>
          );
        })}
    </section>
  );
};

/**
 * El resumen numérico.
 *
 * Las barras del reparto llevan su altura en un `data-*` y la pone el CSS con
 * una regla por valor, no un `style=`: la CSP no lleva `unsafe-inline` y del
 * servidor no sale ni un estilo en línea. Son once reglas, las mismas once que
 * cajones tiene el reparto.
 */
const EpisodeStatsView: FC<{ stats: EpisodeStats }> = ({ stats }) => {
  if (!stats.rated) {
    return (
      <p class="episodes__empty">
        {stats.total} {stats.total === 1 ? 'capítulo apuntado' : 'capítulos apuntados'}, ninguno con nota
        todavía.
      </p>
    );
  }

  const maximo = Math.max(...stats.distribution.map((d) => d.count));

  return (
    <div class="epstats">
      <dl class="epstats__figures">
        <div class="epstats__figure">
          <dt class="epstats__label">Media de los capítulos</dt>
          <dd class="epstats__value">{formatAverageScore(stats.averageHalf ?? 0)}</dd>
        </div>
        <div class="epstats__figure">
          <dt class="epstats__label">Capítulos valorados</dt>
          <dd class="epstats__value">
            {stats.rated}
            <span class="epstats__of"> de {stats.total}</span>
          </dd>
        </div>
        {stats.best ? (
          <div class="epstats__figure">
            <dt class="epstats__label">El mejor</dt>
            <dd class="epstats__value epstats__value--sm">
              T{stats.best.season}×{stats.best.episode} · {formatScore(stats.best.ratingHalf ?? 0)}
              {stats.best.title ? <span class="epstats__sub">{stats.best.title}</span> : null}
            </dd>
          </div>
        ) : null}
        {stats.worst && stats.worst.id !== stats.best?.id ? (
          <div class="epstats__figure">
            <dt class="epstats__label">El peor</dt>
            <dd class="epstats__value epstats__value--sm">
              T{stats.worst.season}×{stats.worst.episode} · {formatScore(stats.worst.ratingHalf ?? 0)}
              {stats.worst.title ? <span class="epstats__sub">{stats.worst.title}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>

      {stats.seasons.length > 1 ? (
        <table class="epstats__table">
          <caption class="visually-hidden">Media de cada temporada</caption>
          <thead>
            <tr>
              <th scope="col">Temporada</th>
              <th scope="col">Media</th>
              <th scope="col">Valorados</th>
            </tr>
          </thead>
          <tbody>
            {stats.seasons.map((season) => (
              <tr>
                <th scope="row">{season.season === 0 ? 'Especiales' : season.season}</th>
                <td>{season.averageHalf === null ? '—' : formatAverageScore(season.averageHalf)}</td>
                <td>
                  {season.rated} / {season.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <figure class="epstats__chart">
        <figcaption class="epstats__chart-title">Cómo se reparten las notas</figcaption>
        <ol class="epstats__bars">
          {stats.distribution.map((cajon) => (
            <li class="epstats__bar">
              {/*
                La altura sale de `data-share`, un entero 0..10 que es el
                porcentaje redondeado a decenas. Once valores, once reglas de
                CSS: `attr()` todavía no vale para longitudes, y del servidor no
                puede salir un `style=`.
              */}
              <span
                class="epstats__bar-fill"
                data-share={maximo ? Math.round((cajon.count / maximo) * 10) : 0}
                aria-hidden="true"
              />
              <span class="epstats__bar-label">{cajon.score}</span>
              <span class="visually-hidden">
                {cajon.count} {cajon.count === 1 ? 'capítulo' : 'capítulos'} con un {cajon.score}
              </span>
              <span class="epstats__bar-count" aria-hidden="true">
                {cajon.count || ''}
              </span>
            </li>
          ))}
        </ol>
        <p class="epstats__chart-foot">
          Notas redondeadas al entero. La escala va de 0 a {MAX_SCORE_HALF / 2}.
        </p>
      </figure>
    </div>
  );
};
