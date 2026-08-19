#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import {
  analyze,
  adapterNames,
  exitCode,
  formatText,
  parseGraph,
  toMermaid,
  PROPERTY_KEYS,
  PROPERTY_LABELS,
  STATIC_ANALYSIS_NOTE,
  type PropertyKey,
} from '@sinkstate/core';

const VERSION = '0.1.0';

const USAGE = `sinkstate ${VERSION} — which states can your agent enter but never leave?

Usage:
  sinkstate <file>                 analyse a graph file
  sinkstate -                      read the graph from stdin
  cat graph.json | sinkstate

Options:
  --adapter <name>     ${adapterNames.join(' | ')} (default: auto-detect)
  --entry <state>      entry state, when the adapter cannot infer it
  --goal <a,b>         goal states, comma separated
  --unsafe <a,b>       states a safe path may not cross
  --require <props>    properties that must pass, comma separated
                       (${PROPERTY_KEYS.join(', ')}; default: reachable,branchStable)
  --json               machine-readable output
  --mermaid            print the annotated diagram instead of a report
  --no-color           disable colour
  -h, --help           this text
  -v, --version        print the version

Exit codes:
  0  every required property passed
  1  a required property failed
  2  the graph could not be read or parsed

${STATIC_ANALYSIS_NOTE}`;

interface Options {
  file?: string;
  adapter?: string;
  entry?: string;
  goal?: string[];
  unsafe?: string[];
  require: PropertyKey[];
  json: boolean;
  mermaid: boolean;
  color: boolean;
}

const ALIASES: Record<string, PropertyKey> = {
  reachable: 'reachable',
  'branch-stable': 'branchStable',
  branchstable: 'branchStable',
  branchStable: 'branchStable',
  'safe-reachable': 'safeReachable',
  safereachable: 'safeReachable',
  safeReachable: 'safeReachable',
  'safe-stable': 'safeStable',
  safestable: 'safeStable',
  safeStable: 'safeStable',
};

class UsageError extends Error {}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    require: ['reachable', 'branchStable'],
    json: false,
    mermaid: false,
    color: process.stdout.isTTY === true && !process.env['NO_COLOR'],
  };

  const list = (value: string | undefined, flag: string): string[] => {
    if (value === undefined) throw new UsageError(`${flag} needs a value`);
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    switch (arg) {
      case '-h':
      case '--help':
        process.stdout.write(`${USAGE}\n`);
        process.exit(0);
        break;
      case '-v':
      case '--version':
        process.stdout.write(`${VERSION}\n`);
        process.exit(0);
        break;
      case '--json':
        options.json = true;
        break;
      case '--mermaid':
        options.mermaid = true;
        break;
      case '--no-color':
        options.color = false;
        break;
      case '--adapter':
        options.adapter = argv[++i];
        if (!options.adapter) throw new UsageError('--adapter needs a value');
        break;
      case '--entry':
        options.entry = argv[++i];
        if (!options.entry) throw new UsageError('--entry needs a value');
        break;
      case '--goal':
        options.goal = list(argv[++i], '--goal');
        break;
      case '--unsafe':
        options.unsafe = list(argv[++i], '--unsafe');
        break;
      case '--require': {
        const names = list(argv[++i], '--require');
        options.require = names.map((name) => {
          const key = ALIASES[name];
          if (!key) {
            throw new UsageError(`unknown property "${name}" — expected one of: ${Object.keys(ALIASES).join(', ')}`);
          }
          return key;
        });
        break;
      }
      default:
        if (arg.startsWith('--')) throw new UsageError(`unknown option ${arg}`);
        if (options.file) throw new UsageError('only one input file is accepted');
        options.file = arg;
    }
  }
  return options;
}

async function readInput(file: string | undefined): Promise<string> {
  if (file && file !== '-') return readFile(file, 'utf8');
  if (process.stdin.isTTY) throw new UsageError('no input — pass a file, or pipe a graph on stdin');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const input = await readInput(options.file);

  const parsed = parseGraph(input, {
    ...(options.adapter ? { adapter: options.adapter } : {}),
    ...(options.entry ? { entry: options.entry } : {}),
    ...(options.goal ? { goal: options.goal } : {}),
    ...(options.unsafe ? { unsafe: options.unsafe } : {}),
  });

  // A missing entry or goal makes every verdict meaningless, so this is a hard
  // stop rather than a warning printed above a confident-looking report.
  if (parsed.missing.length > 0) {
    process.stderr.write(
      `sinkstate: the ${parsed.adapter} adapter could not determine everything it needs:\n` +
        parsed.missing.map((m) => `  - ${m}\n`).join('') +
        `\nPass them explicitly, e.g. --entry start --goal done\n`,
    );
    return 2;
  }

  const analysis = analyze(parsed.graph);

  if (options.mermaid) {
    process.stdout.write(`${toMermaid(parsed.graph, analysis)}\n`);
    return exitCode(analysis, options.require);
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          adapter: parsed.adapter,
          inferred: parsed.inferred,
          note: STATIC_ANALYSIS_NOTE,
          ...analysis,
        },
        null,
        2,
      )}\n`,
    );
    return exitCode(analysis, options.require);
  }

  for (const note of parsed.inferred) {
    process.stderr.write(`sinkstate: ${note}\n`);
  }
  if (parsed.inferred.length) process.stderr.write('\n');

  process.stdout.write(`${formatText(analysis, { color: options.color })}\n`);

  const failed = options.require.filter((key) => analysis[key].verdict === 'fail');
  if (failed.length) {
    process.stderr.write(
      `\nsinkstate: required ${failed.length === 1 ? 'property' : 'properties'} failed: ${failed
        .map((k) => PROPERTY_LABELS[k])
        .join(', ')}\n`,
    );
  }
  return exitCode(analysis, options.require);
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`sinkstate: ${message}\n`);
    process.exit(err instanceof UsageError ? 2 : 2);
  });
