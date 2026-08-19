#!/usr/bin/env node
/**
 * The GitHub Action runner.
 *
 * Analyses every matching graph file, writes a job summary, sets outputs, and
 * — on a pull request — leaves or updates a single comment. The comment is
 * updated rather than appended so a branch with twelve pushes does not produce
 * twelve identical comments.
 *
 * node builtins only, so it runs on a bare runner with no install step.
 */
import { readFile, appendFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const input = (name, fallback = '') =>
  process.env[`INPUT_${name.toUpperCase().replace(/[ -]/g, '_')}`]?.trim() || fallback;

const MARKER = '<!-- sinkstate-report -->';

/** Minimal glob: supports `**`, `*` and `?`. Enough for path patterns. */
function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

async function walk(dir, root, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, root, acc);
    else acc.push(relative(root, full).split(sep).join('/'));
  }
  return acc;
}

async function resolveFiles(patterns, root) {
  const explicit = [];
  const globs = [];
  for (const p of patterns) {
    if (/[*?]/.test(p)) globs.push(globToRegExp(p));
    else explicit.push(p);
  }
  const found = [...explicit];
  if (globs.length) {
    const all = await walk(root, root);
    for (const file of all) {
      if (globs.some((g) => g.test(file))) found.push(file);
    }
  }
  return [...new Set(found)].sort();
}

async function main() {
  const workspace = process.env['GITHUB_WORKSPACE'] ?? process.cwd();
  const patterns = input('files')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (patterns.length === 0) {
    console.error('sinkstate: `files` input is required (a path or a glob)');
    process.exit(2);
  }

  const files = await resolveFiles(patterns, workspace);
  if (files.length === 0) {
    console.log(`sinkstate: no files matched ${patterns.join(', ')} — nothing to check`);
    await setOutput('dead', '0');
    await setOutput('stable', 'true');
    await setOutput('files-checked', '0');
    return 0;
  }

  // The bundle is a CLI, not a library: importing it would run main() and exit.
  // It is invoked as a subprocess, which also gives us its exit code for free.
  const { execFile } = await import('node:child_process');
  const run = (args) =>
    new Promise((resolve) => {
      execFile(process.execPath, [join(here, 'sinkstate.mjs'), ...args], { cwd: workspace }, (err, stdout, stderr) => {
        resolve({ code: err?.code ?? 0, stdout, stderr });
      });
    });

  const required = input('require', 'reachable,branch-stable');
  const extra = [];
  if (input('entry')) extra.push('--entry', input('entry'));
  if (input('goal')) extra.push('--goal', input('goal'));
  if (input('unsafe')) extra.push('--unsafe', input('unsafe'));
  if (input('adapter')) extra.push('--adapter', input('adapter'));

  const results = [];
  for (const file of files) {
    const { code, stdout, stderr } = await run([file, '--json', '--require', required, ...extra]);
    if (code === 2) {
      results.push({ file, error: stderr.trim() || 'could not be analysed' });
      continue;
    }
    try {
      results.push({ file, failed: code === 1, analysis: JSON.parse(stdout) });
    } catch {
      results.push({ file, error: 'the CLI produced output that could not be parsed' });
    }
  }

  const totalDead = results.reduce((n, r) => n + (r.analysis?.dead.length ?? 0), 0);
  const anyFailed = results.some((r) => r.failed || r.error);

  const body = renderMarkdown(results, totalDead);
  console.log(body);

  if (process.env['GITHUB_STEP_SUMMARY']) {
    await appendFile(process.env['GITHUB_STEP_SUMMARY'], `${body}\n`);
  }

  await setOutput('dead', String(totalDead));
  await setOutput('stable', String(!anyFailed));
  await setOutput('files-checked', String(files.length));

  if (input('comment') === 'true') await comment(body);

  return anyFailed && input('fail-on-error', 'true') === 'true' ? 1 : 0;
}

function renderMarkdown(results, totalDead) {
  const lines = [MARKER, '', '## sinkstate', ''];
  const clean = results.filter((r) => r.analysis && r.analysis.dead.length === 0 && !r.failed);

  if (totalDead === 0 && !results.some((r) => r.error || r.failed)) {
    lines.push(`No dead states across ${results.length} graph${results.length === 1 ? '' : 's'}. Every state can still reach done.`);
  } else {
    lines.push(
      `${totalDead} dead state${totalDead === 1 ? '' : 's'} across ${results.length} graph${results.length === 1 ? '' : 's'}.`,
    );
  }
  lines.push('');

  for (const result of results) {
    if (result.error) {
      lines.push(`### \`${result.file}\``, '', `Could not analyse: ${result.error}`, '');
      continue;
    }
    const a = result.analysis;
    if (a.dead.length === 0 && !result.failed) continue;

    lines.push(`### \`${result.file}\``, '');
    for (const key of ['reachable', 'branchStable', 'safeReachable', 'safeStable']) {
      const p = a[key];
      if (p.verdict === 'not-applicable') continue;
      lines.push(`- ${p.verdict === 'pass' ? '✅' : '❌'} **${key}** — ${p.question}`);
    }
    if (a.dead.length) {
      lines.push('', '| dead state | why | reached via |', '| --- | --- | --- |');
      for (const dead of a.dead.slice(0, 25)) {
        const why = dead.cause === 'no-outgoing-edges' ? 'no outgoing transitions' : `closed component of ${dead.component.length}`;
        lines.push(`| \`${dead.state}\` | ${why} | ${dead.witness ? dead.witness.map((s) => `\`${s}\``).join(' → ') : '_unreachable from entry_'} |`);
      }
      if (a.dead.length > 25) lines.push(`| … | ${a.dead.length - 25} more | |`);
    }
    const unavoidable = (a.unsafeCut ?? []).filter((c) => c.unavoidable);
    if (unavoidable.length) {
      lines.push('', `Unavoidable unsafe states: ${unavoidable.map((c) => `\`${c.state}\``).join(', ')} — every path to done crosses them.`);
    }
    lines.push('');
  }

  if (clean.length) {
    lines.push(`<details><summary>${clean.length} graph${clean.length === 1 ? '' : 's'} with no dead states</summary>`, '');
    for (const r of clean) lines.push(`- \`${r.file}\``);
    lines.push('', '</details>', '');
  }

  lines.push('---', '', '_sinkstate analyses the declared graph, not runtime behaviour. A conditional edge is treated as always traversable._');
  return lines.join('\n');
}

async function setOutput(name, value) {
  const file = process.env['GITHUB_OUTPUT'];
  if (!file) return;
  await appendFile(file, `${name}=${value}\n`);
}

/** Post or update the single sinkstate comment on the pull request. */
async function comment(body) {
  const token = input('token');
  const repo = process.env['GITHUB_REPOSITORY'];
  const eventPath = process.env['GITHUB_EVENT_PATH'];
  if (!token || !repo || !eventPath) {
    console.log('sinkstate: no token or event payload — skipping the PR comment');
    return;
  }

  let number;
  try {
    const event = JSON.parse(await readFile(eventPath, 'utf8'));
    number = event.pull_request?.number ?? event.issue?.number;
  } catch {
    /* not a PR event */
  }
  if (!number) {
    console.log('sinkstate: not a pull request — skipping the comment');
    return;
  }

  const api = `https://api.github.com/repos/${repo}/issues/${number}/comments`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'user-agent': 'sinkstate-action',
  };

  const existing = await fetch(`${api}?per_page=100`, { headers })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const mine = Array.isArray(existing) ? existing.find((c) => c.body?.includes(MARKER)) : undefined;

  const target = mine
    ? `https://api.github.com/repos/${repo}/issues/comments/${mine.id}`
    : api;
  const response = await fetch(target, {
    method: mine ? 'PATCH' : 'POST',
    headers,
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    console.log(`sinkstate: could not ${mine ? 'update' : 'post'} the comment (${response.status})`);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`sinkstate: ${err?.message ?? err}`);
    process.exit(2);
  });
