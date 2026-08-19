import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Locate the single-file CLI built by `apps/cli`.
 *
 * Next runs with cwd = apps/web in the container and at the repo root in some
 * dev setups, so the candidates cover both rather than assuming one. Read at
 * request time, not at build time: the file is served from source so a rebuilt
 * CLI ships with the next deploy without a separate publish step.
 */
const CANDIDATES = [
  join(process.cwd(), '..', 'cli', 'dist', 'sinkstate.mjs'),
  join(process.cwd(), 'apps', 'cli', 'dist', 'sinkstate.mjs'),
  join(process.cwd(), '..', '..', 'apps', 'cli', 'dist', 'sinkstate.mjs'),
];

export async function readCliBundle(): Promise<string | null> {
  for (const path of CANDIDATES) {
    try {
      // turbopackIgnore: the path is resolved at runtime from cwd, which the
      // bundler cannot trace. Intentional — the CLI is served from source.
      return await readFile(/* turbopackIgnore: true */ path, 'utf8');
    } catch {
      // try the next candidate
    }
  }
  return null;
}
