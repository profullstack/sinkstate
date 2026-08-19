import type { Db } from '@sinkstate/db';
import { findOrCreateUser } from '@sinkstate/db';
import { hashToken, mintToken } from './tokens.js';

const TTL_MS = 15 * 60 * 1000;

/**
 * Issue a sign-in link. This doubles as registration — an address with no
 * account gets one when the link is consumed, so there is no separate
 * account-creation flow to build.
 */
export async function issueLoginToken(db: Db, email: string): Promise<string> {
  const token = mintToken();
  const now = Date.now();
  await db.execute({
    sql: 'insert into login_tokens (email, token_hash, created_at, expires_at) values (?, ?, ?, ?)',
    args: [email.trim().toLowerCase(), hashToken(token), now, now + TTL_MS],
  });
  return token;
}

/** Spend a token. Returns the user, or null if it is unknown, stale or used. */
export async function consumeLoginToken(db: Db, token: string) {
  const r = await db.execute({
    sql: 'select id, email, expires_at, consumed_at from login_tokens where token_hash = ?',
    args: [hashToken(token)],
  });
  const row = r.rows[0];
  if (!row) return null;
  if (row['consumed_at'] != null) return null;
  if (Number(row['expires_at']) < Date.now()) return null;

  await db.execute({
    sql: 'update login_tokens set consumed_at = ? where id = ?',
    args: [Date.now(), Number(row['id'])],
  });
  return findOrCreateUser(db, String(row['email']));
}

export function magicLinkUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/$/, '')}/auth/magic?t=${encodeURIComponent(token)}`;
}
