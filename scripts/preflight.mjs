#!/usr/bin/env node
/**
 * Verificación completa antes de subir nada a producción.
 *
 *   npm run preflight              todo, incluido E2E
 *   npm run preflight -- --quick   sin E2E ni dry-run de despliegue
 *
 * Opciones:
 *   --quick        omite E2E y los dry-run de despliegue
 *   --skip-e2e     omite sólo los tests E2E
 *   --base <url>   ejecuta el E2E contra un servidor ya levantado
 *                  (p. ej. el de `npm run local`) en vez de arrancar uno
 *
 * Devuelve código 0 sólo si todas las comprobaciones obligatorias pasan.
 * Los avisos no bloquean, pero se listan al final para que decidas tú.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const skipE2e = quick || args.includes('--skip-e2e');
const skipDeployCheck = quick;
const baseUrl = args[args.indexOf('--base') + 1] && args.includes('--base')
  ? args[args.indexOf('--base') + 1]
  : null;

const resultados = [];
const avisos = [];

function comprobar(nombre, fn) {
  process.stdout.write(`\n▶ ${nombre}\n`);
  const inicio = Date.now();
  let estado;
  try {
    estado = fn() === false ? 'FALLO' : 'OK';
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    estado = 'FALLO';
  }
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  resultados.push({ nombre, estado, segundos });
  console.log(`  ${estado === 'OK' ? '✓' : '✗'} ${nombre} (${segundos}s)`);
  return estado === 'OK';
}

function omitir(nombre, motivo) {
  resultados.push({ nombre, estado: 'OMITIDO', segundos: '0.0' });
  console.log(`\n▶ ${nombre}\n  – omitido (${motivo})`);
}

function run(command, commandArgs, { quiet = false, env } = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0 && quiet) {
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
  }
  return result.status === 0;
}

console.log('\n=== Verificación previa a producción ===');

// 1. Entorno ----------------------------------------------------------------
comprobar('Versión de Node (>= 20)', () => {
  const major = Number(process.versions.node.split('.')[0]);
  console.log(`  Node ${process.versions.node}`);
  return major >= 20;
});

comprobar('Dependencias instaladas', () => {
  if (existsSync('node_modules')) return true;
  console.log('  Falta node_modules. Ejecuta `npm install`.');
  return false;
});

// 2. Higiene del repositorio -------------------------------------------------
comprobar('Sin secretos en el repositorio', () => run('node', ['scripts/check-secrets.mjs']));

comprobar('Configuración de Cloudflare', () => {
  const config = readFileSync('wrangler.jsonc', 'utf8');

  // Los marcadores de la sección de desarrollo son normales; los de producción
  // significan que ese entorno todavía no está conectado a recursos reales.
  const bloqueProduccion = config.slice(config.indexOf('"production"'));
  const pendientes = [...bloqueProduccion.matchAll(/REPLACE_WITH_[A-Z0-9_]+/g)].map((m) => m[0]);

  if (pendientes.length) {
    avisos.push(
      `wrangler.jsonc: el entorno de producción aún tiene ${pendientes.length} marcador(es) sin ` +
        `sustituir (${[...new Set(pendientes)].join(', ')}). Hay que rellenarlos antes de desplegar.`,
    );
    console.log(`  ! ${pendientes.length} marcador(es) REPLACE_WITH_ en producción`);
  } else {
    console.log('  Producción con identificadores reales');
  }

  // Se mira el valor real de compatibility_flags, no el texto del fichero:
  // `nodejs_compat` aparece en un comentario explicando que NO se usa.
  const flags = /"compatibility_flags"\s*:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? '';
  if (flags.includes('nodejs_compat')) {
    avisos.push('compatibility_flags incluye nodejs_compat: revisa si de verdad hace falta.');
  } else {
    console.log('  Sin nodejs_compat: sólo APIs Web');
  }
  return true;
});

comprobar('Sin APIs de Node en el código del Worker', () => {
  const result = spawnSync(
    'grep',
    ['-rnE', "from '(node:)?(fs|child_process|net|tls|dns|cluster|worker_threads)'", 'src/server', 'src/do', 'src/db'],
    { encoding: 'utf8' },
  );
  if (result.status === 0) {
    console.log(result.stdout);
    return false;
  }
  console.log('  Sólo APIs Web estándar');
  return true;
});

// 3. Calidad ----------------------------------------------------------------
comprobar('ESLint', () => run('npx', ['eslint', '.']));
comprobar('TypeScript (Worker, cliente y herramientas)', () => run('npm', ['run', 'typecheck', '--silent']));

// 4. Tests ------------------------------------------------------------------
comprobar('Tests unitarios', () => run('npx', ['vitest', 'run', '--project', 'unit', '--reporter=basic']));
comprobar('Tests de integración (workerd + D1 + R2 + KV + DO)', () =>
  run('npx', ['vitest', 'run', '--project', 'integration', '--reporter=basic']),
);

// 5. Build ------------------------------------------------------------------
comprobar('Bundles de cliente', () => run('node', ['scripts/build-client.mjs']));

if (skipDeployCheck) {
  omitir('Dry-run de despliegue', '--quick');
} else {
  comprobar('Dry-run de despliegue (development)', () =>
    run('npx', ['wrangler', 'deploy', '--dry-run', '--outdir', '.wrangler/preflight/dev'], { quiet: true }),
  );
  comprobar('Dry-run de despliegue (staging)', () =>
    run('npx', ['wrangler', 'deploy', '--env', 'staging', '--dry-run', '--outdir', '.wrangler/preflight/staging'], {
      quiet: true,
    }),
  );
  comprobar('Dry-run de despliegue (production)', () =>
    run('npx', ['wrangler', 'deploy', '--env', 'production', '--dry-run', '--outdir', '.wrangler/preflight/prod'], {
      quiet: true,
    }),
  );
}

// 6. E2E --------------------------------------------------------------------
if (skipE2e) {
  omitir('Tests E2E', quick ? '--quick' : '--skip-e2e');
} else if (baseUrl) {
  comprobar(`Tests E2E contra ${baseUrl}`, () =>
    run('npx', ['playwright', 'test'], { env: { E2E_BASE_URL: baseUrl } }),
  );
} else {
  // Sin --base, Playwright arranca su propio `wrangler dev`; antes se prepara
  // una base local limpia para que el rate limiting no arrastre intentos de
  // ejecuciones anteriores.
  comprobar('Tests E2E (servidor local efímero)', () =>
    run('node', ['scripts/e2e-prepare.mjs', '--reset']) && run('npx', ['playwright', 'test']),
  );
}

// ------------------------------------------------------------------ informe --
const fallos = resultados.filter((r) => r.estado === 'FALLO');

console.log('\n────────────────────────────────────────────────────────────');
console.log('  Resumen\n');
for (const r of resultados) {
  const marca = r.estado === 'OK' ? '✓' : r.estado === 'OMITIDO' ? '–' : '✗';
  console.log(`  ${marca} ${r.nombre.padEnd(52)} ${r.estado.padEnd(8)} ${r.segundos}s`);
}

if (avisos.length) {
  console.log('\n  Avisos (no bloquean, decide tú):');
  for (const aviso of avisos) console.log(`    ! ${aviso}`);
}

console.log(`
  Comprobaciones que ningún script puede hacer por ti:

    [ ] El bucket R2 de producción NO es público.
    [ ] Los secretos están puestos en cada entorno:
          npx wrangler secret list --env production
        deben aparecer HASH_PEPPER y TURNSTILE_SECRET_KEY.
    [ ] TURNSTILE_SITE_KEY de producción es la real, no la de prueba.
    [ ] SSL/TLS en modo Full (Strict) y Always Use HTTPS activo.
    [ ] Reglas del WAF y Rate Limiting Rules creadas (README §12).
    [ ] Copia de seguridad de D1 antes de migrar:
          npx wrangler d1 export tdl-db-prod --env production --remote --output backup.sql
    [ ] La contraseña del administrador de producción es larga y única.
────────────────────────────────────────────────────────────
`);

if (fallos.length) {
  console.error(`FALLA: ${fallos.length} comprobación(es) — ${fallos.map((f) => f.nombre).join(', ')}`);
  console.error('No subas a producción hasta arreglarlo.\n');
  process.exit(1);
}

console.log('Todas las comprobaciones automáticas han pasado.\n');
