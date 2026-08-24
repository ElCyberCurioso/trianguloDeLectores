#!/usr/bin/env node
/**
 * Prepara la base de datos local antes de los tests E2E:
 * migraciones + seed + usuario administrador.
 *
 * Si `E2E_BASE_URL` apunta a un entorno desplegado (staging), no toca nada:
 * allí los datos los gestiona el pipeline, no el portátil de nadie.
 */
import { spawnSync } from 'node:child_process';

if (process.env.E2E_BASE_URL) {
  console.log('E2E_BASE_URL definido: se usan los datos del entorno remoto.');
  process.exit(0);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    console.error(`Ha fallado: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

// El rate limiting es real y vive en los Durable Objects locales: al repetir la
// suite en la misma máquina se acumulan intentos y acabaría bloqueando. Con
// --reset se parte de un estado limpio (sólo afecta a `.wrangler/state`).
if (process.argv.includes('--reset')) {
  console.log('→ Borrando el estado local previo...');
  run('node', ['scripts/reset-local.mjs']);
}

console.log('→ Aplicando migraciones en la base de datos local...');
run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'tdl-db', '--local']);

console.log('→ Cargando datos de ejemplo...');
run('npx', ['wrangler', 'd1', 'execute', 'tdl-db', '--local', '--file', './scripts/seed.sql']);

console.log('→ Creando el usuario administrador de pruebas...');
run('node', ['scripts/create-admin.mjs', '--local'], {
  env: {
    ...process.env,
    ADMIN_EMAIL: process.env.E2E_ADMIN_EMAIL ?? 'e2e@triangulodelectores.test',
    ADMIN_NAME: 'E2E',
    ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD ?? 'ClaveDePruebasE2E123',
  },
});

console.log('Entorno E2E listo.');
