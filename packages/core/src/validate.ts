import type { Graph, ValidationIssue } from './types.js';

/**
 * Structural validation, run before analysis.
 *
 * An edge pointing at an undeclared node is an error rather than an implicit
 * node: a mistyped edge target is one of the most common ways to create a dead
 * state, and silently inventing the node would hide exactly the bug this tool
 * exists to find.
 */
export function validate(graph: Graph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (message: string) => issues.push({ level: 'error', message });
  const warn = (message: string) => issues.push({ level: 'warning', message });

  if (!graph || typeof graph !== 'object') {
    return [{ level: 'error', message: 'graph must be an object' }];
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    err('nodes must be a non-empty array');
  }
  if (!Array.isArray(graph.edges)) err('edges must be an array');
  if (typeof graph.entry !== 'string' || graph.entry === '') err('entry must be a state name');
  if (!Array.isArray(graph.goal) || graph.goal.length === 0) {
    err('goal must be a non-empty array of state names');
  }
  if (issues.some((i) => i.level === 'error')) return issues;

  const nodes = new Set(graph.nodes);
  if (nodes.size !== graph.nodes.length) {
    const seen = new Set<string>();
    const dupes = graph.nodes.filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
    warn(`duplicate node names ignored: ${[...new Set(dupes)].sort().join(', ')}`);
  }

  if (!nodes.has(graph.entry)) err(`entry "${graph.entry}" is not in nodes`);
  for (const g of graph.goal) {
    if (!nodes.has(g)) err(`goal "${g}" is not in nodes`);
  }
  for (const u of graph.unsafe ?? []) {
    if (!nodes.has(u)) err(`unsafe "${u}" is not in nodes`);
  }

  graph.edges.forEach((edge, i) => {
    if (!Array.isArray(edge) || edge.length !== 2) {
      err(`edges[${i}] must be a [from, to] pair`);
      return;
    }
    const [from, to] = edge;
    if (!nodes.has(from)) err(`edges[${i}] leaves undeclared state "${from}"`);
    if (!nodes.has(to)) err(`edges[${i}] points at undeclared state "${to}"`);
  });

  for (const g of graph.goal) {
    if ((graph.unsafe ?? []).includes(g)) {
      warn(`"${g}" is both a goal and unsafe — no safe path can ever end there`);
    }
  }

  return issues;
}

export function assertValid(graph: Graph): void {
  const errors = validate(graph).filter((i) => i.level === 'error');
  if (errors.length) {
    throw new Error(`invalid graph:\n  ${errors.map((e) => e.message).join('\n  ')}`);
  }
}
