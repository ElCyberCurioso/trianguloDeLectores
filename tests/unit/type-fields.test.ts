import { describe, it, expect } from 'vitest';
import { WatchlistForm, EMPTY_WATCHLIST_DRAFT, type WatchlistDraft } from '../../src/server/views/components/watchlist-form';
import { ReviewEditorPage } from '../../src/server/views/admin/review-editor';
import type { ReviewDetail } from '../../src/db/repos/reviews';
import type { ContentType } from '../../src/types/domain';
import type { Bindings } from '../../src/types/env';

/**
 * Lo que se pinta y lo que no según el tipo de contenido.
 *
 * «Temporadas» y «Episodios» sólo aplican a series y anime, «Volúmenes» a
 * cómics y mangas, y el «o periodo» del año a lo que se emite por entregas. La
 * isla de cliente los destapa al cambiar el desplegable, pero quien llega sin
 * JavaScript ve exactamente lo que decida este render: por eso se comprueba
 * aquí y no sólo en el navegador. Los dos formularios que llevan esos campos
 * —la ficha de un pendiente y la de una reseña— se comprueban igual.
 */
const env = { IMAGE_RESIZING: 'false', SITE_URL: 'https://example.test' } as unknown as Bindings;

/** Cada bloque que depende del tipo, con su atributo `hidden` si lo lleva. */
function marcas(html: string): string[] {
  return [...html.matchAll(/<[a-z]+[^>]*data-types-only[^>]*>/g)].map((m) => m[0]);
}

/** El bloque cuya lista de tipos es exactamente ésta. */
function bloque(html: string, tipos: string): string | undefined {
  return marcas(html).find((b) => b.includes(`data-types-only="${tipos}"`));
}

const SERIALES = 'SERIES ANIME';
const TOMOS = 'COMIC MANGA';

// ------------------------------------------------------------- pendientes --
function renderPendiente(item: Partial<WatchlistDraft>, errors: Record<string, string> = {}): string {
  return WatchlistForm({
    env,
    item: { ...EMPTY_WATCHLIST_DRAFT, ...item },
    categories: [],
    csrfToken: 'x',
    action: '/pendientes/nuevo',
    submitLabel: 'Añadir',
    cancelHref: '/pendientes',
    errors,
    // Nunca es nulo: el componente siempre devuelve el formulario.
  })!.toString();
}

describe('WatchlistForm — campos por tipo', () => {
  it('tapa temporadas y el «o periodo» en lo que no se emite por temporadas', () => {
    const html = renderPendiente({ contentType: 'MOVIE' });
    const bloques = marcas(html);
    expect(bloques).toHaveLength(3);
    expect(bloques.every((b) => b.includes('hidden'))).toBe(true);
    // El año se queda: una película también tiene el suyo.
    expect(html).toContain('name="year"');
    expect(html).toContain('placeholder="2019"');
  });

  it('los destapa en serie y en anime', () => {
    for (const contentType of ['SERIES', 'ANIME'] as const) {
      const bloques = marcas(renderPendiente({ contentType }));
      expect(bloques).toHaveLength(3);
      expect(bloques.some((b) => b.includes('hidden'))).toBe(false);
    }
    expect(renderPendiente({ contentType: 'SERIES' })).toContain('placeholder="2020-2022"');
  });

  it('cada campo declara los tipos en los que sale, para la isla', () => {
    expect(bloque(renderPendiente({}), SERIALES)).toBeDefined();
  });

  it('un error en temporadas deja el campo a la vista aunque el tipo no aplique', () => {
    const html = renderPendiente({ contentType: 'MOVIE' }, { seasons: 'Número inválido' });
    const seasons = marcas(html).find((b) => b.includes('data-keep-visible'));
    expect(seasons).toBeDefined();
    expect(seasons).not.toContain('hidden');
    expect(html).toContain('Número inválido');
  });
});

// ----------------------------------------------------------------- reseñas --
function renderResena(contentType: ContentType | null, errors: Record<string, string> = {}): string {
  // Nulo es el alta: no hay ficha todavía y manda el primer tipo de la lista.
  const review = contentType === null
    ? null
    : ({
        id: 'r1',
        slug: 'ficha',
        contentType,
        titleEs: 'Ficha',
        otherTitles: [],
        genres: [],
        platforms: [],
        seasons: null,
        year: null,
        yearEnd: null,
        yearOngoing: 0,
        status: 'DRAFT',
        commentsMode: 'OPEN',
      } as unknown as ReviewDetail);

  return ReviewEditorPage({
    env,
    review,
    categories: [],
    genres: [],
    platforms: [],
    csrfToken: 'x',
    errors,
  })!.toString();
}

describe('ReviewEditorPage — campos por tipo', () => {
  it('en el alta arranca por el primer tipo de la lista, que no lleva ninguno', () => {
    const bloques = marcas(renderResena(null));
    expect(bloques).toHaveLength(5);
    expect(bloques.every((b) => b.includes('hidden'))).toBe(true);
  });

  it('en serie y anime salen temporadas y episodios, nunca volúmenes', () => {
    for (const contentType of ['SERIES', 'ANIME'] as const) {
      const html = renderResena(contentType);
      expect(bloque(html, SERIALES)).not.toContain('hidden');
      expect(bloque(html, TOMOS)).toContain('hidden');
      expect(marcas(html).filter((b) => b.includes('hidden'))).toHaveLength(1);
      expect(html).toContain('placeholder="2020-2022"');
    }
  });

  it('en cómic y manga salen volúmenes, nunca temporadas ni episodios', () => {
    for (const contentType of ['COMIC', 'MANGA'] as const) {
      const html = renderResena(contentType);
      expect(bloque(html, TOMOS)).not.toContain('hidden');
      // Los tres bloques seriales —el «o periodo», su pista y los dos campos—
      // se quedan tapados: un manga no se emite por temporadas.
      expect(marcas(html).filter((b) => b.includes('hidden'))).toHaveLength(4);
      expect(html).toContain('placeholder="2019"');
    }
  });

  it('en una película no sale ninguno de los tres', () => {
    const bloques = marcas(renderResena('MOVIE'));
    expect(bloques).toHaveLength(5);
    expect(bloques.every((b) => b.includes('hidden'))).toBe(true);
  });

  it('un error deja el campo a la vista aunque el tipo no aplique', () => {
    for (const [campo, tipos] of [['seasons', SERIALES], ['episodes', SERIALES], ['volumes', TOMOS]] as const) {
      const html = renderResena('MOVIE', { [campo]: 'Número inválido' });
      const visible = marcas(html).find((b) => b.includes('data-keep-visible'));
      expect(visible, campo).toBeDefined();
      expect(visible, campo).toContain(`data-types-only="${tipos}"`);
      expect(visible, campo).not.toContain('hidden');
    }
  });
});
