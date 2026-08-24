#!/usr/bin/env node
/**
 * Empaqueta las islas de cliente con esbuild.
 * Sin framework en el navegador: dos bundles pequeños, ESM, minificados.
 */
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('public/assets', { recursive: true });

const result = await build({
  entryPoints: ['src/client/app.ts', 'src/client/admin.ts'],
  outdir: 'public/assets',
  bundle: true,
  format: 'esm',
  target: ['es2022', 'chrome111', 'firefox115', 'safari16'],
  minify: true,
  sourcemap: process.env.NODE_ENV !== 'production',
  metafile: true,
  legalComments: 'none',
  logLevel: 'info',
});

const sizes = Object.entries(result.metafile.outputs)
  .filter(([file]) => file.endsWith('.js'))
  .map(([file, meta]) => `${file}: ${(meta.bytes / 1024).toFixed(1)} kB`);
console.log(`\nBundles de cliente:\n  ${sizes.join('\n  ')}\n`);
