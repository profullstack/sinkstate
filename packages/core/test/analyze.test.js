import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, exitCode, validate } from '../dist/index.js';

/** The PRD's worked example: `retry` loops onto itself with no exit edge. */
const retryTrap = {
  entry: 'start',
  goal: ['done'],
  unsafe: ['exec_shell'],
  nodes: ['start', 'plan', 'exec_shell', 'retry', 'done'],
  edges: [
    ['start', 'plan'],
    ['plan', 'exec_shell'],
    ['exec_shell', 'done'],
    ['exec_shell', 'retry'],
    ['retry', 'retry'],
  ],
};

const clean = {
  entry: 'start',
  goal: ['done'],
  nodes: ['start', 'work', 'done'],
  edges: [
    ['start', 'work'],
    ['work', 'done'],
  ],
};

test('a graph with no traps passes reachable and branch-stable', () => {
  const a = analyze(clean);
  assert.equal(a.reachable.verdict, 'pass');
  assert.equal(a.branchStable.verdict, 'pass');
  assert.deepEqual(a.dead, []);
  assert.deepEqual(a.reachable.witness, ['start', 'work', 'done']);
});

test('the self-looping retry node is dead and branch stability fails', () => {
  const a = analyze(retryTrap);
  assert.equal(a.reachable.verdict, 'pass', 'done is still reachable via exec_shell');
  assert.equal(a.branchStable.verdict, 'fail', 'but retry can be entered and never left');
  assert.deepEqual(
    a.dead.map((d) => d.state),
    ['retry'],
  );
  assert.equal(a.dead[0].cause, 'closed-component');
  assert.deepEqual(a.dead[0].component, ['retry']);
});

test('a dead state carries a concrete path from the entry', () => {
  const a = analyze(retryTrap);
  assert.deepEqual(a.dead[0].witness, ['start', 'plan', 'exec_shell', 'retry']);
  assert.deepEqual(a.branchStable.witness, ['start', 'plan', 'exec_shell', 'retry']);
});

test('a node with no outgoing edges is reported as a sink, not a component', () => {
  const a = analyze({
    entry: 'start',
    goal: ['done'],
    nodes: ['start', 'oops', 'done'],
    edges: [
      ['start', 'done'],
      ['start', 'oops'],
    ],
  });
  assert.deepEqual(
    a.dead.map((d) => d.state),
    ['oops'],
  );
  assert.equal(a.dead[0].cause, 'no-outgoing-edges');
  assert.deepEqual(a.dead[0].component, ['oops']);
});

test('a multi-state closed component names everyone trapped in it', () => {
  const a = analyze({
    entry: 'start',
    goal: ['done'],
    nodes: ['start', 'a', 'b', 'done'],
    edges: [
      ['start', 'done'],
      ['start', 'a'],
      ['a', 'b'],
      ['b', 'a'],
    ],
  });
  assert.deepEqual(
    a.dead.map((d) => d.state).sort(),
    ['a', 'b'],
  );
  for (const d of a.dead) {
    assert.equal(d.cause, 'closed-component');
    assert.deepEqual(d.component, ['a', 'b']);
  }
});

test('reachable fails when done cannot be reached at all', () => {
  const a = analyze({
    entry: 'start',
    goal: ['done'],
    nodes: ['start', 'stuck', 'done'],
    edges: [['start', 'stuck']],
  });
  assert.equal(a.reachable.verdict, 'fail');
  assert.equal(a.branchStable.verdict, 'fail');
  assert.equal(a.reachable.witness, undefined);
});

test('an unreachable dead state is reported but does not break branch stability', () => {
  const a = analyze({
    entry: 'start',
    goal: ['done'],
    nodes: ['start', 'done', 'orphan'],
    edges: [
      ['start', 'done'],
      ['orphan', 'orphan'],
    ],
  });
  assert.equal(a.branchStable.verdict, 'pass', 'orphan cannot be entered from the entry');
  assert.deepEqual(
    a.dead.map((d) => d.state),
    ['orphan'],
  );
  assert.deepEqual(a.reachableDead, []);
});

test('safe properties are not-applicable when no unsafe states are declared', () => {
  const a = analyze(clean);
  assert.equal(a.safeReachable.verdict, 'not-applicable');
  assert.equal(a.safeStable.verdict, 'not-applicable');
  assert.deepEqual(a.unsafeCut, []);
});

test('safe-reachable fails when every path to done crosses an unsafe state', () => {
  const a = analyze(retryTrap);
  assert.equal(a.safeReachable.verdict, 'fail');
  assert.deepEqual(a.unsafeCut, [{ state: 'exec_shell', unavoidable: true }]);
});

test('an avoidable unsafe state is reported but not marked unavoidable', () => {
  const a = analyze({
    entry: 'start',
    goal: ['done'],
    unsafe: ['risky'],
    nodes: ['start', 'risky', 'safe', 'done'],
    edges: [
      ['start', 'risky'],
      ['start', 'safe'],
      ['risky', 'done'],
      ['safe', 'done'],
    ],
  });
  assert.equal(a.safeReachable.verdict, 'pass');
  assert.deepEqual(a.safeReachable.witness, ['start', 'safe', 'done']);
  assert.deepEqual(a.unsafeCut, [{ state: 'risky', unavoidable: false }]);
});

test('an unsafe entry state fails the safe properties with a reason', () => {
  const a = analyze({
    entry: 'start',
    goal: ['done'],
    unsafe: ['start'],
    nodes: ['start', 'done'],
    edges: [['start', 'done']],
  });
  assert.equal(a.safeReachable.verdict, 'fail');
  assert.match(a.safeReachable.reason ?? '', /entry state "start" is itself unsafe/);
});

test('safe-stable fails when a safe path exists but a safe trap is reachable', () => {
  const a = analyze({
    entry: 'start',
    goal: ['done'],
    unsafe: ['risky'],
    nodes: ['start', 'risky', 'trap', 'done'],
    edges: [
      ['start', 'done'],
      ['start', 'trap'],
      ['trap', 'trap'],
      ['start', 'risky'],
    ],
  });
  assert.equal(a.safeReachable.verdict, 'pass');
  assert.equal(a.safeStable.verdict, 'fail');
  assert.deepEqual(a.safeDead, ['trap']);
});

test('exit code is 1 only when a required property fails', () => {
  const trap = analyze(retryTrap);
  assert.equal(exitCode(trap, ['reachable']), 0);
  assert.equal(exitCode(trap, ['branchStable']), 1);
  assert.equal(exitCode(analyze(clean), ['reachable', 'branchStable']), 0);
  assert.equal(
    exitCode(analyze(clean), ['safeReachable']),
    0,
    'not-applicable must never fail a build',
  );
});

test('validation rejects an edge pointing at an undeclared state', () => {
  const issues = validate({
    entry: 'start',
    goal: ['done'],
    nodes: ['start', 'done'],
    edges: [['start', 'typo']],
  });
  assert.equal(issues.filter((i) => i.level === 'error').length, 1);
  assert.match(issues[0].message, /undeclared state "typo"/);
  assert.throws(() =>
    analyze({ entry: 'start', goal: ['done'], nodes: ['start', 'done'], edges: [['start', 'typo']] }),
  );
});

test('validation rejects an entry or goal that is not a node', () => {
  const issues = validate({ entry: 'nope', goal: ['gone'], nodes: ['a'], edges: [] });
  const messages = issues.map((i) => i.message).join('\n');
  assert.match(messages, /entry "nope" is not in nodes/);
  assert.match(messages, /goal "gone" is not in nodes/);
});
