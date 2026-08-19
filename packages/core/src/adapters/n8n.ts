import type { Adapter, AdapterResult } from './types.js';
import type { Graph } from '../types.js';

/**
 * An n8n workflow export:
 *
 *   {"nodes": [{"name": "Webhook", "type": "n8n-nodes-base.webhook"}, ...],
 *    "connections": {"Webhook": {"main": [[{"node": "Set", "index": 0}]]}}}
 *
 * Connections are keyed by node *name*, and every output branch (`main`,
 * `error`, …) is a list of lists, so the flattening below is the whole format.
 *
 * The entry is inferred from the trigger node. The goal is not inferred: n8n
 * workflows have no terminal node, and treating every dangling node as "done"
 * would define away the dead states we exist to report.
 */
export const n8nAdapter: Adapter = {
  name: 'n8n',

  matches(input: string): boolean {
    const text = input.trim();
    if (!text.startsWith('{')) return false;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const nodes = parsed['nodes'];
      if (!Array.isArray(nodes)) return false;
      const conns = parsed['connections'];
      const looksN8n = nodes.some(
        (n) => n && typeof n === 'object' && 'name' in (n as object) && 'type' in (n as object),
      );
      return looksN8n && !!conns && typeof conns === 'object';
    } catch {
      return false;
    }
  },

  parse(input: string): AdapterResult {
    const raw = JSON.parse(input) as Record<string, unknown>;
    const inferred: string[] = [];
    const missing: string[] = [];

    const rawNodes = ((raw['nodes'] as unknown[]) ?? []) as Array<Record<string, unknown>>;
    const nodes = rawNodes.map((n) => String(n['name']));

    const edges: Array<[string, string]> = [];
    const connections = (raw['connections'] as Record<string, unknown>) ?? {};
    for (const [from, outputs] of Object.entries(connections)) {
      if (!outputs || typeof outputs !== 'object') continue;
      for (const branch of Object.values(outputs as Record<string, unknown>)) {
        if (!Array.isArray(branch)) continue;
        for (const group of branch) {
          if (!Array.isArray(group)) continue;
          for (const target of group) {
            if (target && typeof target === 'object') {
              edges.push([from, String((target as Record<string, unknown>)['node'])]);
            }
          }
        }
      }
    }

    const graph: Graph = { entry: '', goal: [], nodes, edges };

    const triggers = rawNodes.filter((n) => /trigger|webhook|start|cron|schedule/i.test(String(n['type'])));
    if (triggers.length === 1) {
      graph.entry = String(triggers[0]?.['name']);
      inferred.push(`entry inferred from the trigger node "${graph.entry}" (${String(triggers[0]?.['type'])})`);
    } else if (triggers.length > 1) {
      missing.push(
        `entry — the workflow has ${triggers.length} trigger nodes (${triggers.map((t) => String(t['name'])).join(', ')}), pass one explicitly`,
      );
    } else {
      missing.push('entry — no trigger node found, pass one explicitly');
    }

    missing.push(
      'goal — n8n workflows have no terminal node, so "done" must be declared; inferring it from dangling nodes would hide the dead states this tool reports',
    );

    return { graph, inferred, missing };
  },
};
