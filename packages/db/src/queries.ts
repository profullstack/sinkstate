import type { Db } from './index.js';

export interface User {
  id: number;
  email: string;
  created_at: number;
}

/**
 * Magic-link consumption doubles as registration: an unknown address creates
 * the account rather than being turned away to find a sign-up form.
 */
export async function findOrCreateUser(db: Db, email: string): Promise<User> {
  const normalized = email.trim().toLowerCase();
  const found = await db.execute({
    sql: 'select id, email, created_at from users where email = ?',
    args: [normalized],
  });
  if (found.rows.length) return found.rows[0] as unknown as User;

  await db.execute({
    sql: 'insert into users (email, created_at) values (?, ?)',
    args: [normalized, Date.now()],
  });
  const created = await db.execute({
    sql: 'select id, email, created_at from users where email = ?',
    args: [normalized],
  });
  return created.rows[0] as unknown as User;
}

export async function getUserById(db: Db, id: number): Promise<User | null> {
  const r = await db.execute({
    sql: 'select id, email, created_at from users where id = ?',
    args: [id],
  });
  return (r.rows[0] as unknown as User) ?? null;
}

export interface PruneResult {
  loginTokens: number;
  sessions: number;
}

/**
 * Delete auth rows that have expired.
 *
 * The reaper's nominal job — pruning expired shared reports — has nothing to do
 * yet: the paste flow persists nothing, and permalinks are deliberately v2 (see
 * the PRD's open questions). Expired login tokens and sessions are real rows
 * that really do accumulate, so it prunes those rather than idling on a TODO.
 *
 * Consumed-but-unexpired login tokens are kept on purpose: replay has to stay
 * detectable, and a deleted row is indistinguishable from one never issued.
 */
export async function pruneExpired(db: Db, now = Date.now()): Promise<PruneResult> {
  const tokens = await db.execute({
    sql: 'delete from login_tokens where expires_at < ?',
    args: [now],
  });
  const sessions = await db.execute({
    sql: 'delete from sessions where expires_at < ?',
    args: [now],
  });
  return { loginTokens: tokens.rowsAffected, sessions: sessions.rowsAffected };
}
