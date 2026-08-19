import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { migrate } from '../dist/migrate.js';

/**
 * The web server and the worker boot simultaneously in the same container and
 * both call migrate(). Before `insert or ignore`, whichever lost the race died
 * with `UNIQUE constraint failed: _migrations.name`, which is how sinkstate
 * first shipped to Railway serving 200s with no worker running at all.
 */
async function freshDb(t) {
  const dir = await mkdtemp(join(tmpdir(), 'migrate-race-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return createClient({ url: `file:${join(dir, 'test.db')}` });
}

test('concurrent boots both survive and apply each migration exactly once', async (t) => {
  const db = await freshDb(t);

  const [a, b] = await Promise.all([migrate(db), migrate(db)]);

  const ledger = (await db.execute('select name from _migrations order by name')).rows.map((r) =>
    String(r['name']),
  );

  assert.ok(ledger.length > 0, 'expected at least one migration in the ledger');
  assert.equal(
    a.length + b.length,
    ledger.length,
    'each migration must be claimed by exactly one process',
  );
  assert.deepEqual([...a, ...b].sort(), ledger, 'claims must match the ledger');
});

test('a later boot is a clean no-op', async (t) => {
  const db = await freshDb(t);

  await migrate(db);
  assert.deepEqual(await migrate(db), [], 'second run must apply nothing');
  assert.deepEqual(await migrate(db), [], 'third run must apply nothing');
});
