#!/usr/bin/env node
/**
 * Comprobación de que no se cuelan secretos en el repositorio.
 * Se ejecuta en CI antes de cualquier despliegue.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.wrangler', 'dist', 'coverage', 'test-results', 'playwright-report',
]);
const SKIP_FILES = new Set(['check-secrets.mjs', 'package-lock.json']);
const SCAN_EXT = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.jsonc', '.yml', '.yaml', '.sql', '.md', '.toml', '.sh',
]);

const PATTERNS = [
  { name: 'clave privada', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'secreto de Turnstile', re: /\b0x[A-Za-z0-9_-]{30,}\b/ },
  {
    name: 'contraseña embebida',
    re: /(password|passwd|contrasena)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
    // Las credenciales de los tests son fixtures contra una base local
    // efímera: no dan acceso a nada y deben poder leerse.
    ignorePaths: /^tests[\\/]/,
  },
  { name: 'bearer token', re: /bearer\s+[A-Za-z0-9._-]{30,}/i },
  { name: 'hash PBKDF2 con salt real', re: /pbkdf2\$sha256\$\d+\$(?!AAAA)[A-Za-z0-9+/=]{20,}\$/ },
  { name: 'CLOUDFLARE_API_TOKEN literal', re: /CLOUDFLARE_API_TOKEN\s*[:=]\s*['"][A-Za-z0-9_-]{20,}['"]/ },
];

// Valores públicos de prueba documentados por Cloudflare y marcadores del repo.
const ALLOWLIST = [
  /1x00000000000000000000AA/,
  /2x00000000000000000000AB/,
  /REPLACE_WITH_/,
  /\$\{\{\s*secrets\./,
  /process\.env\./,
];

let findings = 0;

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(path);
      continue;
    }
    // Los enlaces simbólicos no son ni fichero ni directorio para readdir:
    // se ignoran para no seguir enlaces fuera del repositorio.
    if (!entry.isFile()) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    const ext = extname(entry.name);
    if (ext && !SCAN_EXT.has(ext) && !entry.name.startsWith('.env')) continue;
    if ((await stat(path)).size > 1_000_000) continue;

    const content = await readFile(path, 'utf8');
    content.split('\n').forEach((line, index) => {
      if (ALLOWLIST.some((re) => re.test(line))) return;
      for (const { name, re, ignorePaths } of PATTERNS) {
        if (ignorePaths && ignorePaths.test(path)) continue;
        if (re.test(line)) {
          console.error(`[posible secreto] ${path}:${index + 1} — ${name}`);
          console.error(`                  ${line.trim().slice(0, 120)}`);
          findings++;
        }
      }
    });
  }
}

await walk('.');

if (findings > 0) {
  console.error(`\n${findings} posible(s) secreto(s) en el repositorio. Revísalo antes de desplegar.`);
  process.exit(1);
}
console.log('Sin secretos detectados en el repositorio.');
