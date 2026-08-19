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
  cli/      the `sinkstate` CLI, bundled to one dependency-free file
  worker/   background reaper — prunes expired auth rows
packages/
  core/     the engine: graph IR in, result out, no I/O, no dependencies
  db/       Turso client, queries and forward-only migrations
  auth/     magic link, passkey, session
action/     the GitHub Action: action.yml at the repo root, runner + committed bundle here
```

## Use it

```bash
curl -fsSL https://sinkstate.com/install.sh | sh

sinkstate graph.json
cat graph.json | sinkstate
sinkstate graph.json --require reachable,branch-stable --json
sinkstate graph.json --mermaid
```

Exit `0` when every required property passes, `1` when one fails, `2` when the
graph could not be read — so it drops into CI unchanged.

In a workflow:

```yaml
- uses: profullstack/sinkstate@v1
  with:
    files: 'graphs/**/*.json'
```

Over HTTP, unauthenticated, persisting nothing:

```bash
curl -X POST https://sinkstate.com/api/v1/analyze \
  -H 'content-type: application/json' \
  -d '{"source":"stateDiagram-v2\n  [*] --> a\n  a --> b\n  b --> [*]"}'
```

## The engine

`packages/core` is a pure function with no dependencies and no I/O, which is what
lets the CLI, the GitHub Action, the Hono API, the MCP server and the browser
paste flow all be the same few hundred lines. It is also why the paste flow can
analyse in the browser: a proprietary graph never leaves the machine.

Two reverse breadth-first passes and two forward ones, `O(N+E)` throughout:

| Property | Modal form | Question |
| --- | --- | --- |
| reachable | `◇*G` | Can this graph finish at all? |
| branch-stable | `□*◇*G` | Can every state it can enter still finish? |
| safe-reachable | `◇*_safe G` | Is there a path to done that never crosses an unsafe state? |
| safe-stable | `□*_safe ◇*_safe G` | Both at once. |

Every result carries a witness: the concrete path into the dead state, and — when
a safe path does not exist — which unsafe states every route to done must cross,
with the ones whose removal alone severs entry from goal marked `unavoidable`.

## Formats

`json` (the IR), `langgraph`, `n8n`, `mermaid`. The IR always works and is the
documented contract:

```json
{
  "entry": "start",
  "goal": ["done"],
  "unsafe": ["exec_shell"],
  "nodes": ["start", "plan", "exec_shell", "retry", "done"],
  "edges": [["start","plan"], ["plan","exec_shell"], ["exec_shell","done"],
            ["exec_shell","retry"], ["retry","retry"]]
}
```

Adapters never invent an entry or a goal they cannot read. An n8n workflow and a
mermaid flowchart have no terminal concept, so inferring "any node with no
outgoing edge is done" would define away exactly the bug this tool looks for —
they report what is missing and the CLI exits `2` until you supply it.

CrewAI is deliberately unsupported: its flows are Python decorators with no
serialised form stable enough to parse without running Python, and a parser
written against a guessed shape would produce confidently wrong verdicts.

## What it does not do

sinkstate analyses the **declared** graph, not runtime behaviour. A conditional
edge is treated as always traversable. It is not a runtime monitor, not a fixer
and not an evaluator.

## The GitHub Action bundle

`action/sinkstate.mjs` is a build artifact committed on purpose — that is how JS
actions are distributed, and it means `uses: profullstack/sinkstate@v1` needs no
install step and no dependency on sinkstate.com being reachable. It is written by
`pnpm --filter sinkstate build`, and `apps/cli/test/action.test.js` fails if the
committed copy drifts from a fresh build.

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
