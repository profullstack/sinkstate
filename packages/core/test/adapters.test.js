import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, detect, parseGraph, toMermaid } from '../dist/index.js';

test('the JSON IR round-trips and accepts object-shaped edges', () => {
  const pairs = parseGraph(
    JSON.stringify({
      entry: 'a',
      goal: ['b'],
      nodes: ['a', 'b'],
      edges: [['a', 'b']],
    }),
  );
  assert.equal(pairs.adapter, 'json');
  assert.deepEqual(pairs.graph.edges, [['a', 'b']]);

  const objects = parseGraph(
    JSON.stringify({
      entry: 'a',
      goal: ['b'],
      nodes: ['a', 'b'],
      edges: [{ source: 'a', target: 'b' }],
    }),
  );
  assert.deepEqual(objects.graph.edges, [['a', 'b']]);
});

test('a LangGraph export infers entry and goal from its pseudo-nodes', () => {
  const input = JSON.stringify({
    nodes: [{ id: '__start__' }, { id: 'plan' }, { id: 'act' }, { id: '__end__' }],
    edges: [
      { source: '__start__', target: 'plan' },
      { source: 'plan', target: 'act', conditional: true },
      { source: 'act', target: '__end__' },
    ],
  });
  assert.equal(detect(input).name, 'langgraph');

  const { graph, inferred } = parseGraph(input);
  assert.equal(graph.entry, '__start__');
  assert.deepEqual(graph.goal, ['__end__']);
  assert.equal(analyze(graph).branchStable.verdict, 'pass');
  assert.match(inferred.join('\n'), /__start__/);
  assert.match(inferred.join('\n'), /conditional edge/);
});

test('a LangGraph graph with an unwired node reports it as dead', () => {
  const input = JSON.stringify({
    nodes: [{ id: '__start__' }, { id: 'tool_error' }, { id: '__end__' }],
    edges: [
      { source: '__start__', target: 'tool_error' },
      { source: '__start__', target: '__end__' },
    ],
  });
  const { graph } = parseGraph(input);
  const a = analyze(graph);
  assert.equal(a.branchStable.verdict, 'fail');
  assert.deepEqual(
    a.dead.map((d) => d.state),
    ['tool_error'],
  );
});

test('mermaid stateDiagram infers entry and goal from [*]', () => {
  const input = `stateDiagram-v2
    [*] --> start
    start --> work: begin
    work --> done
    work --> retry
    retry --> retry
    done --> [*]`;
  assert.equal(detect(input).name, 'mermaid');

  const { graph, missing } = parseGraph(input);
  assert.equal(graph.entry, 'start');
  assert.deepEqual(graph.goal, ['done']);
  assert.deepEqual(missing, []);

  const a = analyze(graph);
  assert.deepEqual(
    a.dead.map((d) => d.state),
    ['retry'],
  );
});

test('a mermaid flowchart refuses to invent a goal', () => {
  const input = `flowchart TD
    a[Start] --> b{Check}
    b -->|yes| c[Finish]
    b -->|no| a`;
  const { graph, missing } = parseGraph(input);
  assert.deepEqual(graph.goal, []);
  assert.match(missing.join('\n'), /goal — a flowchart has no terminal concept/);

  // `a` has an incoming edge from `b`, so no node has zero in-degree and the
  // entry cannot be inferred either. Guessing here would be guessing.
  assert.equal(graph.entry, '');
  assert.match(missing.join('\n'), /entry — could not be inferred/);

  // Supplying both makes the analysis meaningful.
  const supplied = parseGraph(input, { entry: 'a', goal: ['c'] });
  assert.deepEqual(supplied.missing, []);
  assert.equal(analyze(supplied.graph).reachable.verdict, 'pass');
});

test('an n8n export infers the trigger as entry but never the goal', () => {
  const input = JSON.stringify({
    nodes: [
      { name: 'Webhook', type: 'n8n-nodes-base.webhook' },
      { name: 'Set', type: 'n8n-nodes-base.set' },
      { name: 'Slack', type: 'n8n-nodes-base.slack' },
    ],
    connections: {
      Webhook: { main: [[{ node: 'Set', index: 0 }]] },
      Set: { main: [[{ node: 'Slack', index: 0 }]] },
    },
  });
  assert.equal(detect(input).name, 'n8n');

  const { graph, inferred, missing } = parseGraph(input);
  assert.equal(graph.entry, 'Webhook');
  assert.deepEqual(graph.edges, [
    ['Webhook', 'Set'],
    ['Set', 'Slack'],
  ]);
  assert.match(inferred.join('\n'), /trigger node "Webhook"/);
  assert.match(missing.join('\n'), /goal — n8n workflows have no terminal node/);
});

test('overrides clear the matching missing entries', () => {
  const input = JSON.stringify({
    nodes: [{ name: 'A', type: 'x' }, { name: 'B', type: 'y' }],
    connections: { A: { main: [[{ node: 'B' }]] } },
  });
  const { missing } = parseGraph(input, { entry: 'A', goal: ['B'] });
  assert.deepEqual(missing, []);
});

test('an undetectable format is an error naming the alternatives', () => {
  assert.throws(() => parseGraph('this is not a graph'), /could not detect the graph format/);
});

test('mermaid rendering marks dead states and keeps ids safe', () => {
  const graph = {
    entry: 'start',
    goal: ['done'],
    nodes: ['start', 'done', 'retry-node'],
    edges: [
      ['start', 'done'],
      ['start', 'retry-node'],
      ['retry-node', 'retry-node'],
    ],
  };
  const out = toMermaid(graph, analyze(graph));
  assert.match(out, /^flowchart TD/);
  assert.match(out, /classDef dead/);
  assert.doesNotMatch(out, /class .*retry-node.* dead/, 'raw ids with dashes must not reach mermaid');
  assert.match(out, /class n[0-9a-f]+ dead/);
});
