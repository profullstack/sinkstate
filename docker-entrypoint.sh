#!/bin/sh
# One Railway service, two processes: the Next server (which also serves the
# Hono API) and the background worker. Deliberately NOT a second Railway
# service — see README "Deployment".
set -e

cd /repo

if [ "${WORKER_ENABLED:-true}" = "true" ]; then
  echo "[entrypoint] starting worker"
  node apps/worker/dist/index.js &
  WORKER_PID=$!
  # If the worker dies, take the container down so Railway restarts the whole
  # thing rather than silently serving traffic with no background processing.
  trap 'kill -TERM $WORKER_PID 2>/dev/null || true' TERM INT
else
  echo "[entrypoint] worker disabled (WORKER_ENABLED=$WORKER_ENABLED)"
fi

echo "[entrypoint] starting web"
cd /repo/apps/web
exec node_modules/.bin/next start
