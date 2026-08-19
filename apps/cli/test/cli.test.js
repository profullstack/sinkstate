import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'dist', 'sinkstate.mjs');
const FIXTURE = join(here, 'fixtures', 'retry-trap.json');

/** Run the bundled single-file CLI — the artifact users actually install. */
function run(args, input) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [CLI, ...args], (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr });
    });
    if (input !== undefined) {
      child.stdin.end(input);
    }
  });
}

test('--help exits 0 and names the exit codes', async () => {
  const { code, stdout } = await run(['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage:/);
  assert.match(stdout, /a required property failed/);
});

test('a trapped graph exits 1 and names the failing property', async () => {
  const { code, stdout, stderr } = await run([FIXTURE, '--no-color']);
  assert.equal(code, 1);
  assert.match(stdout, /1 dead state/);
  assert.match(stdout, /retry/);
  assert.match(stderr, /required property failed: branch-stable/);
});

test('exit code follows --require', async () => {
  const onlyReachable = await run([FIXTURE, '--require', 'reachable', '--no-color']);
  assert.equal(onlyReachable.code, 0, 'done is still reachable, so this passes');

  const safe = await run([FIXTURE, '--require', 'safe-reachable', '--no-color']);
  assert.equal(safe.code, 1);
});

test('--json emits the analysis with the static-analysis note', async () => {
  const { code, stdout } = await run([FIXTURE, '--json']);
  assert.equal(code, 1);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.adapter, 'json');
  assert.equal(parsed.branchStable.verdict, 'fail');
  assert.deepEqual(
    parsed.dead.map((d) => d.state),
    ['retry'],
  );
  assert.match(parsed.note, /not runtime behaviour/);
});

test('--mermaid prints a diagram with the dead class', async () => {
  const { stdout } = await run([FIXTURE, '--mermaid']);
  assert.match(stdout, /^flowchart TD/);
  assert.match(stdout, /classDef dead/);
});

test('a graph is read from stdin', async () => {
  const graph = JSON.stringify({
    entry: 'a',
    goal: ['b'],
    nodes: ['a', 'b'],
    edges: [['a', 'b']],
  });
  const { code, stdout } = await run(['--no-color'], graph);
  assert.equal(code, 0);
  assert.match(stdout, /PASS {2}reachable/);
});

test('a graph missing its goal exits 2 rather than reporting confident nonsense', async () => {
  const flowchart = 'flowchart TD\n  a --> b\n  b --> c\n';
  const { code, stderr } = await run(['--no-color'], flowchart);
  assert.equal(code, 2);
  assert.match(stderr, /could not determine everything it needs/);
  assert.match(stderr, /goal/);
});

test('supplying the missing pieces makes the same graph analysable', async () => {
  const flowchart = 'flowchart TD\n  a --> b\n  b --> c\n';
  const { code, stdout } = await run(['--entry', 'a', '--goal', 'c', '--no-color'], flowchart);
  assert.equal(code, 0);
  assert.match(stdout, /PASS {2}branch-stable/);
});

test('an unknown option exits 2', async () => {
  const { code, stderr } = await run(['--nope']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown option --nope/);
});

test('an unknown --require property is rejected by name', async () => {
  const { code, stderr } = await run([FIXTURE, '--require', 'wibble']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown property "wibble"/);
});

test('a missing file exits 2 without a stack trace', async () => {
  const { code, stderr } = await run(['does-not-exist.json']);
  assert.equal(code, 2);
  assert.match(stderr, /sinkstate: /);
  assert.doesNotMatch(stderr, /at Object\./);
});
