#!/usr/bin/env node
/**
 * Activa o desactiva la comprobación anti-bot del acceso al panel.
 *
 * Existe por un problema de diseño evidente en cuanto se sufre: el interruptor
 * de Turnstile vive en `/admin/ajustes`, que está **detrás** del propio login.
 * Si el widget deja de cargarse —una extensión que lo bloquea, un corte de red,
 * la zona mal configurada—, no se puede entrar y tampoco apagarlo. Este script
 * es la salida de emergencia, y no necesita navegador.
 *
 *   node scripts/turnstile.mjs off --env production
 *   node scripts/turnstile.mjs on  --env staging
 *   node scripts/turnstile.mjs off                   # base de datos local
 *
 * Escribe en la tabla `settings` y purga la caché de ajustes en KV, que es de
 * donde lee el Worker.
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const action = args[0];
const envIndex = args.indexOf('--env');
const targetEnv = envIndex >= 0 ? args[envIndex + 1] : null;

if (action !== 'on' && action !== 'off') {
  console.error('Uso: node scripts/turnstile.mjs <on|off> [--env staging|production]');
  process.exit(1);
}

// El binding vale en los tres entornos; el nombre de la base, no.
const DB = 'DB';
const KV = 'CACHE';
const remote = targetEnv ? ['--env', targetEnv, '--remote'] : ['--local'];
const value = action === 'on' ? 'true' : 'false';

function run(label, command) {
  console.log(`\n${label}`);
  const result = spawnSync('npx', command, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\nHa fallado: npx ${command.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

run(
  `Ajuste security.turnstile_login = ${value}`,
  [
    'wrangler', 'd1', 'execute', DB, ...remote,
    '--command',
    `INSERT INTO settings (key, value, updated_at) VALUES ('security.turnstile_login', '${value}', ${Date.now()}) ` +
      `ON CONFLICT (key) DO UPDATE SET value = '${value}', updated_at = ${Date.now()}`,
  ],
);

// Sin purgar la caché, el Worker seguiría leyendo el valor anterior hasta que
// expire por su cuenta.
run('Purga de la caché de ajustes en KV', [
  'wrangler', 'kv', 'key', 'delete', 'settings:v1',
  '--binding', KV,
  ...(targetEnv ? ['--env', targetEnv, '--remote'] : ['--local']),
]);

console.log(
  action === 'off'
    ? '\nTurnstile desactivado en el acceso al panel. Vuelve a activarlo en cuanto esté resuelto:\n' +
        `  node scripts/turnstile.mjs on${targetEnv ? ` --env ${targetEnv}` : ''}\n` +
        '\nMientras tanto siguen en pie el límite de 5 intentos por IP cada 15 minutos,\n' +
        'el límite global de 50 por hora y el bloqueo de la cuenta tras 5 fallos.\n'
    : '\nTurnstile activado en el acceso al panel.\n',
);
