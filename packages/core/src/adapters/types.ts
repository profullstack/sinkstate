import type { Graph } from '../types.js';

export interface AdapterResult {
  graph: Graph;
  /**
   * Anything the adapter worked out rather than read. Surfaced to the user
   * every time: an inferred goal that is wrong makes every verdict wrong, so it
   * is never applied silently.
   */
  inferred: string[];
  /**
   * What the caller still has to supply for the analysis to mean anything.
   * Non-empty means "these results are provisional".
   */
  missing: string[];
}

export interface Adapter {
  name: string;
  /** Cheap sniff used by `detect()`. Must not throw on unrelated input. */
  matches(input: string): boolean;
  parse(input: string): AdapterResult;
}

export type { Graph };
