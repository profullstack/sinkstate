#!/bin/sh
# One Railway service, two processes: the Next server (which also serves the
# Hono API) and the background worker. Deliberately NOT a second Railway
# service — see README "Deployment".
set -e

cd /repo

WORKER_PID=''

if [ "${WORKER_ENABLED:-true}" = "true" ]; then
  echo "[entrypoint] starting worker"
  node apps/worker/dist/index.js &
  WORKER_PID=$!
else
  echo "[entrypoint] worker disabled (WORKER_ENABLED=$WORKER_ENABLED)"
fi

echo "[entrypoint] starting web"
cd /repo/apps/web
node_modules/.bin/next start &
WEB_PID=$!

trap 'kill -TERM $WORKER_PID $WEB_PID 2>/dev/null || true' TERM INT

# If either process dies, bring the whole container down so Railway restarts it.
# Previously the entrypoint exec'd the web server and only trapped signals, so a
# worker that crashed on boot left the container healthy and serving traffic
# with no background processing at all — which is exactly how the migration race
# went unnoticed. Silence is not health: supervise both.
while true; do
  if [ -n "$WORKER_PID" ] && ! kill -0 "$WORKER_PID" 2>/dev/null; then
    echo "[entrypoint] worker exited — bringing the container down"
    kill -TERM "$WEB_PID" 2>/dev/null || true
    exit 1
  fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "[entrypoint] web exited — bringing the container down"
    [ -n "$WORKER_PID" ] && kill -TERM "$WORKER_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 5
done
