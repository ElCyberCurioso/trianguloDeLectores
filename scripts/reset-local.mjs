#!/usr/bin/env node
/**
 * Borra el estado local de Miniflare (D1, R2, KV, Durable Objects).
 * Nunca toca entornos remotos: sólo actúa sobre `.wrangler/state`.
 */
import { rm, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const target = resolve('.wrangler/state');

try {
  await access(target);
} catch {
  console.log('No hay estado local que borrar.');
  process.exit(0);
}

await rm(target, { recursive: true, force: true });
console.log('Estado local borrado. Se recrearán las migraciones y el seed.');
