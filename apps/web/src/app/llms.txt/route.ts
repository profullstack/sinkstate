import { site, siteUrl } from '@/lib/site';

export function GET() {
  const base = siteUrl();
  const body = `# ${site.name}

> ${site.description}

- Feed: ${base}/feed.xml
- API: ${base}/api
- Health: ${base}/api/health
- Source: https://github.com/profullstack/${site.name} (MIT)

Everything readable here is unauthenticated.
`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
