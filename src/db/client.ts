import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';
import type { Bindings } from '../types/env';

export type Db = DrizzleD1Database<typeof schema>;

const cache = new WeakMap<D1Database, Db>();

/**
 * Cliente de datos. Todo el acceso a D1 pasa por aquí y por `db/repos/*`:
 * ninguna capa superior conoce D1 ni SQL, de modo que sustituir el motor
 * implicaría reescribir sólo esta carpeta.
 */
export function getDb(env: Pick<Bindings, 'DB'>): Db {
  const existing = cache.get(env.DB);
  if (existing) return existing;
  const db = drizzle(env.DB, { schema, logger: false });
  cache.set(env.DB, db);
  return db;
}

export { schema };
