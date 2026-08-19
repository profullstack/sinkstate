export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLORS = {
  pass: '#22c55e',
  fail: '#ef4444',
  unknown: '#9ca3af',
} as const;

/** Rough advance width for 11px DejaVu Sans — good enough to centre a label. */
function width(text: string): number {
  let w = 0;
  for (const ch of text) w += /[ilj.,:'|!]/.test(ch) ? 3 : /[A-Z@%]/.test(ch) ? 8 : 6.2;
  return Math.ceil(w);
}

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string,
  );
}

function badge(label: string, message: string, color: string): string {
  const lw = width(label) + 12;
  const mw = width(message) + 12;
  const total = lw + mw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escapeXml(label)}: ${escapeXml(message)}">
  <title>${escapeXml(label)}: ${escapeXml(message)}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${mw}" height="20" fill="${color}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>
    <text x="${lw / 2}" y="14">${escapeXml(label)}</text>
    <text x="${lw + mw / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(message)}</text>
    <text x="${lw + mw / 2}" y="14">${escapeXml(message)}</text>
  </g>
</svg>`;
}

/**
 * Shields-style badge, driven by query parameters rather than by a stored
 * report: the analyzer persists nothing, so there is no server-side result to
 * look up. The GitHub Action computes the numbers and links here, which is the
 * same trust model as any CI badge.
 *
 *   /badge.svg?stable=true&dead=0   →  sinkstate | stable · 0 dead
 *   /badge.svg?stable=false&dead=3  →  sinkstate | 3 dead states
 */
export function GET(request: Request): Response {
  const params = new URL(request.url).searchParams;
  const deadRaw = params.get('dead');
  const stableRaw = params.get('stable');

  const dead = deadRaw === null ? null : Number.parseInt(deadRaw, 10);
  const deadKnown = dead !== null && Number.isFinite(dead) && dead >= 0;
  const stable = stableRaw === null ? null : stableRaw === 'true';

  let message: string;
  let color: string;

  if (stable === null && !deadKnown) {
    message = 'unknown';
    color = COLORS.unknown;
  } else if (stable === false || (deadKnown && (dead as number) > 0)) {
    const n = deadKnown ? (dead as number) : 0;
    message = deadKnown ? `${n} dead state${n === 1 ? '' : 's'}` : 'unstable';
    color = COLORS.fail;
  } else {
    message = deadKnown ? `stable · ${dead} dead` : 'stable';
    color = COLORS.pass;
  }

  return new Response(badge(params.get('label') ?? 'sinkstate', message, color), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      // Short cache: a badge that lags a fixed graph by an hour is worse than useless.
      'cache-control': 'public, max-age=60, s-maxage=60',
    },
  });
}
