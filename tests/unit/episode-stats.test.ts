import { describe, it, expect } from 'vitest';
import { computeEpisodeStats } from '../../src/server/lib/episode-stats';
import type { EpisodeRow } from '../../src/db/repos/episodes';

/** Una fila con lo justo: al resto de campos no les mira nadie aquí. */
function fila(season: number, episode: number, ratingHalf: number | null, title = ''): EpisodeRow {
  return {
    id: `${season}-${episode}`,
    reviewId: 'r1',
    season,
    episode,
    title: title || null,
    ratingHalf,
    note: null,
    hasSpoilers: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('computeEpisodeStats', () => {
  it('sin episodios no inventa cuentas', () => {
    const stats = computeEpisodeStats([]);
    expect(stats.total).toBe(0);
    expect(stats.rated).toBe(0);
    expect(stats.averageHalf).toBeNull();
    expect(stats.best).toBeNull();
    expect(stats.seasons).toEqual([]);
  });

  it('promedia sólo los capítulos con nota', () => {
    const stats = computeEpisodeStats([
      fila(1, 1, 16),
      fila(1, 2, 14),
      fila(1, 3, null),
    ]);
    expect(stats.total).toBe(3);
    expect(stats.rated).toBe(2);
    expect(stats.averageHalf).toBe(15);
  });

  it('la nota de la temporada entera no entra en la media de capítulos', () => {
    // La fila `episode` 0 es la temporada, no un capítulo: si contara, un 10 a
    // la temporada subiría la media de sus propios episodios.
    const stats = computeEpisodeStats([
      fila(1, 0, 20),
      fila(1, 1, 10),
      fila(1, 2, 10),
    ]);
    expect(stats.total).toBe(2);
    expect(stats.averageHalf).toBe(10);
    expect(stats.seasons[0]!.seasonHalf).toBe(20);
    expect(stats.seasons[0]!.total).toBe(2);
  });

  it('separa las temporadas y las ordena', () => {
    const stats = computeEpisodeStats([
      fila(2, 1, 20),
      fila(1, 1, 10),
      fila(1, 2, 12),
    ]);
    expect(stats.seasons.map((s) => s.season)).toEqual([1, 2]);
    expect(stats.seasons[0]!.averageHalf).toBe(11);
    expect(stats.seasons[1]!.averageHalf).toBe(20);
  });

  it('encuentra el mejor y el peor', () => {
    const stats = computeEpisodeStats([
      fila(1, 1, 12),
      fila(1, 2, 19, 'El bueno'),
      fila(2, 4, 4, 'El malo'),
    ]);
    expect(stats.best?.title).toBe('El bueno');
    expect(stats.worst?.title).toBe('El malo');
  });

  it('el empate lo rompe el orden de emisión, siempre igual', () => {
    const filas = [fila(2, 5, 18, 'segundo'), fila(1, 1, 18, 'primero')];
    expect(computeEpisodeStats(filas).best?.title).toBe('primero');
    // Al revés da lo mismo: el criterio no depende del orden de entrada.
    expect(computeEpisodeStats([...filas].reverse()).best?.title).toBe('primero');
  });

  it('reparte las notas en once cajones, de 0 a 10', () => {
    const stats = computeEpisodeStats([
      fila(1, 1, 20),
      fila(1, 2, 15),
      fila(1, 3, 16),
    ]);
    expect(stats.distribution).toHaveLength(11);
    expect(stats.distribution[10]!.count).toBe(1);
    // 15 medios puntos son 7,5, que redondea a 8, igual que 16.
    expect(stats.distribution[8]!.count).toBe(2);
    expect(stats.distribution[0]!.count).toBe(0);
  });
});
