import type { D1Migration } from '@cloudflare/vitest-pool-workers/config';
import type { Bindings } from '../../src/types/env';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Bindings {
    /** Migraciones inyectadas por vitest.integration.config.ts */
    TEST_MIGRATIONS: D1Migration[];
  }
}
