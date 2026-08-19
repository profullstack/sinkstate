/**
 * The normalised graph IR. Every adapter produces this; the engine consumes
 * only this. It is the documented contract and the escape hatch — when a
 * framework adapter rots, hand-written IR still works.
 */
export interface Graph {
  /** The state the agent starts in. */
  entry: string;
  /** States that count as "done". At least one is required. */
  goal: string[];
  /** States a safe path may not cross. Optional; the safe properties are skipped without it. */
  unsafe?: string[];
  /** Every state. Edge endpoints must appear here — an undeclared endpoint is usually a typo. */
  nodes: string[];
  /** Directed transitions, `[from, to]`. */
  edges: Array<[string, string]>;
}

export type Verdict = 'pass' | 'fail' | 'not-applicable';

/** Why a state can never reach a goal. */
export type DeathCause =
  /** No outgoing edges at all — a sink that is not a goal. */
  | 'no-outgoing-edges'
  /** Every state it can reach is also dead: a closed component containing no goal. */
  | 'closed-component';

export interface DeadState {
  state: string;
  cause: DeathCause;
  /**
   * For `closed-component`, the states trapped along with it (including itself),
   * sorted. For `no-outgoing-edges`, just itself.
   */
  component: string[];
  /** A concrete path from the entry into this state, when one exists. */
  witness?: string[];
}

export interface PropertyResult {
  /** Modal form from the paper, e.g. `◇*G`. */
  modal: string;
  /** The plain-language question this answers. */
  question: string;
  verdict: Verdict;
  /** Present when the verdict is `not-applicable` — says what was missing. */
  reason?: string;
  /** A path proving a `pass`, or a path into the failure proving a `fail`. */
  witness?: string[];
}

export interface UnsafeCutEntry {
  state: string;
  /**
   * True when removing this single state alone disconnects entry from every
   * goal — i.e. every path to done crosses it. The strongest form of the
   * Scenario D result, and the one worth acting on.
   */
  unavoidable: boolean;
}

export interface Analysis {
  /** `◇*G` — can this graph finish at all? */
  reachable: PropertyResult;
  /** `□*◇*G` — can every state it can enter still finish? */
  branchStable: PropertyResult;
  /** `◇*_safe G` — is there a path to done that never crosses an unsafe state? */
  safeReachable: PropertyResult;
  /** `□*_safe ◇*_safe G` — both at once. */
  safeStable: PropertyResult;

  /** `S \ Pre*(G)` — the headline output. Sorted. */
  dead: DeadState[];
  /** Dead states the entry can actually reach. The subset that can bite at runtime. */
  reachableDead: DeadState[];
  /** `V(Safe) \ SafePre*(G)` — dead within the safe subgraph. Sorted. */
  safeDead: string[];
  /**
   * Unsafe states lying on some entry→goal path, with those whose removal alone
   * severs entry from goal marked `unavoidable`. Empty unless `unsafe` was given.
   */
  unsafeCut: UnsafeCutEntry[];

  /** States the entry can reach, `Post*(s₀)`. Sorted. */
  reachableStates: string[];
  /** States that can reach a goal, `Pre*(G)`. Sorted. */
  liveStates: string[];

  stats: {
    nodes: number;
    edges: number;
    dead: number;
    reachableDead: number;
  };
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}
