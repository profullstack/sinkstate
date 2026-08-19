import type { Analysis, DeadState, Graph, PropertyResult, UnsafeCutEntry } from './types.js';
import { assertValid } from './validate.js';

type Adjacency = Map<string, string[]>;

function adjacency(nodes: string[], edges: Array<[string, string]>): { fwd: Adjacency; rev: Adjacency } {
  const fwd: Adjacency = new Map();
  const rev: Adjacency = new Map();
  for (const n of nodes) {
    fwd.set(n, []);
    rev.set(n, []);
  }
  for (const [from, to] of edges) {
    fwd.get(from)?.push(to);
    rev.get(to)?.push(from);
  }
  return { fwd, rev };
}

/** Breadth-first closure over `adj` from every state in `sources`. */
function closure(sources: Iterable<string>, adj: Adjacency): Set<string> {
  const seen = new Set<string>(sources);
  const queue = [...seen];
  for (let i = 0; i < queue.length; i++) {
    for (const next of adj.get(queue[i] as string) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * Shortest path from `from` to any state in `targets`, following `adj`.
 * Returns undefined when no path exists. BFS, so the path is minimal — a short
 * witness is a readable witness.
 */
function pathTo(from: string, targets: Set<string>, adj: Adjacency): string[] | undefined {
  if (targets.has(from)) return [from];
  const parent = new Map<string, string>([[from, from]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i] as string;
    for (const next of adj.get(current) ?? []) {
      if (parent.has(next)) continue;
      parent.set(next, current);
      if (targets.has(next)) {
        const path = [next];
        let step = next;
        while (step !== from) {
          step = parent.get(step) as string;
          path.push(step);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return undefined;
}

const sorted = (set: Iterable<string>): string[] => [...set].sort();

/**
 * The whole engine. Two reverse breadth-first passes and two forward ones,
 * `O(N+E)` throughout, per Proposition 11.1 of *The Logic of AGI*.
 *
 * Every property carries a witness, because a boolean nobody can act on is
 * worthless: a pass returns the path that proves it, a failure returns the path
 * into the state that breaks it.
 */
export function analyze(graph: Graph): Analysis {
  assertValid(graph);

  const nodes = [...new Set(graph.nodes)];
  const { fwd, rev } = adjacency(nodes, graph.edges);
  const goals = new Set(graph.goal);
  const unsafe = new Set(graph.unsafe ?? []);
  const hasUnsafe = unsafe.size > 0;

  // 1. Pre*(G) — everything that can still reach done. Dead is the complement.
  const live = closure(goals, rev);
  const deadSet = new Set(nodes.filter((n) => !live.has(n)));

  // 2. Post*(s₀) — everything the entry can actually get to.
  const reachableStates = closure([graph.entry], fwd);

  const describeDead = (state: string): DeadState => {
    const outgoing = fwd.get(state) ?? [];
    // Post*(state) ⊆ dead: if anything it reached could reach a goal, so could it.
    const component = outgoing.length === 0 ? [state] : sorted(closure([state], fwd));
    const witness = pathTo(graph.entry, new Set([state]), fwd);
    const entry: DeadState = {
      state,
      cause: outgoing.length === 0 ? 'no-outgoing-edges' : 'closed-component',
      component,
    };
    if (witness) entry.witness = witness;
    return entry;
  };

  const dead = sorted(deadSet).map(describeDead);
  const reachableDead = dead.filter((d) => reachableStates.has(d.state));

  // ── ◇*G ────────────────────────────────────────────────────────────────────
  const reachablePath = pathTo(graph.entry, goals, fwd);
  const reachable: PropertyResult = {
    modal: '◇*G',
    question: 'Can this graph finish at all?',
    verdict: live.has(graph.entry) ? 'pass' : 'fail',
  };
  if (reachablePath) reachable.witness = reachablePath;

  // ── □*◇*G ──────────────────────────────────────────────────────────────────
  const branchStable: PropertyResult = {
    modal: '□*◇*G',
    question: 'Can every state it can enter still finish?',
    verdict: reachableDead.length === 0 ? 'pass' : 'fail',
  };
  const firstTrap = reachableDead[0];
  if (firstTrap?.witness) branchStable.witness = firstTrap.witness;

  // ── the safe subgraph ──────────────────────────────────────────────────────
  const safeNodes = nodes.filter((n) => !unsafe.has(n));
  const safeEdges = graph.edges.filter(([f, t]) => !unsafe.has(f) && !unsafe.has(t));
  const { fwd: safeFwd, rev: safeRev } = adjacency(safeNodes, safeEdges);
  const safeGoals = new Set(graph.goal.filter((g) => !unsafe.has(g)));
  const safePre = closure(safeGoals, safeRev);
  const entryIsSafe = !unsafe.has(graph.entry);
  const safeDeadSet = new Set(safeNodes.filter((n) => !safePre.has(n)));

  const notApplicable = (modal: string, question: string): PropertyResult => ({
    modal,
    question,
    verdict: 'not-applicable',
    reason: 'no unsafe states were declared',
  });

  let safeReachable: PropertyResult;
  let safeStable: PropertyResult;

  if (!hasUnsafe) {
    safeReachable = notApplicable('◇*_safe G', 'Is there a path to done that never crosses an unsafe state?');
    safeStable = notApplicable('□*_safe ◇*_safe G', 'Both at once — the only real guarantee.');
  } else {
    const safePath = entryIsSafe ? pathTo(graph.entry, safeGoals, safeFwd) : undefined;
    safeReachable = {
      modal: '◇*_safe G',
      question: 'Is there a path to done that never crosses an unsafe state?',
      verdict: entryIsSafe && safePre.has(graph.entry) ? 'pass' : 'fail',
    };
    if (!entryIsSafe) safeReachable.reason = `the entry state "${graph.entry}" is itself unsafe`;
    else if (safeGoals.size === 0) safeReachable.reason = 'every goal state is marked unsafe';
    if (safePath) safeReachable.witness = safePath;

    const safeReachableStates = entryIsSafe ? closure([graph.entry], safeFwd) : new Set<string>();
    const safeTraps = sorted(safeReachableStates).filter((s) => safeDeadSet.has(s));
    safeStable = {
      modal: '□*_safe ◇*_safe G',
      question: 'Both at once — the only real guarantee.',
      verdict: entryIsSafe && safeTraps.length === 0 && safePre.has(graph.entry) ? 'pass' : 'fail',
    };
    if (!entryIsSafe) safeStable.reason = `the entry state "${graph.entry}" is itself unsafe`;
    const safeTrapWitness = safeTraps[0] ? pathTo(graph.entry, new Set([safeTraps[0]]), safeFwd) : undefined;
    if (safeTrapWitness) safeStable.witness = safeTrapWitness;
  }

  // ── the unsafe cut (Scenario D) ────────────────────────────────────────────
  // Unsafe states lying on some entry→goal path. If removing one alone severs
  // entry from every goal, every path to done crosses it — that is the finding
  // worth acting on, so it is computed rather than left to the reader.
  const unsafeCut: UnsafeCutEntry[] = [];
  if (hasUnsafe) {
    const onSomePath = sorted(unsafe).filter((u) => reachableStates.has(u) && live.has(u));
    for (const state of onSomePath) {
      const keep = nodes.filter((n) => n !== state);
      const { fwd: cutFwd } = adjacency(
        keep,
        graph.edges.filter(([f, t]) => f !== state && t !== state),
      );
      const stillReaches =
        graph.entry !== state && pathTo(graph.entry, goals, cutFwd) !== undefined;
      unsafeCut.push({ state, unavoidable: !stillReaches });
    }
  }

  return {
    reachable,
    branchStable,
    safeReachable,
    safeStable,
    dead,
    reachableDead,
    safeDead: sorted(safeDeadSet),
    unsafeCut,
    reachableStates: sorted(reachableStates),
    liveStates: sorted(live),
    stats: {
      nodes: nodes.length,
      edges: graph.edges.length,
      dead: dead.length,
      reachableDead: reachableDead.length,
    },
  };
}
