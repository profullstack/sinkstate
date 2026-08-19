import { adapterNames, STATIC_ANALYSIS_NOTE } from '@sinkstate/core';
import { site, siteUrl } from '@/lib/site';

export const runtime = 'nodejs';

export function GET() {
  const base = siteUrl();
  const body = `# ${site.name}

> ${site.description}

An agent graph is a state machine. ${site.name} finds the states it can enter but
never leave: the retry loop with no exit edge, the error branch that only routes
to itself, the tool-failure node someone forgot to wire onward. It answers four
decidable properties in O(N+E), and returns a witness path rather than a boolean.

${STATIC_ANALYSIS_NOTE}

## Properties

- reachable (◇*G) — can this graph finish at all?
- branch-stable (□*◇*G) — can every state it can enter still finish? This is the one that catches real bugs.
- safe-reachable (◇*_safe G) — is there a path to done that never crosses a state marked unsafe?
- safe-stable (□*_safe ◇*_safe G) — both at once.

## Analyse a graph

POST ${base}/api/v1/analyze

Zero-auth. Nothing is persisted and nothing is logged.

Body is either the graph IR directly:

    {"entry":"start","goal":["done"],"unsafe":["exec_shell"],
     "nodes":["start","exec_shell","retry","done"],
     "edges":[["start","exec_shell"],["exec_shell","done"],
              ["exec_shell","retry"],["retry","retry"]]}

or raw source in any supported format:

    {"source":"stateDiagram-v2\\n  [*] --> a\\n  a --> b\\n  b --> [*]"}

Optional keys: adapter, entry, goal, unsafe.

The response carries: dead (each with a cause, the component it is trapped in,
and a witness path from the entry), reachableDead, the four properties, unsafeCut
(with unavoidable: true when every path to done crosses that state), and a
mermaid rendering.

A 422 means the format could not declare something the analysis needs — usually
the goal. Supply it rather than trusting a guess.

## Formats

${adapterNames.map((n) => `- ${n}`).join('\n')}

CrewAI is not supported: its flows are Python decorators with no serialised form
stable enough to parse without running Python. Export to the JSON IR instead.

## Other surfaces

- MCP: ${base}/api/mcp (streamable-http, one tool: analyze_graph)
- Adapters + IR example: ${base}/api/v1/adapters
- CLI: curl -fsSL ${base}/install.sh | sh
- Badge: ${base}/badge.svg?stable=true&dead=0
- Feed: ${base}/feed.xml
- Health: ${base}/api/health
- Source: https://github.com/profullstack/${site.name} (MIT)

Everything readable here is unauthenticated.
`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
