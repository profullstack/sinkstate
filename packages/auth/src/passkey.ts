import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { Db } from '@sinkstate/db';

/**
 * rpID is derived from SITE_URL, so a credential registered on the apex is
 * invisible on any other host. Keep SITE_URL equal to the host users visit.
 */
export function rpIdFrom(siteUrl: string): string {
  return new URL(siteUrl).hostname;
}

export async function registrationOptions(db: Db, userId: number, email: string, siteUrl: string) {
  const existing = await db.execute({
    sql: 'select credential_id from passkeys where user_id = ?',
    args: [userId],
  });
  return generateRegistrationOptions({
    rpName: 'sinkstate',
    rpID: rpIdFrom(siteUrl),
    userName: email,
    attestationType: 'none',
    excludeCredentials: existing.rows.map((r) => ({ id: String(r['credential_id']) })),
    authenticatorSelection: {
      // residentKey required keeps credentials discoverable so a password
      // manager can sync them. Deliberately leave authenticatorAttachment and
      // preferredAuthenticatorType unset — naming either makes browsers stop
      // offering the alternatives, and managers vanish from the picker.
      residentKey: 'required',
      userVerification: 'preferred',
    },
  });
}

export async function verifyRegistration(
  db: Db,
  userId: number,
  response: Parameters<typeof verifyRegistrationResponse>[0]['response'],
  expectedChallenge: string,
  siteUrl: string,
): Promise<boolean> {
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: siteUrl,
    expectedRPID: rpIdFrom(siteUrl),
  });
  if (!verification.verified || !verification.registrationInfo) return false;

  const { credential } = verification.registrationInfo;
  await db.execute({
    sql: `insert into passkeys (user_id, credential_id, public_key, counter, transports, created_at)
          values (?, ?, ?, ?, ?, ?)`,
    args: [
      userId,
      credential.id,
      Buffer.from(credential.publicKey).toString('base64url'),
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      Date.now(),
    ],
  });
  return true;
}

export async function authenticationOptions(siteUrl: string) {
  return generateAuthenticationOptions({
    rpID: rpIdFrom(siteUrl),
    userVerification: 'preferred',
  });
}

export async function verifyAuthentication(
  db: Db,
  response: Parameters<typeof verifyAuthenticationResponse>[0]['response'],
  expectedChallenge: string,
  siteUrl: string,
): Promise<{ userId: number } | null> {
  const r = await db.execute({
    sql: 'select user_id, credential_id, public_key, counter, transports from passkeys where credential_id = ?',
    args: [response.id],
  });
  const row = r.rows[0];
  if (!row) return null;

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: siteUrl,
    expectedRPID: rpIdFrom(siteUrl),
    credential: {
      id: String(row['credential_id']),
      publicKey: new Uint8Array(Buffer.from(String(row['public_key']), 'base64url')),
      counter: Number(row['counter']),
      transports: JSON.parse(String(row['transports'] ?? '[]')),
    },
  });
  if (!verification.verified) return null;

  await db.execute({
    sql: 'update passkeys set counter = ? where credential_id = ?',
    args: [verification.authenticationInfo.newCounter, String(row['credential_id'])],
  });
  return { userId: Number(row['user_id']) };
}
