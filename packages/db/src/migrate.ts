import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './index.js';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Forward-only migrations, keyed by filename. Applied on boot by both the web
 * server and the worker, so a deploy carries its own schema change. Running
 * twice is a no-op; there is no down path on purpose.
 *
 * Both processes start at the same instant in the same container, so they race:
 * each reads _migrations before the other has written to it, both apply the same
 * file, and the second insert used to abort the boot with
 * `UNIQUE constraint failed: _migrations.name`. The ledger write is therefore
 * `insert or ignore` — losing the race is an expected outcome, not an error.
 *
 * The corollary is a real constraint on migration SQL: every statement must be
 * safe to run twice concurrently (`create table if not exists`,
 * `create index if not exists`, `alter table ... add column` guarded by a check).
 * A statement that is not idempotent will still fail for whichever process
 * arrives second.
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
    const ledger = await db.execute({
      sql: 'insert or ignore into _migrations (name, applied_at) values (?, ?)',
      args: [file, Date.now()],
    });
    // rowsAffected is 0 when the other process recorded this file first.
    if (ledger.rowsAffected > 0) applied.push(file);
  }
  return applied;
}
