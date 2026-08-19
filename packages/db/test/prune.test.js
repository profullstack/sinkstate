import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { migrate } from '../dist/migrate.js';
import { pruneExpired } from '../dist/queries.js';

async function freshDb(t) {
  const dir = await mkdtemp(join(tmpdir(), 'prune-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await migrate(db);
  return db;
}

test('expired login tokens and sessions are deleted, live ones are kept', async (t) => {
  const db = await freshDb(t);
  const now = 1_000_000;

  await db.execute({
    sql: 'insert into users (email, created_at) values (?, ?)',
    args: ['a@example.com', now],
  });
  await db.execute({
    sql: 'insert into login_tokens (email, token_hash, created_at, expires_at) values (?, ?, ?, ?)',
    args: ['a@example.com', 'stale', now - 100, now - 1],
  });
  await db.execute({
    sql: 'insert into login_tokens (email, token_hash, created_at, expires_at) values (?, ?, ?, ?)',
    args: ['a@example.com', 'live', now, now + 10_000],
  });
  await db.execute({
    sql: 'insert into sessions (user_id, token_hash, created_at, expires_at) values (?, ?, ?, ?)',
    args: [1, 'stale-session', now - 100, now - 1],
  });
  await db.execute({
    sql: 'insert into sessions (user_id, token_hash, created_at, expires_at) values (?, ?, ?, ?)',
    args: [1, 'live-session', now, now + 10_000],
  });

  const pruned = await pruneExpired(db, now);
  assert.deepEqual(pruned, { loginTokens: 1, sessions: 1 });

  const tokens = await db.execute('select token_hash from login_tokens');
  assert.deepEqual(
    tokens.rows.map((r) => r.token_hash),
    ['live'],
  );
  const sessions = await db.execute('select token_hash from sessions');
  assert.deepEqual(
    sessions.rows.map((r) => r.token_hash),
    ['live-session'],
  );
});

test('a consumed but unexpired token survives, so replay stays detectable', async (t) => {
  const db = await freshDb(t);
  const now = 1_000_000;
  await db.execute({
    sql: 'insert into login_tokens (email, token_hash, created_at, expires_at, consumed_at) values (?, ?, ?, ?, ?)',
    args: ['a@example.com', 'used', now, now + 10_000, now],
  });

  assert.deepEqual(await pruneExpired(db, now), { loginTokens: 0, sessions: 0 });
  const rows = await db.execute('select token_hash from login_tokens');
  assert.equal(rows.rows.length, 1);
});

test('pruning an empty database is a no-op', async (t) => {
  const db = await freshDb(t);
  assert.deepEqual(await pruneExpired(db), { loginTokens: 0, sessions: 0 });
});
