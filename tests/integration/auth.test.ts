import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { ORIGIN, ADMIN_EMAIL, ADMIN_PASSWORD, seedBaseData, loginAsAdmin } from './helpers';

async function attemptLogin(email: string, password: string, headers: Record<string, string> = {}) {
  return SELF.fetch(`${ORIGIN}/admin/login`, {
    method: 'POST',
    body: new URLSearchParams({ email, password }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
      // IP distinta por intento: aquí se prueba el bloqueo *de cuenta*, no el
      // rate limit por IP (que tiene sus propios tests).
      'CF-Connecting-IP': `203.0.113.${Math.floor(Math.random() * 250) + 1}`,
      ...headers,
    },
    redirect: 'manual',
  });
}

beforeAll(async () => {
  await seedBaseData();
});

describe('login', () => {
  it('acepta credenciales correctas y emite cookie segura', async () => {
    const response = await attemptLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(response.status).toBe(303);

    const cookie = response.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
  });

  it('rechaza la contraseña incorrecta', async () => {
    const response = await attemptLogin(ADMIN_EMAIL, 'ContraseñaEquivocada1');
    expect(response.status).toBe(401);
    expect(response.headers.get('Set-Cookie') ?? '').not.toContain('tdl_session=');
  });

  it('no revela si el usuario existe', async () => {
    const desconocido = await attemptLogin('nadie@test.local', 'LoQueSea123456');
    const conocido = await attemptLogin(ADMIN_EMAIL, 'LoQueSea123456');
    expect(desconocido.status).toBe(conocido.status);
    expect(await desconocido.text()).toContain('Credenciales incorrectas');
  });

  it('la cookie de sesión no contiene el identificador que se guarda en D1', async () => {
    const response = await attemptLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
    const token = /tdl_session=([^;]+)/.exec(response.headers.get('Set-Cookie') ?? '')?.[1];
    const stored = await env.DB.prepare('SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1').first<{ id: string }>();
    expect(token).toBeTruthy();
    // En base de datos vive SHA-256(token), nunca el token.
    expect(stored!.id).not.toBe(token);
    expect(stored!.id).toHaveLength(64);
  });

  it('rota la sesión al autenticar (anti session fixation)', async () => {
    const primera = await attemptLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
    const tokenA = /tdl_session=([^;]+)/.exec(primera.headers.get('Set-Cookie') ?? '')?.[1];

    const segunda = await attemptLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
    const tokenB = /tdl_session=([^;]+)/.exec(segunda.headers.get('Set-Cookie') ?? '')?.[1];

    expect(tokenA).not.toBe(tokenB);

    // La sesión anterior deja de valer.
    const conAntigua = await SELF.fetch(`${ORIGIN}/admin`, {
      headers: { Cookie: `tdl_session=${tokenA}`, Accept: 'text/html' },
      redirect: 'manual',
    });
    expect(conAntigua.status).toBe(302);
  });

  it('registra el intento fallido en auditoría sin guardar la contraseña', async () => {
    await attemptLogin(ADMIN_EMAIL, 'OtraMalisima123');
    const row = await env.DB.prepare(
      "SELECT action, metadata FROM audit_log WHERE action = 'auth.login.failure' ORDER BY created_at DESC LIMIT 1",
    ).first<{ action: string; metadata: string }>();
    expect(row?.action).toBe('auth.login.failure');
    expect(row?.metadata ?? '').not.toContain('OtraMalisima123');
  });

  it('bloquea la cuenta tras varios fallos consecutivos', async () => {
    const email = `bloqueo-${crypto.randomUUID()}@test.local`;
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO users (id, email, email_norm, password_hash, display_name, role, status,
                          failed_logins, locked_until, created_at, updated_at)
       VALUES (?, ?, ?, 'pbkdf2$sha256$1000$AAAA$AAAA', 'Test', 'ADMIN', 'ACTIVE', 0, NULL, ?, ?)`,
    ).bind(crypto.randomUUID(), email, email, now, now).run();

    for (let i = 0; i < 5; i++) await attemptLogin(email, 'FalloRepetido123');

    const row = await env.DB.prepare('SELECT failed_logins, locked_until FROM users WHERE email_norm = ?')
      .bind(email)
      .first<{ failed_logins: number; locked_until: number | null }>();

    expect(row!.failed_logins).toBeGreaterThanOrEqual(5);
    expect(row!.locked_until).toBeGreaterThan(Date.now());
  });
});

describe('CSRF', () => {
  it('rechaza POST del panel sin token', async () => {
    const session = await loginAsAdmin();
    const response = await SELF.fetch(`${ORIGIN}/admin/logout`, {
      method: 'POST',
      headers: {
        Cookie: session.cookie,
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({}),
      redirect: 'manual',
    });
    expect(response.status).toBe(403);
  });

  it('rechaza POST con token CSRF incorrecto', async () => {
    const session = await loginAsAdmin();
    const response = await SELF.fetch(`${ORIGIN}/admin/logout`, {
      method: 'POST',
      headers: {
        Cookie: session.cookie,
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ _csrf: 'token-invalido' }),
      redirect: 'manual',
    });
    expect(response.status).toBe(403);
  });

  it('rechaza POST desde otro origen aunque lleve token válido', async () => {
    const session = await loginAsAdmin();
    const response = await SELF.fetch(`${ORIGIN}/admin/logout`, {
      method: 'POST',
      headers: {
        Cookie: session.cookie,
        Origin: 'https://sitio-malicioso.example',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ _csrf: session.csrf }),
      redirect: 'manual',
    });
    expect(response.status).toBe(403);
  });

  it('acepta POST con token y origen correctos', async () => {
    const session = await loginAsAdmin();
    const response = await SELF.fetch(`${ORIGIN}/admin/logout`, {
      method: 'POST',
      headers: {
        Cookie: session.cookie,
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ _csrf: session.csrf }),
      redirect: 'manual',
    });
    expect(response.status).toBe(303);
  });
});

describe('logout', () => {
  it('invalida la sesión en base de datos', async () => {
    const session = await loginAsAdmin();
    await SELF.fetch(`${ORIGIN}/admin/logout`, {
      method: 'POST',
      headers: {
        Cookie: session.cookie,
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ _csrf: session.csrf }),
      redirect: 'manual',
    });

    const response = await SELF.fetch(`${ORIGIN}/admin`, {
      headers: { Cookie: session.cookie, Accept: 'text/html' },
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
  });
});
