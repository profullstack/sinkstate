import { readCliBundle } from '@/lib/cli-bundle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The single-file CLI, served from source at request time. */
export async function GET(): Promise<Response> {
  const source = await readCliBundle();
  if (!source) {
    return new Response('the CLI bundle is missing from this deployment\n', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(source, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
