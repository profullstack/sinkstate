import Link from 'next/link';
import { adapterNames, STATIC_ANALYSIS_NOTE } from '@sinkstate/core';

export const metadata = { title: 'Docs' };

const PROPERTIES = [
  ['reachable', '◇*G', 'Can this graph finish at all?'],
  ['branch-stable', '□*◇*G', 'Can every state it can enter still finish? The one that catches real bugs.'],
  ['safe-reachable', '◇*_safe G', 'Is there a path to done that never crosses a state you marked unsafe?'],
  ['safe-stable', '□*_safe ◇*_safe G', 'Both at once — the only real guarantee.'],
];

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-md border bg-muted/30 p-4 font-mono text-xs">
      {children}
    </pre>
  );
}

export default function DocsPage() {
  return (
    <article className="max-w-3xl py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Docs</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        An agent graph is a state machine, and nobody checks their state machines. sinkstate finds
        the states yours can enter but never leave.
      </p>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">The four properties</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2 pr-4 font-medium">Property</th>
              <th className="py-2 pr-4 font-medium">Modal form</th>
              <th className="py-2 font-medium">Question</th>
            </tr>
          </thead>
          <tbody>
            {PROPERTIES.map(([name, modal, question]) => (
              <tr key={name} className="border-t align-top">
                <td className="py-2 pr-4 font-mono">{name}</td>
                <td className="py-2 pr-4 font-mono text-muted-foreground">{modal}</td>
                <td className="py-2 text-muted-foreground">{question}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Each is decided by breadth-first search in O(N+E). A failing property returns a witness —
        the concrete path into the dead state — because a boolean nobody can act on is worthless.
      </p>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">The graph IR</h2>
      <p className="mt-2 text-muted-foreground">
        Every adapter produces this shape, and it always works. It is the documented contract and
        the escape hatch when a framework adapter rots.
      </p>
      <Code>{`{
  "entry": "start",
  "goal": ["done"],
  "unsafe": ["exec_shell"],
  "nodes": ["start", "plan", "exec_shell", "retry", "done"],
  "edges": [
    ["start", "plan"],
    ["plan", "exec_shell"],
    ["exec_shell", "done"],
    ["exec_shell", "retry"],
    ["retry", "retry"]
  ]
}`}</Code>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">CLI</h2>
      <Code>{`curl -fsSL https://sinkstate.com/install.sh | sh

sinkstate graph.json
cat graph.json | sinkstate
sinkstate graph.json --require reachable,branch-stable --json`}</Code>
      <p className="mt-3 text-sm text-muted-foreground">
        Exit 0 when every required property passes, 1 when one fails, 2 when the graph could not be
        read — so it drops into CI unchanged.
      </p>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">GitHub Action</h2>
      <Code>{`- uses: profullstack/sinkstate@v1
  with:
    files: 'graphs/**/*.json'
    require: 'reachable,branch-stable'`}</Code>
      <p className="mt-3 text-sm text-muted-foreground">
        Comments the dead states on the pull request, updating one comment rather than appending a
        new one on every push. Needs <code className="font-mono">pull-requests: write</code>.
      </p>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">API</h2>
      <p className="mt-2 text-muted-foreground">
        Unauthenticated. Nothing is persisted and nothing is logged — graphs are proprietary.
      </p>
      <Code>{`curl -X POST https://sinkstate.com/api/v1/analyze \\
  -H 'content-type: application/json' \\
  -d '{"source":"stateDiagram-v2\\n  [*] --> a\\n  a --> b\\n  b --> [*]"}'`}</Code>
      <p className="mt-3 text-sm text-muted-foreground">
        A 422 means the format could not declare something the analysis needs, usually the goal.
        Supply it rather than trusting a guess.
      </p>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">MCP</h2>
      <p className="mt-2 text-muted-foreground">
        <code className="font-mono">/api/mcp</code> speaks streamable-http and exposes one tool,{' '}
        <code className="font-mono">analyze_graph</code>, so an agent can check its own graph.
      </p>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">Formats</h2>
      <ul className="mt-2 list-disc pl-5 text-muted-foreground">
        {adapterNames.map((name) => (
          <li key={name} className="font-mono">
            {name}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted-foreground">
        CrewAI is not supported: its flows are Python decorators with no serialised form stable
        enough to parse without running Python, and a parser written against a guessed shape would
        produce confidently wrong verdicts. Export to the JSON IR instead.
      </p>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">What this does not do</h2>
      <p className="mt-2 text-muted-foreground">{STATIC_ANALYSIS_NOTE}</p>
      <p className="mt-3 text-muted-foreground">
        It is not a runtime monitor, not a fixer, and not an evaluator. A conditional edge whose
        predicate never fires in practice is still an edge here.
      </p>

      <p className="mt-12">
        <Link href="/analyze" className="underline underline-offset-4">
          Analyze a graph →
        </Link>
      </p>
    </article>
  );
}
