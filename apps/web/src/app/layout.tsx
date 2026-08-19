import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { site } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  title: { default: `${site.name} — ${site.tagline}`, template: `%s · ${site.name}` },
  description: site.description,
  manifest: '/manifest.webmanifest',
  alternates: { types: { 'application/rss+xml': '/feed.xml' } },
  openGraph: { title: site.name, description: site.description, type: 'website' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
            <Link href="/" className="font-semibold tracking-tight">
              {site.name}
            </Link>
            <nav className="flex items-center gap-6 text-sm text-muted-foreground">
              <Link href="/docs" className="hover:text-foreground">Docs</Link>
              <Link href="/feed.xml" className="hover:text-foreground">Feed</Link>
              <Link href="/login" className="hover:text-foreground">Sign in</Link>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6">{children}</main>

        <footer className="mt-24 border-t">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>
              {site.name} — built by{' '}
              <a href="https://profullstack.com" className="hover:text-foreground underline underline-offset-4">
                Profullstack, Inc.
              </a>
            </p>
            <p className="flex gap-4">
              <a href="/feed.xml" className="hover:text-foreground">RSS</a>
              <a href="/llms.txt" className="hover:text-foreground">llms.txt</a>
              <a href={`https://github.com/profullstack/${site.name}`} className="hover:text-foreground">
                Source
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
