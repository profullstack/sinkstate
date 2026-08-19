import type { Db } from '@sinkstate/db';
import { getUserById, type User } from '@sinkstate/db';
import { hashToken, mintToken } from './tokens.js';

export const SESSION_COOKIE = 'sinkstate_session';
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

/** Create a session and return the raw token to set as a cookie. */
export async function startSession(db: Db, userId: number, ttlMs = THIRTY_DAYS): Promise<string> {
  const token = mintToken();
  const now = Date.now();
  await db.execute({
    sql: 'insert into sessions (user_id, token_hash, created_at, expires_at) values (?, ?, ?, ?)',
    args: [userId, hashToken(token), now, now + ttlMs],
  });
  return token;
}

export async function resolveSession(db: Db, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const r = await db.execute({
    sql: 'select user_id, expires_at from sessions where token_hash = ?',
    args: [hashToken(token)],
  });
  const row = r.rows[0];
  if (!row) return null;
  if (Number(row['expires_at']) < Date.now()) {
    await endSession(db, token);
    return null;
  }
  return getUserById(db, Number(row['user_id']));
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.execute({
    sql: 'delete from sessions where token_hash = ?',
    args: [hashToken(token)],
  });
}

export function sessionCookie(token: string, secure = true): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${THIRTY_DAYS / 1000}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
