import type { Adapter, AdapterResult } from './types.js';
import type { Graph } from '../types.js';

/**
 * LangGraph's serialised drawable graph — what
 * `app.get_graph().to_json()` emits:
 *
 *   {"nodes": [{"id": "__start__"}, ...],
 *    "edges": [{"source": "a", "target": "b", "conditional": true}]}
 *
 * The serialised form is used deliberately rather than a compiled `StateGraph`
 * object: reading the compiled object would require a Python side-process and
 * would make the whole tool impure. This keeps it pure JS.
 *
 * A conditional edge is treated as an edge that can always be taken. That is
 * the honest static reading — we analyse the declared graph, not the runtime —
 * and it is stated wherever results are shown.
 */
export const langgraphAdapter: Adapter = {
  name: 'langgraph',

  matches(input: string): boolean {
    const text = input.trim();
    if (!text.startsWith('{')) return false;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const nodes = parsed['nodes'];
      if (!Array.isArray(nodes) || !Array.isArray(parsed['edges'])) return false;
      // The tell: LangGraph's pseudo-nodes, and node/edge objects rather than the IR.
      const ids = nodes.map((n) => (n && typeof n === 'object' ? (n as Record<string, unknown>)['id'] : n));
      return ids.includes('__start__') || ids.includes('__end__');
    } catch {
      return false;
    }
  },

  parse(input: string): AdapterResult {
    const raw = JSON.parse(input) as Record<string, unknown>;
    const inferred: string[] = [];
    const missing: string[] = [];

    const nodes = ((raw['nodes'] as unknown[]) ?? []).map((n) =>
      n && typeof n === 'object' ? String((n as Record<string, unknown>)['id']) : String(n),
    );

    const edges: Array<[string, string]> = [];
    let conditional = 0;
    for (const edge of (raw['edges'] as unknown[]) ?? []) {
      if (!edge || typeof edge !== 'object') continue;
      const o = edge as Record<string, unknown>;
      edges.push([String(o['source']), String(o['target'])]);
      if (o['conditional']) conditional++;
    }

    const graph: Graph = { entry: '', goal: [], nodes, edges };

    if (nodes.includes('__start__')) {
      graph.entry = '__start__';
      inferred.push('entry inferred as LangGraph\'s __start__ node');
    } else {
      missing.push('entry — no __start__ node found, pass one explicitly');
    }

    if (nodes.includes('__end__')) {
      graph.goal = ['__end__'];
      inferred.push('goal inferred as LangGraph\'s __end__ node (END)');
    } else {
      missing.push('goal — no __end__ node found, pass one explicitly');
    }

    if (conditional > 0) {
      inferred.push(
        `${conditional} conditional edge${conditional === 1 ? '' : 's'} treated as always traversable — this is a static reading of the declared graph, not of runtime behaviour`,
      );
    }

    return { graph, inferred, missing };
  },
};
