import { build } from 'esbuild';
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Produce the single-file CLI that `curl … | sh` installs.
 *
 * The distributed artifact has to be one file with zero dependencies and only
 * `node:` builtins, because the install path copies it somewhere on PATH and
 * runs it directly — there is no node_modules next to it. The workspace build
 * (`dist/index.js`, which imports @sinkstate/core) stays as it is for npm and
 * for local development.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'dist', 'sinkstate.mjs');

await mkdir(dirname(out), { recursive: true });

const result = await build({
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // Everything is workspace-local and dependency-free, so nothing may be
  // external: an unresolved import would only surface at install time.
  external: [],
  // No shebang banner: src/index.ts already carries one and esbuild preserves
  // it, so adding another puts a second `#!` on line 2 and node refuses the file.
  legalComments: 'none',
  metafile: true,
});

const inputs = Object.keys(result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].inputs);
const foreign = inputs.filter((f) => f.includes('node_modules'));
if (foreign.length) {
  console.error('bundle pulled in node_modules, which the single-file CLI cannot have:');
  for (const f of foreign) console.error(`  ${f}`);
  process.exit(1);
}

await chmod(out, 0o755);

/**
 * The GitHub Action ships the same bundle, committed.
 *
 * Checking a build artifact into the repo is the standard way JS actions are
 * distributed — `uses: profullstack/sinkstate@v1` checks out the tag and runs
 * what is there, with no install step and no dependency on sinkstate.com being
 * up. `action/bundle.test.js` fails if the committed copy drifts from a fresh
 * build, which is the risk this trade buys.
 */
const actionCopy = join(root, '..', '..', 'action', 'sinkstate.mjs');
await mkdir(dirname(actionCopy), { recursive: true });
await copyFile(out, actionCopy);
await chmod(actionCopy, 0o755);

console.log(`bundled ${inputs.length} modules -> dist/sinkstate.mjs (+ action/sinkstate.mjs)`);
