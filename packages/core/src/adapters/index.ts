import type { Adapter, AdapterResult } from './types.js';
import { jsonAdapter } from './json.js';
import { langgraphAdapter } from './langgraph.js';
import { mermaidAdapter } from './mermaid.js';
import { n8nAdapter } from './n8n.js';

export type { Adapter, AdapterResult } from './types.js';
export { jsonAdapter, langgraphAdapter, mermaidAdapter, n8nAdapter };

/**
 * Order matters: the more specific JSON shapes are sniffed before the IR, since
 * a LangGraph export and the IR are both objects with `nodes` and `edges`.
 *
 * CrewAI is deliberately absent. Its flows are Python decorators (`@start`,
 * `@listen`) with no serialised form stable enough to parse without running
 * Python, and a parser written against a guessed shape would silently produce
 * wrong verdicts. Export the flow to the JSON IR instead.
 */
export const adapters: Adapter[] = [langgraphAdapter, n8nAdapter, jsonAdapter, mermaidAdapter];

export const adapterNames = adapters.map((a) => a.name);

export function getAdapter(name: string): Adapter {
  const found = adapters.find((a) => a.name === name);
  if (!found) {
    throw new Error(`unknown adapter "${name}" — available: ${adapterNames.join(', ')}`);
  }
  return found;
}

/** The adapter whose sniff matches, or undefined when none does. */
export function detect(input: string): Adapter | undefined {
  return adapters.find((a) => {
    try {
      return a.matches(input);
    } catch {
      return false;
    }
  });
}

/**
 * Parse with the named adapter, or auto-detect. Overrides are applied after
 * parsing so a caller can always supply what an adapter could not infer.
 */
export function parseGraph(
  input: string,
  options: { adapter?: string; entry?: string; goal?: string[]; unsafe?: string[] } = {},
): AdapterResult & { adapter: string } {
  const adapter = options.adapter ? getAdapter(options.adapter) : detect(input);
  if (!adapter) {
    throw new Error(
      `could not detect the graph format — pass one of: ${adapterNames.join(', ')}`,
    );
  }

  const result = adapter.parse(input);
  const missing = [...result.missing];

  if (options.entry) {
    result.graph.entry = options.entry;
    for (let i = missing.length - 1; i >= 0; i--) {
      if (missing[i]?.startsWith('entry')) missing.splice(i, 1);
    }
  }
  if (options.goal?.length) {
    result.graph.goal = options.goal;
    for (let i = missing.length - 1; i >= 0; i--) {
      if (missing[i]?.startsWith('goal')) missing.splice(i, 1);
    }
  }
  if (options.unsafe?.length) result.graph.unsafe = options.unsafe;

  return { ...result, missing, adapter: adapter.name };
}
