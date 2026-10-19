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
      /*
       * Los 5 s por omisión de Vitest son para un test en proceso, y aquí cada
       * petición cruza workerd de verdad. Varios tests encadenan diez o quince
       * para comprobar justo lo que hace falta encadenarlas: que el limitador
       * corta, que la cuenta se bloquea, que el umbral de reportes salta.
       *
       * En una máquina descansada el más lento tarda 3,9 s. Eso deja un margen
       * del 23 %: basta con que la máquina vaya a dos tercios de velocidad
       * —compilando la release de Android al lado, por ejemplo— para que se
       * pase del tope y el preflight se ponga rojo sin que nada esté roto.
       * Pasó tres veces seguidas y cada repetición en limpio salió verde, así
       * que lo que medía el semáforo era la carga del portátil.
       *
       * Va en el proyecto, no test a test: el coste es del runtime y lo pagan
       * todos, y un número por test habría que volver a elegirlo cada vez que
       * cambie la máquina. Los tests unitarios siguen con los 5 s, que ahí sí
       * son de sobra.
       */
      testTimeout: 20_000,
      hookTimeout: 20_000,
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
              // El subdominio privado se reparte por host, así que los tests
              // necesitan saber cuál es el suyo.
              BOOKS_URL: 'http://books.localhost:8787',
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
