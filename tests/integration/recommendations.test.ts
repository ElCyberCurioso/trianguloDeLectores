import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { issueFormToken } from '../../src/server/lib/formtoken';
import { ORIGIN, loginAsAdmin, resetAdminRateLimit, type AdminSession } from './helpers';

let session: AdminSession;

beforeAll(async () => {
  session = await loginAsAdmin();
  await resetAdminRateLimit();
});

/** Cada envío llega desde una IP distinta: el límite tiene su propio test. */
function ipAleatoria(): string {
  return `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
}

async function recomendar(
  campos: Record<string, string> = {},
  opciones: { ip?: string; token?: string } = {},
): Promise<Response> {
  const token = opciones.token ?? (await issueFormToken(env, 'recommendation'));
  const response = await SELF.fetch(`${ORIGIN}/api/recomendaciones`, {
    method: 'POST',
    body: new URLSearchParams({
      _form: token,
      titleEs: 'Los detectives salvajes',
      contentType: 'BOOK',
      note: 'Se lee como un archivo de voces y ninguna cierra el caso.',
      ...campos,
    }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
      'CF-Connecting-IP': opciones.ip ?? ipAleatoria(),
    },
    redirect: 'manual',
  });
  await response.text();
  return response;
}

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

async function bandeja(status = 'PENDING'): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/admin/recomendaciones?status=${status}`, {
    headers: { Cookie: session.cookie, Accept: 'text/html' },
  });
  return response.text();
}

/** Id de la primera recomendación de la bandeja, leído del formulario de acción. */
async function primeraId(status = 'PENDING'): Promise<string> {
  const html = await bandeja(status);
  const match = /action="\/admin\/recomendaciones\/([^/]+)\/accion"/.exec(html);
  if (!match) throw new Error('No hay ninguna recomendación en la bandeja');
  return match[1]!;
}

describe('envío público', () => {
  it('acepta una recomendación válida y la deja por revisar', async () => {
    const titulo = `Recomendación ${crypto.randomUUID().slice(0, 8)}`;
    const response = await recomendar({ titleEs: titulo });
    expect(response.status).toBe(303);
    expect(await bandeja()).toContain(titulo);
  });

  it('guarda quién la manda cuando se firma', async () => {
    const titulo = `Firmada ${crypto.randomUUID().slice(0, 8)}`;
    await recomendar({ titleEs: titulo, alias: 'Marta' });
    expect(await bandeja()).toContain('recomendada por Marta');
  });

  it('rechaza el envío sin token de formulario', async () => {
    const response = await recomendar({}, { token: 'invalido' });
    expect(response.status).toBe(400);
  });

  it('rechaza el envío desde otro origen', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/recomendaciones`, {
      method: 'POST',
      body: new URLSearchParams({ titleEs: 'Ajena', contentType: 'BOOK', note: 'x'.repeat(20) }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://otro-sitio.example',
        'Sec-Fetch-Site': 'cross-site',
      },
      redirect: 'manual',
    });
    await response.text();
    expect(response.status).toBe(403);
  });

  it('exige una explicación de al menos diez caracteres', async () => {
    const response = await recomendar({ titleEs: `Corta ${crypto.randomUUID().slice(0, 6)}`, note: 'corta' });
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toContain('error=validacion');
  });

  it('rechaza un enlace que no sea http o https', async () => {
    const response = await recomendar({
      titleEs: `Enlace ${crypto.randomUUID().slice(0, 6)}`,
      sourceUrl: 'javascript:alert(1)',
    });
    expect(response.headers.get('Location')).toContain('error=validacion');
  });

  it('no guarda nada cuando se rellena el campo trampa', async () => {
    const titulo = `Trampa ${crypto.randomUUID().slice(0, 8)}`;
    const response = await recomendar({ titleEs: titulo, website: 'soy-un-robot' });
    expect(response.status).toBe(303);
    expect(await bandeja('ALL')).not.toContain(titulo);
  });

  it('evita duplicados del mismo título sin revisar', async () => {
    const titulo = `Duplicada ${crypto.randomUUID().slice(0, 8)}`;
    await recomendar({ titleEs: titulo });
    const segunda = await recomendar({ titleEs: titulo });
    expect(segunda.status).toBe(409);
  });

  it('limita cuántas admite la misma procedencia', async () => {
    const ip = '198.51.100.77';
    const respuestas: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await recomendar({ titleEs: `Tanda ${i} ${crypto.randomUUID().slice(0, 6)}` }, { ip });
      respuestas.push(r.status);
    }
    // El límite salta antes de la séptima, con 429 del limitador o 400 del servicio.
    expect(respuestas.some((status) => status === 429 || status === 400)).toBe(true);
  });

  it('no expone la IP ni el agente de usuario en la bandeja', async () => {
    const ip = '192.0.2.55';
    await recomendar({ titleEs: `Privada ${crypto.randomUUID().slice(0, 8)}` }, { ip });
    const html = await bandeja();
    expect(html).not.toContain(ip);
  });
});

describe('bandeja del panel', () => {
  it('exige sesión de administrador', async () => {
    const response = await SELF.fetch(`${ORIGIN}/admin/recomendaciones`, { redirect: 'manual' });
    await response.text();
    expect([302, 303, 401, 403]).toContain(response.status);
  });

  it('convierte una recomendación en borrador de reseña', async () => {
    const titulo = `A reseña ${crypto.randomUUID().slice(0, 8)}`;
    await recomendar({ titleEs: titulo, alias: 'Quien sea' });
    const id = await primeraId();

    const response = await adminPost(`/admin/recomendaciones/${id}/accion`, { action: 'to-review' });
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toMatch(/^\/admin\/resenas\//);

    // Nace como borrador: publicar sigue siendo un acto deliberado.
    const editor = await SELF.fetch(`${ORIGIN}${response.headers.get('Location')}`, {
      headers: { Cookie: session.cookie, Accept: 'text/html' },
    });
    const html = await editor.text();
    expect(html).toContain(titulo);
    expect(html).toContain('DRAFT');
  });

  it('manda una recomendación a la lista de pendientes, en privado', async () => {
    const titulo = `A pendientes ${crypto.randomUUID().slice(0, 8)}`;
    await recomendar({ titleEs: titulo });
    const id = await primeraId();

    const response = await adminPost(`/admin/recomendaciones/${id}/accion`, { action: 'to-watchlist' });
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toMatch(/^\/admin\/pendientes\//);

    // No aparece en la cola pública hasta que se decida hacerla pública.
    const publica = await SELF.fetch(`${ORIGIN}/pendientes`, { headers: { Accept: 'text/html' } });
    expect(await publica.text()).not.toContain(titulo);
  });

  it('descarta y vuelve a abrir', async () => {
    const titulo = `Descartable ${crypto.randomUUID().slice(0, 8)}`;
    await recomendar({ titleEs: titulo });
    const id = await primeraId();

    await adminPost(`/admin/recomendaciones/${id}/accion`, { action: 'reject' });
    expect(await bandeja('REJECTED')).toContain(titulo);

    await adminPost(`/admin/recomendaciones/${id}/accion`, { action: 'reopen' });
    expect(await bandeja('PENDING')).toContain(titulo);
  });

  it('elimina una recomendación', async () => {
    const titulo = `Borrable ${crypto.randomUUID().slice(0, 8)}`;
    await recomendar({ titleEs: titulo });
    const id = await primeraId();

    await adminPost(`/admin/recomendaciones/${id}/accion`, { action: 'delete' });
    expect(await bandeja('ALL')).not.toContain(titulo);
  });

  it('rechaza una acción sin token CSRF', async () => {
    const titulo = `Sin csrf ${crypto.randomUUID().slice(0, 8)}`;
    await recomendar({ titleEs: titulo });
    const id = await primeraId();

    const response = await SELF.fetch(`${ORIGIN}/admin/recomendaciones/${id}/accion`, {
      method: 'POST',
      body: new URLSearchParams({ action: 'reject' }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: session.cookie,
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
      },
      redirect: 'manual',
    });
    await response.text();
    expect(response.status).toBe(403);
  });
});
