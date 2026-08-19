import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../dist/index.js';

/**
 * Deterministic PRNG so a failure is reproducible from the seed printed in the
 * assertion message. Math.random() would make a red run unreproducible.
 */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randomGraph(seed) {
  const rand = rng(seed);
  const n = 2 + Math.floor(rand() * 9);
  const nodes = Array.from({ length: n }, (_, i) => `s${i}`);
  const edges = [];
  for (const from of nodes) {
    for (const to of nodes) {
      if (rand() < 0.18) edges.push([from, to]);
    }
  }
  const goal = [nodes[n - 1]];
  const unsafe = nodes.filter(() => rand() < 0.2).filter((x) => x !== nodes[0]);
  const graph = { entry: nodes[0], goal, nodes, edges };
  if (unsafe.length) graph.unsafe = unsafe;
  return graph;
}

/** Independent, deliberately naive: repeated relaxation instead of one BFS. */
function bruteCanReach(graph, from, targets) {
  const goal = new Set(targets);
  let frontier = new Set([from]);
  const seen = new Set([from]);
  while (frontier.size) {
    const next = new Set();
    for (const s of frontier) {
      if (goal.has(s)) return true;
      for (const [f, t] of graph.edges) {
        if (f === s && !seen.has(t)) {
          seen.add(t);
          next.add(t);
        }
      }
    }
    frontier = next;
  }
  return [...seen].some((s) => goal.has(s));
}

function isPath(graph, path) {
  if (!path || path.length === 0) return false;
  for (let i = 0; i + 1 < path.length; i++) {
    if (!graph.edges.some(([f, t]) => f === path[i] && t === path[i + 1])) return false;
  }
  return true;
}

test('dead and live partition the state set, on 400 random graphs', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const graph = randomGraph(seed);
    const a = analyze(graph);
    const dead = new Set(a.dead.map((d) => d.state));
    const live = new Set(a.liveStates);

    for (const node of graph.nodes) {
      assert.equal(
        dead.has(node) !== live.has(node),
        true,
        `seed ${seed}: ${node} must be in exactly one of dead/live`,
      );
    }
    assert.equal(dead.size + live.size, new Set(graph.nodes).size, `seed ${seed}`);
  }
});

test('every dead state genuinely cannot reach a goal, checked independently', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const graph = randomGraph(seed);
    const a = analyze(graph);
    for (const d of a.dead) {
      assert.equal(
        bruteCanReach(graph, d.state, graph.goal),
        false,
        `seed ${seed}: ${d.state} was called dead but can reach a goal`,
      );
    }
    for (const l of a.liveStates) {
      assert.equal(
        bruteCanReach(graph, l, graph.goal),
        true,
        `seed ${seed}: ${l} was called live but cannot reach a goal`,
      );
    }
  }
});

test('verdicts agree with their definitions, on 400 random graphs', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const graph = randomGraph(seed);
    const a = analyze(graph);

    assert.equal(
      a.reachable.verdict === 'pass',
      bruteCanReach(graph, graph.entry, graph.goal),
      `seed ${seed}: reachable disagrees with brute force`,
    );

    const reachableSet = new Set(a.reachableStates);
    const anyTrap = a.dead.some((d) => reachableSet.has(d.state));
    assert.equal(
      a.branchStable.verdict === 'pass',
      !anyTrap,
      `seed ${seed}: branch-stable disagrees with the dead set`,
    );
  }
});

test('every witness is a real path, and a passing reachable witness ends at a goal', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const graph = randomGraph(seed);
    const a = analyze(graph);

    if (a.reachable.verdict === 'pass') {
      assert.ok(isPath(graph, a.reachable.witness), `seed ${seed}: reachable witness is not a path`);
      assert.ok(
        graph.goal.includes(a.reachable.witness.at(-1)),
        `seed ${seed}: reachable witness does not end at a goal`,
      );
      assert.equal(a.reachable.witness[0], graph.entry, `seed ${seed}`);
    }

    for (const d of a.dead) {
      if (!d.witness) continue;
      assert.ok(isPath(graph, d.witness), `seed ${seed}: dead witness for ${d.state} is not a path`);
      assert.equal(d.witness.at(-1), d.state, `seed ${seed}`);
      assert.equal(d.witness[0], graph.entry, `seed ${seed}`);
    }
  }
});

test('a state marked unavoidable really does sever entry from goal when removed', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const graph = randomGraph(seed);
    const a = analyze(graph);
    for (const cut of a.unsafeCut) {
      const without = {
        ...graph,
        nodes: graph.nodes.filter((n) => n !== cut.state),
        edges: graph.edges.filter(([f, t]) => f !== cut.state && t !== cut.state),
      };
      const stillReaches = bruteCanReach(without, graph.entry, graph.goal);
      assert.equal(
        cut.unavoidable,
        !stillReaches,
        `seed ${seed}: ${cut.state} unavoidable=${cut.unavoidable} but removing it left reachable=${stillReaches}`,
      );
    }
  }
});

test('analysis is deterministic — same graph, identical result', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const graph = randomGraph(seed);
    assert.deepEqual(analyze(graph), analyze(graph), `seed ${seed}`);
  }
});
