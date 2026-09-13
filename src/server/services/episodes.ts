import type { Container } from './container';
import type { EpisodeInput } from '../../validation/schemas';
import type { SessionUser } from '../lib/auth';
import { notFound, conflict } from '../lib/http';
import { invalidatePublicContent } from '../lib/cache';

/**
 * Notas por temporada y por capítulo.
 *
 * La nota de la reseña sigue siendo la de la obra entera y **no se recalcula**
 * con esto: una serie puede tener una media de 7,2 y merecer un 9 por lo que es
 * en conjunto, y al revés. Lo que aportan los episodios es el detalle —qué
 * temporada levanta y cuál se cae—, que es justo lo que una nota sola no puede
 * decir. Mezclarlos convertiría la opinión en un promedio.
 */
export class EpisodeService {
  constructor(private readonly c: Container) {}

  /**
   * Da de alta o actualiza una fila.
   *
   * `id` nulo es un alta. La pareja temporada/capítulo es única por reseña, así
   * que se comprueba antes: el índice lo impediría igual, pero un error de
   * restricción llega al formulario como un 500 sin decir qué pasa, y aquí se
   * puede decir «esa temporada y ese capítulo ya están».
   */
  async save(reviewId: string, id: string | null, input: EpisodeInput, actor: SessionUser): Promise<string> {
    const review = await this.c.reviews.getById(reviewId, { includeDrafts: true });
    if (!review) throw notFound('La reseña no existe');

    const repetido = await this.c.episodes.find(reviewId, input.season, input.episode);
    if (repetido && repetido.id !== id) {
      throw conflict(
        'episode_exists',
        input.episode === 0
          ? `La temporada ${input.season} ya tiene su ficha`
          : `El capítulo ${input.season}×${input.episode} ya está anotado`,
      );
    }

    const now = Date.now();
    const valores = {
      season: input.season,
      episode: input.episode,
      title: input.title ?? null,
      // Nulo es «sin nota todavía», que no es lo mismo que un cero.
      ratingHalf: input.ratingHalf ?? null,
      note: input.note ?? null,
      hasSpoilers: input.hasSpoilers ? 1 : 0,
      updatedAt: now,
    };

    if (id) {
      const existente = await this.c.episodes.getById(reviewId, id);
      if (!existente) throw notFound('Ese episodio no existe');
      await this.c.episodes.update(reviewId, id, valores);
    } else {
      id = crypto.randomUUID();
      await this.c.episodes.insert({ id, reviewId, ...valores, createdAt: now });
    }

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'review.episode',
      entityType: 'review',
      entityId: reviewId,
      metadata: { season: input.season, episode: input.episode },
    });

    // La ficha pública de la reseña enseña las estadísticas: si no se invalida,
    // el capítulo nuevo no aparece hasta que caduque la copia del borde.
    if (review.status === 'PUBLISHED') await invalidatePublicContent(this.c.env);
    return id;
  }

  async remove(reviewId: string, id: string, actor: SessionUser): Promise<void> {
    const existente = await this.c.episodes.getById(reviewId, id);
    if (!existente) throw notFound('Ese episodio no existe');

    await this.c.episodes.remove(reviewId, id);

    await this.c.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'review.episode.delete',
      entityType: 'review',
      entityId: reviewId,
      metadata: { season: existente.season, episode: existente.episode },
    });

    await invalidatePublicContent(this.c.env);
  }
}
