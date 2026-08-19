import { siteUrl } from '@/lib/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `curl -fsSL https://sinkstate.com/install.sh | sh`
 *
 * The installer is generated so the origin it downloads from is always the
 * origin it was fetched from — a hard-coded domain would break every preview
 * deployment and quietly install the production binary instead.
 */
export function GET(): Response {
  const origin = siteUrl().replace(/\/$/, '');

  const script = `#!/bin/sh
# sinkstate installer — https://sinkstate.com
# Downloads a single dependency-free file and puts it on your PATH.
set -eu

ORIGIN="\${SINKSTATE_ORIGIN:-${origin}}"
BIN_DIR="\${SINKSTATE_BIN_DIR:-\$HOME/.local/bin}"
TARGET="\$BIN_DIR/sinkstate"

if ! command -v node >/dev/null 2>&1; then
  echo "sinkstate needs node 22 or newer on your PATH." >&2
  exit 1
fi

MAJOR=\$(node -p 'process.versions.node.split(".")[0]')
if [ "\$MAJOR" -lt 22 ]; then
  echo "sinkstate needs node 22 or newer (found \$(node -v))." >&2
  exit 1
fi

mkdir -p "\$BIN_DIR"

TMP=\$(mktemp)
trap 'rm -f "\$TMP"' EXIT INT TERM

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "\$ORIGIN/cli/sinkstate" -o "\$TMP"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "\$TMP" "\$ORIGIN/cli/sinkstate"
else
  echo "need curl or wget to download sinkstate." >&2
  exit 1
fi

# Refuse a truncated or error-page download rather than installing it.
if ! head -n 1 "\$TMP" | grep -q '^#!/usr/bin/env node'; then
  echo "downloaded file does not look like the sinkstate CLI; aborting." >&2
  exit 1
fi

chmod +x "\$TMP"
mv "\$TMP" "\$TARGET"
trap - EXIT INT TERM

echo "installed \$TARGET"

case ":\$PATH:" in
  *":\$BIN_DIR:"*) ;;
  *) echo "note: \$BIN_DIR is not on your PATH — add it to use \\\`sinkstate\\\` directly." ;;
esac

echo
echo "try it:"
echo "  sinkstate --help"
`;

  return new Response(script, {
    headers: {
      'content-type': 'text/x-shellscript; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
