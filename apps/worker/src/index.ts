import { connect, migrate, pruneExpired } from '@sinkstate/db';

/**
 * The reaper.
 *
 * This runs as a second process inside the SAME Railway container as the web
 * server (see docker-entrypoint.sh), not as its own service.
 *
 * It prunes expired auth rows. Pruning shared reports — the job the PRD names —
 * is waiting on permalinks, which are deliberately v2: the paste flow analyses
 * in the browser and persists nothing, so there is nothing to expire yet.
 */
const INTERVAL = Number(process.env['WORKER_INTERVAL_MS'] ?? 60_000);

async function tick(db: ReturnType<typeof connect>): Promise<void> {
  const pruned = await pruneExpired(db);
  if (pruned.loginTokens || pruned.sessions) {
    console.log(
      `[reaper] pruned ${pruned.loginTokens} expired login token(s), ${pruned.sessions} expired session(s)`,
    );
  }
}

async function main(): Promise<void> {
  const db = connect();
  const applied = await migrate(db);
  if (applied.length) console.log(`[reaper] applied migrations: ${applied.join(', ')}`);
  console.log(`[reaper] up, interval=${INTERVAL}ms`);

  for (;;) {
    try {
      await tick(db);
    } catch (err) {
      console.error('[reaper] tick failed', err);
    }
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}

main().catch((err) => {
  console.error('[reaper] fatal', err);
  process.exit(1);
});
