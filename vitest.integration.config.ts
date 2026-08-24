import path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

/**
 * Los tests de integración corren dentro de **workerd**, el mismo runtime que
 * usa Cloudflare en producción, con D1, R2, KV y Durable Objects reales de
 * Miniflare. No hay mocks: si algo pasa aquí, pasa desplegado.
 */
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(process.cwd(), 'migrations'));

  return {
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      setupFiles: ['./tests/integration/setup.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          // Sin aislamiento por test: el "storage stacking" de
          // vitest-pool-workers no convive con los blobs de R2 (falla al hacer
          // pop del frame) ni con los alarms de los Durable Objects. Cada test
          // crea sus propios datos con títulos únicos, así que el aislamiento
          // no aporta nada y sí fragilidad.
          isolatedStorage: false,
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            compatibilityDate: '2025-02-04',
            bindings: {
              ENVIRONMENT: 'development',
              SITE_NAME: 'Triángulo de Lectores',
              SITE_URL: 'http://localhost:8787',
              SITE_LOCALE: 'es-ES',
              TURNSTILE_ENABLED: 'false',
              TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
              IMAGE_RESIZING: 'false',
              LOG_LEVEL: 'error',
              HASH_PEPPER: 'pepper-de-pruebas-no-secreto',
              TEST_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
