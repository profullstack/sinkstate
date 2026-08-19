import { connect, migrate } from '@sinkstate/db';

/**
 * The reaper: prunes expired shared reports and recomputes cached analyses.
 *
 * This runs as a second process inside the SAME Railway container as the web
 * server (see docker-entrypoint.sh), not as its own service.
 */
const INTERVAL = Number(process.env['WORKER_INTERVAL_MS'] ?? 60_000);

async function tick(): Promise<void> {
  // TODO: prunes expired shared reports and recomputes cached analyses
}

async function main(): Promise<void> {
  const db = connect();
  const applied = await migrate(db);
  if (applied.length) console.log(`[reaper] applied migrations: ${applied.join(', ')}`);
  console.log(`[reaper] up, interval=${INTERVAL}ms`);

  for (;;) {
    try {
      await tick();
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
