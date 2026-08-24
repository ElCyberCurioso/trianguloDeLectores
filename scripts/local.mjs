#!/usr/bin/env node
/**
 * Levanta la aplicación completa en local, con todo lo que necesita para
 * probarla de verdad: D1 migrada y sembrada, R2 y KV simulados, Durable
 * Objects, bundles de cliente compilados y un usuario administrador.
 *
 *   npm run local              arranca (conserva los datos existentes)
 *   npm run local:reset        borra el estado local y empieza de cero
 *
 * Opciones:
 *   --reset          borra `.wrangler/state` antes de empezar
 *   --no-seed        no carga los datos de ejemplo
 *   --no-build       no recompila los bundles de cliente
 *   --port <n>       puerto (por defecto 8787)
 *   --no-admin       no crea ni comprueba el usuario administrador
 *
 * Sólo toca el entorno local. No se conecta a Cloudflare ni puede tocar
 * staging o producción.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const DB_NAME = 'tdl-db';
const args = process.argv.slice(2);

const flags = {
  reset: args.includes('--reset'),
  seed: !args.includes('--no-seed'),
  build: !args.includes('--no-build'),
  admin: !args.includes('--no-admin'),
  port: readOption('--port') ?? '8787',
};

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

// --------------------------------------------------------------- utilidades --
const paso = (n, total, texto) => console.log(`\n[${n}/${total}] ${texto}`);
const ok = (texto) => console.log(`      ✓ ${texto}`);
const aviso = (texto) => console.log(`      ! ${texto}`);

function run(command, commandArgs, { quiet = false, allowFail = false } = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0 && !allowFail) {
    if (quiet) {
      process.stderr.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
    }
    console.error(`\nHa fallado: ${command} ${commandArgs.join(' ')}`);
    process.exit(result.status ?? 1);
  }
  return result;
}

const d1 = (extra, options) => run('npx', ['wrangler', 'd1', ...extra], options);

// ------------------------------------------------------------ comprobaciones --
const TOTAL = 6;

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`Se necesita Node 20 o superior (tienes ${process.versions.node}).`);
  process.exit(1);
}

if (!existsSync('node_modules')) {
  console.log('No hay dependencias instaladas. Ejecutando npm install...');
  run('npm', ['install', '--no-audit', '--no-fund']);
}

console.log('\n=== Triángulo de Lectores — entorno local ===');

// 1. Secretos locales -------------------------------------------------------
paso(1, TOTAL, 'Secretos locales (.dev.vars)');
if (existsSync('.dev.vars')) {
  const contenido = readFileSync('.dev.vars', 'utf8');
  if (/HASH_PEPPER\s*=\s*["']?cambia-esto/i.test(contenido)) {
    aviso('HASH_PEPPER sigue con el valor de ejemplo. Vale para local, pero');
    aviso('genera uno real antes de tocar staging o producción.');
  } else {
    ok('.dev.vars presente');
  }
} else {
  // Se genera un pepper real para que la pseudonimización y los tokens de
  // formulario se comporten en local igual que en producción.
  const pepper = randomBytes(32).toString('base64url');
  writeFileSync(
    '.dev.vars',
    [
      '# Secretos SOLO para desarrollo local. Fichero ignorado por git.',
      '# En staging y producción se usan Cloudflare Secrets:',
      '#   npx wrangler secret put NOMBRE --env <entorno>',
      '',
      `HASH_PEPPER="${pepper}"`,
      '',
      '# Clave de PRUEBA de Turnstile documentada por Cloudflare (siempre válida).',
      'TURNSTILE_SECRET_KEY="1x0000000000000000000000000000000AA"',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  ok('.dev.vars creado con un HASH_PEPPER aleatorio');
}

// 2. Estado local -----------------------------------------------------------
paso(2, TOTAL, 'Estado local de Miniflare');
if (flags.reset) {
  run('node', ['scripts/reset-local.mjs']);
} else if (existsSync('.wrangler/state')) {
  ok('se conserva el estado existente (usa --reset para empezar de cero)');
} else {
  ok('sin estado previo: se creará ahora');
}

// 3. Bundles de cliente -----------------------------------------------------
paso(3, TOTAL, 'Bundles de cliente');
if (flags.build) {
  run('node', ['scripts/build-client.mjs']);
} else {
  aviso('omitido por --no-build');
}

// 4. Base de datos ----------------------------------------------------------
paso(4, TOTAL, 'Migraciones de D1');
d1(['migrations', 'apply', DB_NAME, '--local'], { quiet: true });
ok('esquema al día');

paso(5, TOTAL, 'Datos de ejemplo');
if (flags.seed) {
  d1(['execute', DB_NAME, '--local', '--file=./scripts/seed.sql'], { quiet: true });
  ok('categorías, géneros, plataformas, ajustes y reseñas de muestra');
} else {
  aviso('omitido por --no-seed');
}

// 5. Administrador ----------------------------------------------------------
paso(6, TOTAL, 'Usuario administrador');
if (!flags.admin) {
  aviso('omitido por --no-admin');
} else if (contarAdmins() > 0) {
  ok('ya existe un administrador (cámbialo con `npm run admin:create`)');
} else {
  console.log('      No hay ningún administrador. Vamos a crearlo.\n');
  run('node', ['scripts/create-admin.mjs', '--local']);
}

/** Cuenta administradores en la D1 local. Ante la duda, devuelve -1. */
function contarAdmins() {
  const result = d1(
    ['execute', DB_NAME, '--local', '--json', '--command', "SELECT COUNT(*) AS total FROM users WHERE role = 'ADMIN'"],
    { quiet: true, allowFail: true },
  );
  if (result.status !== 0) return 0;
  try {
    const json = JSON.parse(stripNoise(result.stdout ?? ''));
    const filas = Array.isArray(json) ? json[0]?.results : json?.results;
    return Number(filas?.[0]?.total ?? 0);
  } catch {
    return 0;
  }
}

/** wrangler mezcla mensajes con el JSON: se recorta al primer [ o {. */
function stripNoise(salida) {
  const inicio = salida.search(/[[{]/);
  return inicio >= 0 ? salida.slice(inicio) : salida;
}

// --------------------------------------------------------------- arranque ---
const url = `http://127.0.0.1:${flags.port}`;
console.log(`
────────────────────────────────────────────────────────────
  Entorno local listo

  Catálogo   ${url}
  Panel      ${url}/admin
  Salud      ${url}/health

  Turnstile desactivado en local (TURNSTILE_ENABLED=false).
  D1, R2, KV y Durable Objects los simula Miniflare en
  .wrangler/state — nada sale de esta máquina.

  Pruebas contra este servidor, en otra terminal:
    E2E_BASE_URL=${url} npx playwright test
    npm run preflight        (verificación completa)

  Ctrl+C para parar.
────────────────────────────────────────────────────────────
`);

run('npx', ['wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', flags.port]);
