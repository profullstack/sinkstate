import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { connect, migrate } from '@sinkstate/db';
import { issueLoginToken, magicLinkUrl, authenticationOptions } from '@sinkstate/auth';
import {
  analyze,
  adapterNames,
  parseGraph,
  toMermaid,
  STATIC_ANALYSIS_NOTE,
  type Graph,
} from '@sinkstate/core';
import { siteUrl, site } from '@/lib/site';

export const runtime = 'nodejs';

const app = new Hono().basePath('/api');

let migrated = false;
async function db() {
  const client = connect();
  if (!migrated) {
    await migrate(client);
    migrated = true;
  }
  return client;
}

app.get('/health', (c) => c.json({ ok: true, service: 'sinkstate' }));

/* ── analysis ─────────────────────────────────────────────────────────────── */

/**
 * The core analysis endpoint. Zero-auth by design: graphs are proprietary and a
 * login gate kills adoption, so nothing here is persisted and nothing is logged.
 *
 * Accepts either the IR directly (`{entry, goal, nodes, edges}`) or raw source
 * plus an optional adapter name (`{source: "flowchart TD…"}`).
 */
const MAX_INPUT_BYTES = 1_000_000;

interface AnalyzeBody {
  source?: string;
  adapter?: string;
  entry?: string;
  goal?: string[];
  unsafe?: string[];
  [key: string]: unknown;
}

function runAnalysis(body: AnalyzeBody) {
  const source =
    typeof body.source === 'string' ? body.source : JSON.stringify(body);

  if (source.length > MAX_INPUT_BYTES) {
    throw Object.assign(new Error(`graph exceeds ${MAX_INPUT_BYTES} bytes`), { status: 413 });
  }

  const parsed = parseGraph(source, {
    ...(body.adapter ? { adapter: body.adapter } : {}),
    ...(body.entry ? { entry: body.entry } : {}),
    ...(body.goal ? { goal: body.goal } : {}),
    ...(body.unsafe ? { unsafe: body.unsafe } : {}),
  });

  if (parsed.missing.length > 0) {
    throw Object.assign(
      new Error(
        `the ${parsed.adapter} adapter could not determine: ${parsed.missing.join('; ')}`,
      ),
      { status: 422, missing: parsed.missing },
    );
  }

  const analysis = analyze(parsed.graph);
  return {
    adapter: parsed.adapter,
    inferred: parsed.inferred,
    note: STATIC_ANALYSIS_NOTE,
    graph: parsed.graph,
    mermaid: toMermaid(parsed.graph, analysis),
    ...analysis,
  };
}

app.post('/v1/analyze', async (c) => {
  let body: AnalyzeBody;
  try {
    body = await c.req.json<AnalyzeBody>();
  } catch {
    return c.json({ error: 'body must be JSON' }, 400);
  }

  try {
    return c.json(runAnalysis(body));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    const missing = (err as { missing?: string[] }).missing;
    return c.json(
      { error: err instanceof Error ? err.message : 'analysis failed', ...(missing ? { missing } : {}) },
      status as 400,
    );
  }
});

app.get('/v1/adapters', (c) =>
  c.json({
    adapters: adapterNames,
    ir: {
      entry: 'start',
      goal: ['done'],
      unsafe: ['exec_shell'],
      nodes: ['start', 'exec_shell', 'done'],
      edges: [
        ['start', 'exec_shell'],
        ['exec_shell', 'done'],
      ],
    },
    note: STATIC_ANALYSIS_NOTE,
  }),
);

/* ── MCP ──────────────────────────────────────────────────────────────────── */

const MCP_TOOLS = [
  {
    name: 'analyze_graph',
    description:
      'Find the states an agent graph can enter but never leave. Returns the dead set, a witness path into each, and four decidable properties: reachable, branch-stable, safe-reachable, safe-stable. Accepts the JSON IR, a LangGraph export, an n8n workflow or a mermaid diagram.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'The graph: JSON IR, LangGraph export, n8n workflow export, or mermaid diagram source.',
        },
        adapter: { type: 'string', enum: adapterNames, description: 'Force an adapter instead of auto-detecting.' },
        entry: { type: 'string', description: 'Entry state, when the adapter cannot infer it.' },
        goal: { type: 'array', items: { type: 'string' }, description: 'Goal ("done") states.' },
        unsafe: { type: 'array', items: { type: 'string' }, description: 'States a safe path may not cross.' },
      },
      required: ['source'],
    },
  },
];

/**
 * MCP over Streamable HTTP. An agent checking its own graph is pleasingly
 * recursive and genuinely useful, so this speaks the same query layer as the
 * REST endpoint rather than a reduced version of it.
 */
app.post('/mcp', async (c) => {
  let message: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    message = await c.req.json();
  } catch {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }, 400);
  }

  const id = message.id ?? null;
  const reply = (result: unknown) => c.json({ jsonrpc: '2.0', id, result });
  const fail = (code: number, msg: string) => c.json({ jsonrpc: '2.0', id, error: { code, message: msg } });

  switch (message.method) {
    case 'initialize':
      return reply({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: site.name, version: '0.1.0' },
      });
    case 'notifications/initialized':
      return c.body(null, 204);
    case 'tools/list':
      return reply({ tools: MCP_TOOLS });
    case 'tools/call': {
      const params = (message.params ?? {}) as { name?: string; arguments?: AnalyzeBody };
      if (params.name !== 'analyze_graph') return fail(-32602, `unknown tool "${params.name}"`);
      try {
        const result = runAnalysis(params.arguments ?? {});
        return reply({
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        });
      } catch (err) {
        return reply({
          content: [{ type: 'text', text: err instanceof Error ? err.message : 'analysis failed' }],
          isError: true,
        });
      }
    }
    default:
      return fail(-32601, `unknown method "${message.method}"`);
  }
});

app.get('/mcp', (c) => c.json({ name: site.name, transport: 'streamable-http', tools: MCP_TOOLS }));

/* ── auth ─────────────────────────────────────────────────────────────────── */

/**
 * Request a sign-in link. Always answers ok:true — whether an address has an
 * account is not something this endpoint should leak, and rate limits report
 * success for the same reason.
 */
app.post('/auth/magic', async (c) => {
  const { email } = await c.req.json<{ email?: string }>();
  if (!email || !email.includes('@')) return c.json({ ok: true });

  const token = await issueLoginToken(await db(), email);
  const link = magicLinkUrl(siteUrl(), token);

  const key = process.env['RESEND_API_KEY'];
  if (!key) {
    // No mail provider configured. Outside production, hand the link back in
    // the response so local sign-in works; never do this in production, where
    // it would let anyone sign in as any address.
    console.log('[auth] magic link for', email, link);
    if (process.env['NODE_ENV'] !== 'production') return c.json({ ok: true, devLink: link });
    return c.json({ ok: true });
  }

  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env['MAIL_FROM'] ?? 'sinkstate <hello@sinkstate.com>',
      to: email,
      subject: 'Your sinkstate sign-in link',
      text: `Sign in: ${link}\n\nThis link expires in 15 minutes.`,
    }),
  });

  // A failed send used to be swallowed: the endpoint returned ok:true whether
  // or not the mail provider accepted it, so an unverified sending domain looked
  // exactly like success. Still ok:true to the caller (no address enumeration),
  // but it is no longer silent on our side.
  if (!sent.ok) {
    console.error('[auth] resend rejected the send', sent.status, await sent.text().catch(() => ''));
  }

  return c.json({ ok: true });
});

app.get('/auth/passkey/options', async (c) => c.json(await authenticationOptions(siteUrl())));

export const GET = handle(app);
export const POST = handle(app);
export type { Graph };
