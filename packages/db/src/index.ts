import { createClient, type Client } from '@libsql/client';

export type Db = Client;

let cached: Db | null = null;

/**
 * Connect to Turso, or to a local SQLite file when TURSO_DATABASE_URL is a
 * `file:` URL — which is how the app runs locally without a Turso account.
 *
 * The env accessor is deliberately non-literal: Next inlines `process.env.FOO`
 * at build time, which would bake a build-time value into the server bundle.
 */
export function connect(url?: string, authToken?: string): Db {
  if (cached && !url) return cached;
  const env = process.env;
  const dbUrl = url ?? env['TURSO_DATABASE_URL'];
  if (!dbUrl) throw new Error('TURSO_DATABASE_URL must be set');
  const client = createClient({
    url: dbUrl,
    ...(dbUrl.startsWith('file:') ? {} : { authToken: authToken ?? env['TURSO_AUTH_TOKEN'] }),
  });
  if (!url) cached = client;
  return client;
}

export * from './migrate.js';
export * from './queries.js';
