'use client';

import { useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * One implementation behind both /login and /signup so the two cannot drift.
 * Only the wording differs — magic-link consumption creates the account, so
 * there is no separate registration flow.
 */
export function SignInPanels({ mode }: { mode: 'login' | 'signup' }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fetch('/api/auth/magic', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      // Always report success: whether an address has an account is not
      // something this endpoint should reveal.
      setSent(true);
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function usePasskey() {
    setBusy(true);
    setError(null);
    try {
      const options = await fetch('/api/auth/passkey/options').then((r) => r.json());
      const assertion = await startAuthentication({ optionsJSON: options });
      const res = await fetch('/api/auth/passkey/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(assertion),
      });
      if (res.ok) window.location.href = '/';
      else setError('That passkey was not recognised.');
    } catch {
      setError('Passkey sign-in was cancelled.');
    } finally {
      setBusy(false);
    }
  }

  const heading = mode === 'signup' ? 'Create your account' : 'Sign in';
  const blurb =
    mode === 'signup'
      ? 'Enter your email and we will send a link that creates your account.'
      : 'Enter your email and we will send you a sign-in link.';

  return (
    <div className="mx-auto grid w-full max-w-md gap-4 py-24">
      <Card>
        <CardHeader>
          <CardTitle>{heading}</CardTitle>
          <CardDescription>{blurb}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {sent ? (
            <p className="text-sm text-muted-foreground">
              If that address can receive mail, a link is on its way. It expires in 15 minutes.
            </p>
          ) : (
            <form onSubmit={sendLink} className="grid gap-3">
              <Input
                type="email"
                required
                autoComplete="email webauthn"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Email me a link'}
              </Button>
            </form>
          )}

          <div className="relative py-2 text-center text-xs text-muted-foreground">
            <span className="bg-card px-2">or</span>
          </div>

          <Button variant="outline" onClick={usePasskey} disabled={busy}>
            Use a passkey
          </Button>

          {error ? <p className="text-sm text-[var(--color-bad)]">{error}</p> : null}
        </CardContent>
      </Card>

      <p className="text-center text-sm text-muted-foreground">
        No passwords here — ever. A link proves your address, and a passkey is the fast way back.
      </p>
    </div>
  );
}
