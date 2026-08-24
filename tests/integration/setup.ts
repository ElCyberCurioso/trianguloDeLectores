import { applyD1Migrations, env } from 'cloudflare:test';

/**
 * Aplica el mismo SQL de `migrations/` que se aplicará en Cloudflare.
 * Los tests no usan un esquema paralelo: si una migración está mal, fallan aquí.
 */
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
