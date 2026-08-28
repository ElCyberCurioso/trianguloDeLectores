#!/usr/bin/env node
/**
 * Crea (o actualiza) un usuario ADMIN en D1.
 *
 * La contraseña NUNCA llega al repositorio ni al historial del shell: se pide
 * por stdin con el eco desactivado. El hash se genera con el mismo formato
 * PBKDF2 que verifica el Worker (`src/server/lib/crypto.ts`).
 *
 *   npm run admin:create                    # base de datos local
 *   npm run admin:create -- --env staging   # staging (remoto)
 *   npm run admin:create -- --env production
 */
import { createInterface } from 'node:readline';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Writable } from 'node:stream';

// Debe coincidir con PBKDF2_ITERATIONS: Workers no verifica más de 100.000.
const ITERATIONS = 100_000;
// El binding vale en los tres entornos; el nombre de la base, no.
const DB_NAME = 'DB';

const args = process.argv.slice(2);
const envIndex = args.indexOf('--env');
const targetEnv = envIndex >= 0 ? args[envIndex + 1] : null;
const isLocal = args.includes('--local') || !targetEnv;

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Pregunta silenciando la salida: nada de la contraseña aparece en pantalla. */
function askHidden(question) {
  return new Promise((resolve) => {
    let muted = false;
    const muteStream = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) process.stdout.write(chunk, encoding);
        callback();
      },
    });
    const rl = createInterface({ input: process.stdin, output: muteStream, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
    muted = true;
  });
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
  return `pbkdf2$sha256$${ITERATIONS}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/** Escapa comillas simples del literal SQL. Los valores son locales, no de red. */
const q = (value) => `'${String(value).replace(/'/g, "''")}'`;

const email = process.env.ADMIN_EMAIL ?? (await ask('Email del administrador: '));
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Email no válido.');
  process.exit(1);
}

const displayName = process.env.ADMIN_NAME ?? ((await ask('Nombre visible [Administración]: ')) || 'Administración');
const password = process.env.ADMIN_PASSWORD ?? (await askHidden('Contraseña (mínimo 12 caracteres): '));

if (password.length < 12) {
  console.error('La contraseña debe tener al menos 12 caracteres.');
  process.exit(1);
}
if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
  console.error('La contraseña debe incluir mayúsculas, minúsculas y números.');
  process.exit(1);
}

const now = Date.now();
const emailNorm = email.toLowerCase();
const sql = `
INSERT INTO users (id, email, email_norm, password_hash, display_name, role, status,
                   failed_logins, locked_until, last_login_at, created_at, updated_at)
VALUES (${q(randomUUID())}, ${q(email)}, ${q(emailNorm)}, ${q(hashPassword(password))},
        ${q(displayName)}, 'ADMIN', 'ACTIVE', 0, NULL, NULL, ${now}, ${now})
ON CONFLICT(email_norm) DO UPDATE SET
  password_hash = excluded.password_hash,
  display_name  = excluded.display_name,
  role          = 'ADMIN',
  status        = 'ACTIVE',
  failed_logins = 0,
  locked_until  = NULL,
  updated_at    = ${now};

-- Cambiar la contraseña invalida cualquier sesión abierta.
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email_norm = ${q(emailNorm)});
`;

const dir = mkdtempSync(join(tmpdir(), 'tdl-admin-'));
const file = join(dir, 'create-admin.sql');
writeFileSync(file, sql, { mode: 0o600 });

const wranglerArgs = ['wrangler', 'd1', 'execute', DB_NAME];
if (isLocal) wranglerArgs.push('--local');
else wranglerArgs.push('--env', targetEnv, '--remote');
wranglerArgs.push('--file', file);

console.log(`\nEjecutando: npx ${wranglerArgs.join(' ')}\n`);
const result = spawnSync('npx', wranglerArgs, { stdio: 'inherit' });
unlinkSync(file);

if (result.status !== 0) {
  console.error('\nNo se ha podido crear el usuario.');
  process.exit(result.status ?? 1);
}

console.log(`\nAdministrador listo: ${email}`);
console.log('El fichero SQL temporal se ha borrado; la contraseña no queda en disco.');
