import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { connect, migrate } from '@sinkstate/db';
import { issueLoginToken, magicLinkUrl, authenticationOptions } from '@sinkstate/auth';
import { siteUrl } from '@/lib/site';

export const runtime = 'nodejs';

const app = new Hono().basePath('/api');

let migrated = false;
async function db() {
  const client = connect();
  if (!migrated) {
    await migrate(client);
    migrated = true;
  }
  return client;
}

app.get('/health', (c) => c.json({ ok: true, service: 'sinkstate' }));

/**
 * Request a sign-in link. Always answers ok:true — whether an address has an
 * account is not something this endpoint should leak, and rate limits report
 * success for the same reason.
 */
app.post('/auth/magic', async (c) => {
  const { email } = await c.req.json<{ email?: string }>();
  if (!email || !email.includes('@')) return c.json({ ok: true });

  const token = await issueLoginToken(await db(), email);
  const link = magicLinkUrl(siteUrl(), token);

  const key = process.env['RESEND_API_KEY'];
  if (!key) {
    // No mail provider configured. Outside production, hand the link back in
    // the response so local sign-in works; never do this in production, where
    // it would let anyone sign in as any address.
    console.log('[auth] magic link for', email, link);
    if (process.env['NODE_ENV'] !== 'production') return c.json({ ok: true, devLink: link });
    return c.json({ ok: true });
  }

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env['MAIL_FROM'] ?? 'sinkstate <hello@sinkstate.com>',
      to: email,
      subject: 'Your sinkstate sign-in link',
      text: `Sign in: ${link}\n\nThis link expires in 15 minutes.`,
    }),
  });

  return c.json({ ok: true });
});

app.get('/auth/passkey/options', async (c) => c.json(await authenticationOptions(siteUrl())));

export const GET = handle(app);
export const POST = handle(app);
