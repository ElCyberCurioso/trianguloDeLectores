#!/usr/bin/env node
/**
 * Publica el APK de la aplicación Android en R2 y actualiza su manifiesto.
 *
 *   node scripts/publish-apk.mjs android/app/build/outputs/apk/release/app-release.apk --env production
 *   node scripts/publish-apk.mjs <fichero.apk> --env staging --notas "Arregla el zoom"
 *   node scripts/publish-apk.mjs <fichero.apk>                    # bucket local
 *
 * Sube dos objetos: el binario bajo `apps/android/tdl-<version>-<código>.apk` y
 * `apps/android/latest.json`, que es lo que lee el sitio para pintar la página
 * de descarga y servir el fichero. El binario nunca entra en el repositorio ni
 * en `public/`: son quince megas que se despliegan con cada cambio del sitio si
 * viven ahí, y no cambian a la vez que el sitio.
 *
 * La versión y el `versionCode` **no se escriben a mano**: se leen del
 * `build.gradle.kts` de la aplicación. Un manifiesto que anuncia una versión y
 * entrega otra es exactamente el fallo que nadie mira hasta que alguien no
 * recibe una actualización.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);

// Las opciones llevan valor, así que no basta con quedarse con «lo que no
// empieza por --»: hay que saltarse también su argumento o las notas acabarían
// tomándose por la ruta del fichero.
const CON_VALOR = new Set(['--env', '--notas']);
const opciones = new Map();
const sueltos = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (CON_VALOR.has(arg)) {
    opciones.set(arg, args[i + 1] ?? null);
    i += 1;
  } else if (!arg.startsWith('--')) {
    sueltos.push(arg);
  }
}

const apkPath = sueltos[0];
const targetEnv = opciones.get('--env') ?? null;
const notes = opciones.get('--notas') ?? null;

if (!apkPath) {
  console.error('Uso: node scripts/publish-apk.mjs <fichero.apk> [--env staging|production] [--notas "..."]');
  process.exit(1);
}
if (targetEnv && targetEnv !== 'staging' && targetEnv !== 'production') {
  console.error(`Entorno desconocido: ${targetEnv}`);
  process.exit(1);
}

// El nombre del bucket sí depende del entorno (a diferencia del binding de D1,
// que vale en los tres). Se lee de wrangler.jsonc para no tener dos verdades.
const wrangler = JSON.parse(
  readFileSync('wrangler.jsonc', 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, ''),
);
const bucket = targetEnv
  ? wrangler.env[targetEnv].r2_buckets[0].bucket_name
  : wrangler.r2_buckets[0].bucket_name;

// --- versión, leída del proyecto Android -----------------------------------
const gradle = readFileSync('android/app/build.gradle.kts', 'utf8');
const versionName = /versionName\s*=\s*"([^"]+)"/.exec(gradle)?.[1];
const versionCode = Number(/versionCode\s*=\s*(\d+)/.exec(gradle)?.[1]);
const minSdk = Number(/minSdk\s*=\s*(\d+)/.exec(gradle)?.[1]);

if (!versionName || !Number.isInteger(versionCode) || !Number.isInteger(minSdk)) {
  console.error('No se han podido leer versionName/versionCode/minSdk de android/app/build.gradle.kts');
  process.exit(1);
}

// --- el fichero -------------------------------------------------------------
const bytes = readFileSync(apkPath);
const size = statSync(apkPath).size;

// Un APK es un ZIP: empieza por `PK\x03\x04`. Comprobarlo aquí evita publicar
// un fichero equivocado, que es un fallo que sólo se ve al intentar instalarlo.
if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
  console.error(`${apkPath} no parece un APK (no empieza por la firma de un ZIP)`);
  process.exit(1);
}

const sha256 = createHash('sha256').update(bytes).digest('hex');
const key = `apps/android/tdl-${versionName}-${versionCode}.apk`;

/*
 * `versionName` sale del `build.gradle.kts`, sin el sufijo que añade la
 * compilación contra staging: allí la aplicación se ve como «1.0.0-staging» y
 * el manifiesto dice «1.0.0». No importa para lo que decide una actualización,
 * que es `versionCode`, y evita tener que ejecutar `aapt` sólo para leer una
 * cadena.
 */
const manifest = {
  version: versionName,
  versionCode,
  key,
  sizeBytes: size,
  sha256,
  publishedAt: new Date().toISOString(),
  minSdk,
  notes,
};

const scratch = mkdtempSync(join(tmpdir(), 'tdl-apk-'));
const manifestPath = join(scratch, 'latest.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const remote = targetEnv ? ['--remote'] : ['--local'];

function run(label, command) {
  console.log(`\n${label}`);
  const result = spawnSync('npx', command, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\nHa fallado: npx ${command.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

run(`Subiendo el APK (${(size / 1024 / 1024).toFixed(1)} MB) a ${bucket}/${key}`, [
  'wrangler', 'r2', 'object', 'put', `${bucket}/${key}`,
  '--file', apkPath,
  '--content-type', 'application/vnd.android.package-archive',
  ...remote,
]);

// El manifiesto va **después** del binario: si se cae algo por el camino, el
// sitio sigue sirviendo la versión anterior en vez de anunciar una que no está.
run('Actualizando apps/android/latest.json', [
  'wrangler', 'r2', 'object', 'put', `${bucket}/apps/android/latest.json`,
  '--file', manifestPath,
  '--content-type', 'application/json',
  ...remote,
]);

console.log(`\nPublicada la versión ${versionName} (${versionCode}).`);
console.log(`SHA-256: ${sha256}`);
console.log(`Descarga: ${targetEnv === 'production' ? 'https://triangulodelectores.site' : targetEnv === 'staging' ? 'https://staging.triangulodelectores.site' : 'http://localhost:8787'}/aplicacion`);
