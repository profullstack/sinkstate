import type { Analysis, Graph, PropertyResult } from './types.js';

export type PropertyKey = 'reachable' | 'branchStable' | 'safeReachable' | 'safeStable';

export const PROPERTY_KEYS: PropertyKey[] = ['reachable', 'branchStable', 'safeReachable', 'safeStable'];

export const PROPERTY_LABELS: Record<PropertyKey, string> = {
  reachable: 'reachable',
  branchStable: 'branch-stable',
  safeReachable: 'safe-reachable',
  safeStable: 'safe-stable',
};

const MARK: Record<string, string> = { pass: 'PASS', fail: 'FAIL', 'not-applicable': ' n/a' };

/**
 * The limitation, stated wherever results are. It belongs in the output rather
 * than in the docs: we analyse the declared graph, and a conditional edge whose
 * predicate never fires in practice is still an edge to us.
 */
export const STATIC_ANALYSIS_NOTE =
  'sinkstate analyses the declared graph, not runtime behaviour. A conditional edge is treated as always traversable.';

export function property(analysis: Analysis, key: PropertyKey): PropertyResult {
  return analysis[key];
}

/**
 * Exit code for CI. 0 when every required property passes, 1 when any fails.
 * A `not-applicable` property never fails a build — the user did not ask for it.
 */
export function exitCode(analysis: Analysis, required: PropertyKey[]): number {
  return required.some((key) => analysis[key].verdict === 'fail') ? 1 : 0;
}

const arrow = (path: string[] | undefined): string => (path ?? []).join(' → ');

export interface TextOptions {
  color?: boolean;
  /** Cap on how many dead states to list in full. */
  limit?: number;
}

const paint = (on: boolean, code: string, text: string): string =>
  on ? `[${code}m${text}[0m` : text;

/** The CLI's human output. Deterministic and greppable; colour is additive only. */
export function formatText(analysis: Analysis, options: TextOptions = {}): string {
  const c = options.color ?? false;
  const limit = options.limit ?? 20;
  const lines: string[] = [];

  const { stats } = analysis;
  lines.push(`graph: ${stats.nodes} states, ${stats.edges} transitions`);
  lines.push('');

  for (const key of PROPERTY_KEYS) {
    const result = analysis[key];
    const colour = result.verdict === 'pass' ? '32' : result.verdict === 'fail' ? '31' : '90';
    const mark = paint(c, colour, MARK[result.verdict] ?? '????');
    lines.push(`  ${mark}  ${PROPERTY_LABELS[key].padEnd(15)} ${result.modal}`);
    if (result.reason) lines.push(`        ${result.reason}`);
    if (result.witness && result.verdict === 'pass') {
      lines.push(`        path: ${arrow(result.witness)}`);
    }
    if (result.witness && result.verdict === 'fail') {
      lines.push(`        reached via: ${arrow(result.witness)}`);
    }
  }

  if (analysis.dead.length > 0) {
    lines.push('');
    const reachable = analysis.reachableDead.length;
    lines.push(
      paint(c, '31', `${analysis.dead.length} dead state${analysis.dead.length === 1 ? '' : 's'}`) +
        ` (${reachable} reachable from the entry):`,
    );
    for (const dead of analysis.dead.slice(0, limit)) {
      const why =
        dead.cause === 'no-outgoing-edges'
          ? 'no outgoing transitions'
          : `trapped in a closed component of ${dead.component.length}: ${dead.component.join(', ')}`;
      const tag = analysis.reachableDead.some((d) => d.state === dead.state) ? '' : ' (unreachable from entry)';
      lines.push(`  ${dead.state}${tag} — ${why}`);
      if (dead.witness) lines.push(`      entered via: ${arrow(dead.witness)}`);
    }
    if (analysis.dead.length > limit) {
      lines.push(`  … and ${analysis.dead.length - limit} more`);
    }
  }

  if (analysis.unsafeCut.length > 0) {
    lines.push('');
    lines.push('unsafe states on a path to done:');
    for (const cut of analysis.unsafeCut) {
      lines.push(
        `  ${cut.state}${cut.unavoidable ? paint(c, '31', ' — unavoidable: every path to done crosses it') : ''}`,
      );
    }
  }

  lines.push('');
  lines.push(paint(c, '90', STATIC_ANALYSIS_NOTE));
  return lines.join('\n');
}

/**
 * Mermaid node ids may not contain spaces, dashes or quotes, so state names are
 * hex-encoded. Written by hand rather than with `Buffer` so the package stays
 * isomorphic — it is imported by the browser bundle for the paste UI, where a
 * node builtin would break the build.
 */
const safeId = (name: string): string => {
  let out = 'n';
  for (const unit of new TextEncoder().encode(name)) {
    out += unit.toString(16).padStart(2, '0');
  }
  return out;
};

/**
 * Render the graph as mermaid with the dead set and the witness path marked.
 *
 * Above `maxNodes` only the dead set, the witness path and their immediate
 * neighbours are drawn — a 400-node diagram is not a diagram, and the dead
 * states are the part anyone is looking at.
 */
export function toMermaid(graph: Graph, analysis: Analysis, maxNodes = 60): string {
  const dead = new Set(analysis.dead.map((d) => d.state));
  const unsafe = new Set(graph.unsafe ?? []);
  const goals = new Set(graph.goal);
  const witness = new Set(
    [analysis.branchStable.witness, analysis.reachable.witness].flatMap((p) => p ?? []),
  );

  let nodes = graph.nodes;
  let truncated = false;
  if (nodes.length > maxNodes) {
    const keep = new Set<string>([graph.entry, ...goals, ...dead, ...witness]);
    for (const [from, to] of graph.edges) {
      if (keep.has(from)) keep.add(to);
      if (keep.has(to)) keep.add(from);
    }
    nodes = graph.nodes.filter((n) => keep.has(n));
    truncated = true;
  }
  const shown = new Set(nodes);

  const lines = ['flowchart TD'];
  for (const node of nodes) {
    const shape = goals.has(node) ? `([${node}])` : dead.has(node) ? `[["${node}"]]` : `["${node}"]`;
    lines.push(`  ${safeId(node)}${shape}`);
  }
  for (const [from, to] of graph.edges) {
    if (!shown.has(from) || !shown.has(to)) continue;
    lines.push(`  ${safeId(from)} --> ${safeId(to)}`);
  }

  lines.push('  classDef dead fill:#7f1d1d,stroke:#ef4444,color:#fff');
  lines.push('  classDef goal fill:#14532d,stroke:#22c55e,color:#fff');
  lines.push('  classDef unsafe fill:#78350f,stroke:#f59e0b,color:#fff');
  lines.push('  classDef entry fill:#1e3a8a,stroke:#3b82f6,color:#fff');

  const classed = (name: string, members: string[]) => {
    const present = members.filter((m) => shown.has(m));
    if (present.length) lines.push(`  class ${present.map(safeId).join(',')} ${name}`);
  };
  classed('dead', [...dead]);
  classed('goal', [...goals]);
  classed('unsafe', [...unsafe].filter((u) => !dead.has(u)));
  classed('entry', [graph.entry]);

  if (truncated) {
    lines.push(`  %% showing ${nodes.length} of ${graph.nodes.length} states: the dead set, the witness path and their neighbours`);
  }
  return lines.join('\n');
}
