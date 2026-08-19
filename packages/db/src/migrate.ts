import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './index.js';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Forward-only migrations, keyed by filename. Applied on boot by both the web
 * server and the worker, so a deploy carries its own schema change. Running
 * twice is a no-op; there is no down path on purpose.
 */
export async function migrate(db: Db): Promise<string[]> {
  await db.execute(`
    create table if not exists _migrations (
      name text primary key,
      applied_at integer not null
    )
  `);

  const done = new Set(
    (await db.execute('select name from _migrations')).rows.map((r) => String(r['name'])),
  );

  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS, file), 'utf8');
    // libSQL executes one statement per call; split on semicolons at line ends.
    for (const stmt of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) {
      await db.execute(stmt);
    }
    await db.execute({
      sql: 'insert into _migrations (name, applied_at) values (?, ?)',
      args: [file, Date.now()],
    });
    applied.push(file);
  }
  return applied;
}
