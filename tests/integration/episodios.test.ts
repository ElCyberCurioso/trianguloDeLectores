import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { ORIGIN, loginAsAdmin, resetAdminRateLimit, createReview, type AdminSession } from './helpers';

let session: AdminSession;

beforeAll(async () => {
  session = await loginAsAdmin();
  await resetAdminRateLimit();
});

async function adminPost(path: string, fields: Record<string, string>): Promise<Response> {
  const response = await SELF.fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    body: new URLSearchParams({ _csrf: session.csrf, ...fields }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: session.cookie,
      Origin: ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
    },
    redirect: 'manual',
  });
  await response.text();
  return response;
}

async function crearSerie(title: string) {
  return createReview(session, {
    title,
    extra: { contentType: 'SERIES', year: '2020-2022', seasons: '2' },
  });
}

describe('periodo de años y temporadas', () => {
  it('guarda el periodo en sus tres campos', async () => {
    const { id } = await crearSerie('Serie con periodo');

    const row = await env.DB.prepare('SELECT year, year_end, year_ongoing, seasons FROM reviews WHERE id = ?')
      .bind(id)
      .first<{ year: number; year_end: number; year_ongoing: number; seasons: number }>();

    expect(row!.year).toBe(2020);
    expect(row!.year_end).toBe(2022);
    expect(row!.year_ongoing).toBe(0);
    expect(row!.seasons).toBe(2);
  });

  it('«actualidad» se guarda como periodo abierto, no como el año en curso', async () => {
    const { id } = await createReview(session, {
      title: 'Serie en emisión',
      extra: { contentType: 'ANIME', year: '2023-actualidad' },
    });

    const row = await env.DB.prepare('SELECT year, year_end, year_ongoing FROM reviews WHERE id = ?')
      .bind(id)
      .first<{ year: number; year_end: number | null; year_ongoing: number }>();

    expect(row!.year).toBe(2023);
    expect(row!.year_end).toBeNull();
    expect(row!.year_ongoing).toBe(1);
  });

  it('el periodo se pinta en la ficha pública', async () => {
    const { slug } = await crearSerie('Serie que se pinta');
    const html = await (await SELF.fetch(`${ORIGIN}/resena/${slug}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain('2020–2022');
  });
});

describe('notas por temporada y capítulo', () => {
  it('da de alta un capítulo y lo enseña en la ficha pública', async () => {
    const { id, slug } = await crearSerie('Serie con capítulos');

    const alta = await adminPost(`/admin/resenas/${id}/episodios`, {
      season: '1',
      episode: '1',
      title: 'El primero',
      ratingHalf: '17',
      note: 'Arranca bien.',
    });
    expect(alta.status).toBe(303);

    const html = await (await SELF.fetch(`${ORIGIN}/resena/${slug}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain('El primero');
    expect(html).toContain('Arranca bien.');
    expect(html).toContain('Temporada 1');
  });

  it('la nota en blanco es «sin nota», no un cero', async () => {
    const { id } = await crearSerie('Serie sin nota');
    await adminPost(`/admin/resenas/${id}/episodios`, { season: '1', episode: '3', ratingHalf: '' });

    const row = await env.DB.prepare('SELECT rating_half FROM review_episodes WHERE review_id = ? AND episode = 3')
      .bind(id)
      .first<{ rating_half: number | null }>();
    expect(row!.rating_half).toBeNull();
  });

  it('no deja repetir temporada y capítulo', async () => {
    const { id } = await crearSerie('Serie con duplicado');
    await adminPost(`/admin/resenas/${id}/episodios`, { season: '2', episode: '4', ratingHalf: '16' });

    const repetido = await adminPost(`/admin/resenas/${id}/episodios`, { season: '2', episode: '4', ratingHalf: '10' });
    expect(repetido.status).toBe(409);

    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM review_episodes WHERE review_id = ?')
      .bind(id)
      .first<{ n: number }>();
    expect(total!.n).toBe(1);
  });

  it('el capítulo 0 es la temporada entera y convive con sus capítulos', async () => {
    const { id } = await crearSerie('Serie con ficha de temporada');
    await adminPost(`/admin/resenas/${id}/episodios`, { season: '1', episode: '0', ratingHalf: '18', note: 'Gran temporada.' });
    const capitulo = await adminPost(`/admin/resenas/${id}/episodios`, { season: '1', episode: '1', ratingHalf: '14' });
    expect(capitulo.status).toBe(303);

    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM review_episodes WHERE review_id = ? AND season = 1')
      .bind(id)
      .first<{ n: number }>();
    expect(total!.n).toBe(2);
  });

  it('un episodio no se puede tocar desde otra reseña', async () => {
    const propia = await crearSerie('Serie propietaria');
    const ajena = await crearSerie('Serie ajena');
    await adminPost(`/admin/resenas/${propia.id}/episodios`, { season: '1', episode: '9', ratingHalf: '12' });

    const fila = await env.DB.prepare('SELECT id FROM review_episodes WHERE review_id = ? AND episode = 9')
      .bind(propia.id)
      .first<{ id: string }>();

    // El id de la reseña va siempre en el WHERE: conocer el id del episodio no
    // basta para borrarlo desde otra ficha.
    const intento = await adminPost(`/admin/resenas/${ajena.id}/episodios/${fila!.id}/borrar`, {});
    expect(intento.status).toBe(404);

    const sigue = await env.DB.prepare('SELECT COUNT(*) AS n FROM review_episodes WHERE id = ?')
      .bind(fila!.id)
      .first<{ n: number }>();
    expect(sigue!.n).toBe(1);
  });

  it('borra un episodio de su propia reseña', async () => {
    const { id } = await crearSerie('Serie con borrado');
    await adminPost(`/admin/resenas/${id}/episodios`, { season: '1', episode: '7', ratingHalf: '12' });
    const fila = await env.DB.prepare('SELECT id FROM review_episodes WHERE review_id = ? AND episode = 7')
      .bind(id)
      .first<{ id: string }>();

    const borrado = await adminPost(`/admin/resenas/${id}/episodios/${fila!.id}/borrar`, {});
    expect(borrado.status).toBe(303);

    const sigue = await env.DB.prepare('SELECT COUNT(*) AS n FROM review_episodes WHERE id = ?')
      .bind(fila!.id)
      .first<{ n: number }>();
    expect(sigue!.n).toBe(0);
  });

  it('los episodios se van con la reseña al borrarla', async () => {
    const { id } = await crearSerie('Serie que se borra');
    await adminPost(`/admin/resenas/${id}/episodios`, { season: '1', episode: '1', ratingHalf: '12' });

    // Borrado duro en la base: lo que se comprueba es el ON DELETE CASCADE.
    await env.DB.prepare('DELETE FROM reviews WHERE id = ?').bind(id).run();

    const quedan = await env.DB.prepare('SELECT COUNT(*) AS n FROM review_episodes WHERE review_id = ?')
      .bind(id)
      .first<{ n: number }>();
    expect(quedan!.n).toBe(0);
  });

  it('la ficha pública enseña la media y el reparto de notas', async () => {
    const { id, slug } = await crearSerie('Serie con estadísticas');
    await adminPost(`/admin/resenas/${id}/episodios`, { season: '1', episode: '1', ratingHalf: '16' });
    await adminPost(`/admin/resenas/${id}/episodios`, { season: '1', episode: '2', ratingHalf: '14' });

    const html = await (await SELF.fetch(`${ORIGIN}/resena/${slug}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).toContain('Media de los capítulos');
    // 16 y 14 medios puntos son 8,0 y 7,0: la media es 7,5.
    expect(html).toContain('7,5');
    expect(html).toContain('epstats__bars');
  });

  it('una reseña sin episodios no pinta la sección', async () => {
    const { slug } = await createReview(session, { title: 'Película sin capítulos' });
    const html = await (await SELF.fetch(`${ORIGIN}/resena/${slug}`, { headers: { Accept: 'text/html' } })).text();
    expect(html).not.toContain('Temporada a temporada');
  });
});

describe('resumen de la reseña', () => {
  it('acepta un resumen largo', async () => {
    const largo = 'a'.repeat(3000);
    const { id } = await createReview(session, { title: 'Reseña con resumen largo', extra: { summary: largo } });

    const row = await env.DB.prepare('SELECT summary FROM reviews WHERE id = ?').bind(id)
      .first<{ summary: string }>();
    expect(row!.summary).toHaveLength(3000);
  });
});
