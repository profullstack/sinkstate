import { NextResponse } from 'next/server';
import { connect } from '@sinkstate/db';
import { consumeLoginToken, startSession, sessionCookie } from '@sinkstate/auth';
import { siteUrl } from '@/lib/site';

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('t');
  if (!token) return NextResponse.redirect(new URL('/login?e=missing', siteUrl()));

  const db = connect();
  const user = await consumeLoginToken(db, token);
  if (!user) return NextResponse.redirect(new URL('/login?e=expired', siteUrl()));

  const session = await startSession(db, user.id);
  const res = NextResponse.redirect(new URL('/', siteUrl()));
  res.headers.set('set-cookie', sessionCookie(session, siteUrl().startsWith('https')));
  return res;
}
