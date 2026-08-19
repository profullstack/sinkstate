'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  analyze,
  parseGraph,
  toMermaid,
  PROPERTY_KEYS,
  PROPERTY_LABELS,
  STATIC_ANALYSIS_NOTE,
  type Analysis,
  type Graph,
} from '@sinkstate/core';
import { Button } from '@/components/ui/button';

const EXAMPLE = `{
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
}`;

interface Result {
  adapter: string;
  inferred: string[];
  graph: Graph;
  analysis: Analysis;
  mermaid: string;
}

const VERDICT_STYLES: Record<string, string> = {
  pass: 'border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-400',
  fail: 'border-red-600/40 bg-red-600/10 text-red-700 dark:text-red-400',
  'not-applicable': 'border-border bg-muted/40 text-muted-foreground',
};

/**
 * The paste flow. Analysis runs entirely in the browser — the engine is a pure
 * function with no I/O, so a proprietary graph never leaves the machine. That
 * is the whole reason the core package is isomorphic.
 */
export function Analyzer() {
  const [input, setInput] = useState('');
  const [entry, setEntry] = useState('');
  const [goal, setGoal] = useState('');
  const [unsafe, setUnsafe] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  const list = (value: string) =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const run = useCallback(() => {
    setError(null);
    setMissing([]);
    setResult(null);
    if (!input.trim()) {
      setError('Paste a graph first.');
      return;
    }
    try {
      const parsed = parseGraph(input, {
        ...(entry ? { entry } : {}),
        ...(list(goal).length ? { goal: list(goal) } : {}),
        ...(list(unsafe).length ? { unsafe: list(unsafe) } : {}),
      });
      if (parsed.missing.length) {
        setMissing(parsed.missing);
        return;
      }
      const analysis = analyze(parsed.graph);
      setResult({
        adapter: parsed.adapter,
        inferred: parsed.inferred,
        graph: parsed.graph,
        analysis,
        mermaid: toMermaid(parsed.graph, analysis),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not analyse that graph');
    }
  }, [input, entry, goal, unsafe]);

  const deadCount = result?.analysis.dead.length ?? 0;
  const headline = useMemo(() => {
    if (!result) return null;
    if (deadCount === 0) return 'No dead states. Every state can still reach done.';
    const reachable = result.analysis.reachableDead.length;
    return `${deadCount} dead state${deadCount === 1 ? '' : 's'}${
      reachable ? `, ${reachable} reachable from the entry` : ' (none reachable from the entry)'
    }.`;
  }, [result, deadCount]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="graph" className="text-sm font-medium">
            Your graph
          </label>
          <button
            type="button"
            onClick={() => setInput(EXAMPLE)}
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Load an example
          </button>
        </div>
        <textarea
          id="graph"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          rows={14}
          placeholder="Paste a JSON graph, a LangGraph export, an n8n workflow, or a mermaid diagram…"
          className="w-full resize-y rounded-md border bg-background p-4 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-sm text-muted-foreground">
          Nothing is uploaded. The analysis runs in your browser.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { id: 'entry', label: 'Entry state', value: entry, set: setEntry, placeholder: 'start' },
          { id: 'goal', label: 'Goal states', value: goal, set: setGoal, placeholder: 'done, finished' },
          { id: 'unsafe', label: 'Unsafe states', value: unsafe, set: setUnsafe, placeholder: 'exec_shell' },
        ].map((field) => (
          <div key={field.id} className="flex flex-col gap-1.5">
            <label htmlFor={field.id} className="text-sm font-medium">
              {field.label}
            </label>
            <input
              id={field.id}
              value={field.value}
              onChange={(e) => field.set(e.target.value)}
              placeholder={field.placeholder}
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        ))}
      </div>

      <div>
        <Button onClick={run} size="lg">
          Analyze
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-red-600/40 bg-red-600/10 p-4 text-sm">{error}</div>
      ) : null}

      {missing.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-600/40 bg-amber-600/10 p-4 text-sm">
          <p className="font-medium">This format does not declare everything the analysis needs:</p>
          <ul className="list-disc pl-5">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Fill in the fields above. Guessing them would make every verdict below meaningless.
          </p>
        </div>
      ) : null}

      {result ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-semibold tracking-tight">{headline}</h2>
            <p className="text-sm text-muted-foreground">
              Read as a <code className="font-mono">{result.adapter}</code> graph —{' '}
              {result.analysis.stats.nodes} states, {result.analysis.stats.edges} transitions.
            </p>
          </div>

          {result.inferred.length > 0 ? (
            <ul className="flex flex-col gap-1 rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
              {result.inferred.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {PROPERTY_KEYS.map((key) => {
              const property = result.analysis[key];
              return (
                <div key={key} className={`rounded-md border p-4 ${VERDICT_STYLES[property.verdict]}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{PROPERTY_LABELS[key]}</span>
                    <span className="font-mono text-xs">{property.modal}</span>
                  </div>
                  <p className="mt-1 text-sm opacity-90">{property.question}</p>
                  {property.reason ? <p className="mt-2 text-sm">{property.reason}</p> : null}
                  {property.witness ? (
                    <p className="mt-2 break-words font-mono text-xs">
                      {property.witness.join(' → ')}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {result.analysis.dead.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-lg font-semibold">Dead states</h3>
              <div className="flex flex-col gap-2">
                {result.analysis.dead.map((dead) => (
                  <div key={dead.state} className="rounded-md border p-4">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono font-medium">{dead.state}</span>
                      <span className="text-sm text-muted-foreground">
                        {dead.cause === 'no-outgoing-edges'
                          ? 'no outgoing transitions'
                          : `trapped in a closed component of ${dead.component.length}`}
                      </span>
                    </div>
                    {dead.witness ? (
                      <p className="mt-2 break-words font-mono text-xs text-muted-foreground">
                        entered via {dead.witness.join(' → ')}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        not reachable from the entry state
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {result.analysis.unsafeCut.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-lg font-semibold">Unsafe states on a path to done</h3>
              <ul className="flex flex-col gap-2">
                {result.analysis.unsafeCut.map((cut) => (
                  <li key={cut.state} className="rounded-md border p-3 text-sm">
                    <span className="font-mono">{cut.state}</span>
                    {cut.unavoidable ? (
                      <span className="ml-2 text-red-600 dark:text-red-400">
                        unavoidable — every path to done crosses it
                      </span>
                    ) : (
                      <span className="ml-2 text-muted-foreground">avoidable</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            <h3 className="text-lg font-semibold">Diagram</h3>
            <p className="text-sm text-muted-foreground">
              Paste into any mermaid renderer, or a GitHub comment.
            </p>
            <pre className="overflow-x-auto rounded-md border bg-muted/30 p-4 font-mono text-xs">
              {result.mermaid}
            </pre>
          </div>

          <p className="text-sm text-muted-foreground">{STATIC_ANALYSIS_NOTE}</p>
        </div>
      ) : null}
    </div>
  );
}
