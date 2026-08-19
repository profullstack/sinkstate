import type { Adapter, AdapterResult } from './types.js';
import type { Graph } from '../types.js';

const ARROW = /^(.+?)\s*-{2,3}>|^(.+?)\s*-{1,2}\.-*>/;

/** Strip a mermaid node's shape and label: `plan[Make a plan]` → `plan`. */
function nodeId(raw: string): string {
  const text = raw.trim().replace(/^\|[^|]*\|\s*/, '');
  const match = text.match(/^([A-Za-z0-9_.-]+)\s*(?:[[({<]|$)/);
  return match?.[1] ?? text;
}

/** Split `a --> b` / `a -->|label| b` / `a -.-> b` into its two endpoints. */
function splitEdge(line: string): [string, string] | undefined {
  const arrow = line.match(/-{2,3}>|-{1,2}\.-*>|={2,3}>/);
  if (!arrow || arrow.index === undefined) return undefined;
  const left = line.slice(0, arrow.index);
  let right = line.slice(arrow.index + arrow[0].length);
  right = right.replace(/^\|[^|]*\|/, '');
  const from = left.split(/\s+/).filter(Boolean).pop();
  if (!from) return undefined;
  const to = right.replace(/:.*$/, '');
  return [nodeId(from), nodeId(to)];
}

/**
 * Mermaid `stateDiagram-v2` and `flowchart` / `graph`.
 *
 * Goal inference differs between the two on purpose. `stateDiagram` has an
 * explicit terminal (`--> [*]`), so the goal is read from the source. A
 * flowchart has no terminal concept — inferring "every node with no outgoing
 * edge is a goal" would define away exactly the bug this tool looks for (the
 * node someone forgot to wire onward), so it is left to the caller instead.
 */
export const mermaidAdapter: Adapter = {
  name: 'mermaid',

  matches(input: string): boolean {
    return /^\s*(stateDiagram(-v2)?|flowchart\s+\w+|graph\s+\w+)/m.test(input);
  },

  parse(input: string): AdapterResult {
    const inferred: string[] = [];
    const missing: string[] = [];
    const isState = /^\s*stateDiagram/m.test(input);

    const order: string[] = [];
    const seen = new Set<string>();
    const add = (n: string) => {
      if (n && !seen.has(n)) {
        seen.add(n);
        order.push(n);
      }
    };

    const edges: Array<[string, string]> = [];
    const starts = new Set<string>();
    const terminals = new Set<string>();

    for (const rawLine of input.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('%%')) continue;
      if (/^(stateDiagram|flowchart|graph|classDef|class |click |style |subgraph|end$|direction )/.test(line)) {
        continue;
      }
      if (!ARROW.test(line) && !/-{2,3}>|={2,3}>/.test(line)) continue;

      const pair = splitEdge(line);
      if (!pair) continue;
      const [from, to] = pair;

      if (from === '[*]') {
        if (to !== '[*]') {
          starts.add(to);
          add(to);
        }
        continue;
      }
      if (to === '[*]') {
        terminals.add(from);
        add(from);
        continue;
      }
      add(from);
      add(to);
      edges.push([from, to]);
    }

    const graph: Graph = { entry: '', goal: [], nodes: order, edges };

    if (starts.size === 1) {
      graph.entry = [...starts][0] as string;
      inferred.push(`entry inferred from the [*] --> ${graph.entry} transition`);
    } else if (starts.size > 1) {
      missing.push(`entry — the diagram declares ${starts.size} start transitions, pass one explicitly`);
    } else {
      const targets = new Set(edges.map(([, t]) => t));
      const roots = order.filter((n) => !targets.has(n));
      if (roots.length === 1) {
        graph.entry = roots[0] as string;
        inferred.push(`entry inferred as "${graph.entry}", the only node with no incoming edge`);
      } else {
        missing.push('entry — could not be inferred, pass one explicitly');
      }
    }

    if (terminals.size > 0) {
      graph.goal = [...terminals];
      inferred.push(`goal inferred from ${terminals.size} "--> [*]" terminal transition(s)`);
    } else if (isState) {
      missing.push('goal — no "--> [*]" terminal found, pass one explicitly');
    } else {
      missing.push(
        'goal — a flowchart has no terminal concept, so it must be declared; inferring "any node with no outgoing edge" would hide the exact bug this tool looks for',
      );
    }

    return { graph, inferred, missing };
  },
};
