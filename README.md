# sinkstate

> Which states can your agent enter but never leave?

sinkstate takes an agent graph and computes the four developmental modal properties on it: can it finish at all, can every state it reaches still finish, is there a path to done that never crosses an unsafe state, and both at once. It returns the dead set and a witness path, not just a boolean.

[sinkstate.com](https://sinkstate.com) · MIT licensed · built by [Profullstack, Inc.](https://profullstack.com)

## Stack

| Layer | Choice |
| --- | --- |
| Web / SSR / PWA | Next.js 16 (App Router, TypeScript) |
| UI | Tailwind v4 + shadcn-style components |
| API | Hono, mounted inside Next at `/api/*` |
| Database | Turso / libSQL |
| Auth | Magic link + passkey — no passwords |
| Deploy | Railway, one service, Docker |

## Layout

```
apps/
  web/      Next.js app; Hono API at src/app/api/[[...route]]
  worker/   background reaper — prunes expired shared reports and recomputes cached analyses
packages/
  db/       Turso client, queries and forward-only migrations
  auth/     magic link, passkey, session
```

## Develop

```bash
pnpm install
cp .env.example .env.local        # then fill in Turso + Resend
pnpm dev
```

No Turso account needed locally — `TURSO_DATABASE_URL` accepts a `file:` URL:

```bash
TURSO_DATABASE_URL=file:./local.db pnpm dev
```

Migrations apply themselves on boot, so a new `packages/db/migrations/*.sql`
ships with a deploy and needs no manual step.

## Deployment

**One Railway service.** `docker-entrypoint.sh` starts the worker and the Next
server in the same container; the Hono API is mounted inside Next rather than
run separately, because Railway exposes a single port. Adding a second Railway
service for the worker is explicitly not the design.

Two traps worth knowing, both learned the hard way on sibling projects:

- Do **not** set `output: 'standalone'` in `next.config.mjs`. Its dependency
  tracing does not survive pnpm's symlinked store and the server dies on boot
  with `MODULE_NOT_FOUND`.
- Do **not** pass `-p` to `next start`. Railway injects `PORT`; hardcoding one
  leaves the edge proxy forwarding to a closed port while the container reports
  healthy.

## Feeds

`/feed.xml` publishes releases and notes from the sinkstate project. It is a plain RSS 2.0
document, submitted to [rssamplifier.com](https://rssamplifier.com).

## License

MIT
