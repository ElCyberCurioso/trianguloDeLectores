import type { Config } from 'drizzle-kit';

/**
 * drizzle-kit sólo se usa para inspección y para generar diffs de referencia.
 * Las migraciones que se aplican en D1 son los ficheros SQL de `migrations/`,
 * escritos a mano para conservar CHECK constraints e índices compuestos.
 */
export default {
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    databaseId: process.env.CLOUDFLARE_D1_ID ?? '',
    token: process.env.CLOUDFLARE_API_TOKEN ?? '',
  },
  verbose: true,
  strict: true,
} satisfies Config;
