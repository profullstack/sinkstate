import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const RUNNER = join(repoRoot, 'action', 'run.mjs');

function runAction(env, cwd) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [RUNNER],
      { cwd, env: { ...process.env, GITHUB_WORKSPACE: cwd, INPUT_COMMENT: 'false', ...env } },
      (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }),
    );
  });
}

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'sinkstate-action-'));
  await mkdir(join(dir, 'graphs'), { recursive: true });
  await writeFile(
    join(dir, 'graphs', 'clean.json'),
    JSON.stringify({ entry: 'a', goal: ['b'], nodes: ['a', 'b'], edges: [['a', 'b']] }),
  );
  await writeFile(
    join(dir, 'graphs', 'trap.json'),
    JSON.stringify({
      entry: 'a',
      goal: ['b'],
      nodes: ['a', 'b', 'stuck'],
      edges: [
        ['a', 'b'],
        ['a', 'stuck'],
        ['stuck', 'stuck'],
      ],
    }),
  );
  return dir;
}

test('the committed action bundle matches a fresh CLI build', async () => {
  const committed = await readFile(join(repoRoot, 'action', 'sinkstate.mjs'), 'utf8');
  const built = await readFile(join(here, '..', 'dist', 'sinkstate.mjs'), 'utf8');
  assert.equal(
    committed,
    built,
    'action/sinkstate.mjs has drifted — run `pnpm --filter sinkstate build` and commit the result',
  );
});

test('the action reports dead states and exits 1', async () => {
  const dir = await workspace();
  const { code, stdout } = await runAction({ INPUT_FILES: 'graphs/**/*.json' }, dir);
  assert.equal(code, 1);
  assert.match(stdout, /1 dead state across 2 graphs/);
  assert.match(stdout, /`stuck`/);
  assert.match(stdout, /graphs\/trap\.json/);
  assert.match(stdout, /1 graph with no dead states/, 'clean graphs are collapsed, not listed inline');
});

test('a clean workspace exits 0', async () => {
  const dir = await workspace();
  const { code, stdout } = await runAction({ INPUT_FILES: 'graphs/clean.json' }, dir);
  assert.equal(code, 0);
  assert.match(stdout, /No dead states across 1 graph/);
});

test('fail-on-error=false reports without failing the job', async () => {
  const dir = await workspace();
  const { code, stdout } = await runAction(
    { INPUT_FILES: 'graphs/**/*.json', INPUT_FAIL_ON_ERROR: 'false' },
    dir,
  );
  assert.equal(code, 0);
  assert.match(stdout, /1 dead state/);
});

test('outputs are written for downstream steps', async () => {
  const dir = await workspace();
  const outputFile = join(dir, 'outputs.txt');
  await writeFile(outputFile, '');
  await runAction({ INPUT_FILES: 'graphs/**/*.json', GITHUB_OUTPUT: outputFile }, dir);
  const written = await readFile(outputFile, 'utf8');
  assert.match(written, /^dead=1$/m);
  assert.match(written, /^stable=false$/m);
  assert.match(written, /^files-checked=2$/m);
});

test('no matching files is a pass, not a crash', async () => {
  const dir = await workspace();
  const { code, stdout } = await runAction({ INPUT_FILES: 'nope/**/*.json' }, dir);
  assert.equal(code, 0);
  assert.match(stdout, /no files matched/);
});

test('a missing files input exits 2', async () => {
  const dir = await workspace();
  const { code, stderr } = await runAction({ INPUT_FILES: '' }, dir);
  assert.equal(code, 2);
  assert.match(stderr, /`files` input is required/);
});
