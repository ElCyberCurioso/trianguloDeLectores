#!/usr/bin/env node
/**
 * Empaqueta las islas de cliente con esbuild.
 * Sin framework en el navegador: dos bundles pequeños, ESM, minificados.
 */
import { build } from 'esbuild';
import { mkdir, cp } from 'node:fs/promises';

await mkdir('public/assets', { recursive: true });

/**
 * pdf.js se autoaloja, igual que la tipografía: enlazarlo a un CDN metería un
 * tercero en la CSP y filtraría a cada visita. Se copia tal cual del paquete,
 * sin volver a empaquetarlo — el visor y su worker ya vienen minificados.
 *
 *   build/      el visor y su worker
 *   wasm/       JBIG2, JPEG2000 y gestión de color, que muchos PDF escaneados
 *               necesitan para pintar las imágenes
 *   cmaps/      tablas de codificación de los PDF con tipografías CJK
 *   standard_fonts/  las 14 fuentes base que un PDF puede no incrustar
 */
const PDFJS = 'node_modules/pdfjs-dist';
await mkdir('public/assets/pdf', { recursive: true });
await Promise.all([
  cp(`${PDFJS}/build/pdf.min.mjs`, 'public/assets/pdf/pdf.min.mjs'),
  cp(`${PDFJS}/build/pdf.worker.min.mjs`, 'public/assets/pdf/pdf.worker.min.mjs'),
  cp(`${PDFJS}/wasm`, 'public/assets/pdf/wasm', { recursive: true }),
  cp(`${PDFJS}/cmaps`, 'public/assets/pdf/cmaps', { recursive: true }),
  cp(`${PDFJS}/standard_fonts`, 'public/assets/pdf/standard_fonts', { recursive: true }),
]);

const result = await build({
  entryPoints: ['src/client/app.ts', 'src/client/admin.ts', 'src/client/books.ts', 'src/client/scanner.ts'],
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
