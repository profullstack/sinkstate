import type { Adapter, AdapterResult } from './types.js';
import type { Graph } from '../types.js';

/**
 * The IR itself. Always works, and is the contract every other adapter targets.
 *
 * Edges are accepted as `[from, to]` pairs or as `{from, to}` / `{source,
 * target}` objects, because hand-written graphs arrive in all three shapes and
 * rejecting two of them buys nothing.
 */
export const jsonAdapter: Adapter = {
  name: 'json',

  matches(input: string): boolean {
    const text = input.trim();
    if (!text.startsWith('{')) return false;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return Array.isArray(parsed['nodes']) && Array.isArray(parsed['edges']) && 'entry' in parsed;
    } catch {
      return false;
    }
  },

  parse(input: string): AdapterResult {
    const raw = JSON.parse(input) as Record<string, unknown>;
    const edges: Array<[string, string]> = [];

    for (const edge of (raw['edges'] as unknown[]) ?? []) {
      if (Array.isArray(edge)) {
        edges.push([String(edge[0]), String(edge[1])]);
        continue;
      }
      if (edge && typeof edge === 'object') {
        const o = edge as Record<string, unknown>;
        const from = o['from'] ?? o['source'];
        const to = o['to'] ?? o['target'];
        if (from !== undefined && to !== undefined) {
          edges.push([String(from), String(to)]);
          continue;
        }
      }
      throw new Error(`edge is neither a [from, to] pair nor a {from, to} object: ${JSON.stringify(edge)}`);
    }

    const graph: Graph = {
      entry: String(raw['entry'] ?? ''),
      goal: ((raw['goal'] as unknown[]) ?? []).map(String),
      nodes: ((raw['nodes'] as unknown[]) ?? []).map(String),
      edges,
    };
    const unsafe = raw['unsafe'] as unknown[] | undefined;
    if (unsafe) graph.unsafe = unsafe.map(String);

    return { graph, inferred: [], missing: [] };
  },
};
