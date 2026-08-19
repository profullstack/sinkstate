import { site, siteUrl } from '@/lib/site';

export const dynamic = 'force-dynamic';

interface Item {
  title: string;
  link: string;
  description: string;
  pubDate: Date;
  guid: string;
}

const FEED_TITLE = 'sinkstate — changelog';
const FEED_DESC = 'Releases and notes from the sinkstate project.';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control bytes make the whole document unparseable, and titles are
    // third-party text.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

async function items(): Promise<Item[]> {
  // TODO: releases and changelog entries, newest first
  return [];
}

export async function GET() {
  const base = siteUrl();
  const entries = await items();

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(FEED_TITLE)}</title>
    <link>${base}</link>
    <description>${esc(FEED_DESC)}</description>
    <language>en</language>
    <atom:link href="${base}/feed.xml" rel="self" type="application/rss+xml" />
${entries
  .map(
    (i) => `    <item>
      <title>${esc(i.title)}</title>
      <link>${esc(i.link)}</link>
      <guid isPermaLink="false">${esc(i.guid)}</guid>
      <pubDate>${i.pubDate.toUTCString()}</pubDate>
      <description>${esc(i.description)}</description>
    </item>`,
  )
  .join('\n')}
  </channel>
</rss>`;

  return new Response(body, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
