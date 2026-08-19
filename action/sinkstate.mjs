#!/usr/bin/env node

// src/index.ts
import { readFile } from "node:fs/promises";

// ../../packages/core/dist/validate.js
function validate(graph) {
  const issues = [];
  const err = (message) => issues.push({ level: "error", message });
  const warn = (message) => issues.push({ level: "warning", message });
  if (!graph || typeof graph !== "object") {
    return [{ level: "error", message: "graph must be an object" }];
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    err("nodes must be a non-empty array");
  }
  if (!Array.isArray(graph.edges))
    err("edges must be an array");
  if (typeof graph.entry !== "string" || graph.entry === "")
    err("entry must be a state name");
  if (!Array.isArray(graph.goal) || graph.goal.length === 0) {
    err("goal must be a non-empty array of state names");
  }
  if (issues.some((i) => i.level === "error"))
    return issues;
  const nodes = new Set(graph.nodes);
  if (nodes.size !== graph.nodes.length) {
    const seen = /* @__PURE__ */ new Set();
    const dupes = graph.nodes.filter((n) => seen.has(n) ? true : (seen.add(n), false));
    warn(`duplicate node names ignored: ${[...new Set(dupes)].sort().join(", ")}`);
  }
  if (!nodes.has(graph.entry))
    err(`entry "${graph.entry}" is not in nodes`);
  for (const g of graph.goal) {
    if (!nodes.has(g))
      err(`goal "${g}" is not in nodes`);
  }
  for (const u of graph.unsafe ?? []) {
    if (!nodes.has(u))
      err(`unsafe "${u}" is not in nodes`);
  }
  graph.edges.forEach((edge, i) => {
    if (!Array.isArray(edge) || edge.length !== 2) {
      err(`edges[${i}] must be a [from, to] pair`);
      return;
    }
    const [from, to] = edge;
    if (!nodes.has(from))
      err(`edges[${i}] leaves undeclared state "${from}"`);
    if (!nodes.has(to))
      err(`edges[${i}] points at undeclared state "${to}"`);
  });
  for (const g of graph.goal) {
    if ((graph.unsafe ?? []).includes(g)) {
      warn(`"${g}" is both a goal and unsafe \u2014 no safe path can ever end there`);
    }
  }
  return issues;
}
function assertValid(graph) {
  const errors = validate(graph).filter((i) => i.level === "error");
  if (errors.length) {
    throw new Error(`invalid graph:
  ${errors.map((e) => e.message).join("\n  ")}`);
  }
}

// ../../packages/core/dist/analyze.js
function adjacency(nodes, edges) {
  const fwd = /* @__PURE__ */ new Map();
  const rev = /* @__PURE__ */ new Map();
  for (const n of nodes) {
    fwd.set(n, []);
    rev.set(n, []);
  }
  for (const [from, to] of edges) {
    fwd.get(from)?.push(to);
    rev.get(to)?.push(from);
  }
  return { fwd, rev };
}
function closure(sources, adj) {
  const seen = new Set(sources);
  const queue = [...seen];
  for (let i = 0; i < queue.length; i++) {
    for (const next of adj.get(queue[i]) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}
function pathTo(from, targets, adj) {
  if (targets.has(from))
    return [from];
  const parent = /* @__PURE__ */ new Map([[from, from]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const next of adj.get(current) ?? []) {
      if (parent.has(next))
        continue;
      parent.set(next, current);
      if (targets.has(next)) {
        const path = [next];
        let step = next;
        while (step !== from) {
          step = parent.get(step);
          path.push(step);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return void 0;
}
var sorted = (set) => [...set].sort();
function analyze(graph) {
  assertValid(graph);
  const nodes = [...new Set(graph.nodes)];
  const { fwd, rev } = adjacency(nodes, graph.edges);
  const goals = new Set(graph.goal);
  const unsafe = new Set(graph.unsafe ?? []);
  const hasUnsafe = unsafe.size > 0;
  const live = closure(goals, rev);
  const deadSet = new Set(nodes.filter((n) => !live.has(n)));
  const reachableStates = closure([graph.entry], fwd);
  const describeDead = (state) => {
    const outgoing = fwd.get(state) ?? [];
    const component = outgoing.length === 0 ? [state] : sorted(closure([state], fwd));
    const witness = pathTo(graph.entry, /* @__PURE__ */ new Set([state]), fwd);
    const entry = {
      state,
      cause: outgoing.length === 0 ? "no-outgoing-edges" : "closed-component",
      component
    };
    if (witness)
      entry.witness = witness;
    return entry;
  };
  const dead = sorted(deadSet).map(describeDead);
  const reachableDead = dead.filter((d) => reachableStates.has(d.state));
  const reachablePath = pathTo(graph.entry, goals, fwd);
  const reachable = {
    modal: "\u25C7*G",
    question: "Can this graph finish at all?",
    verdict: live.has(graph.entry) ? "pass" : "fail"
  };
  if (reachablePath)
    reachable.witness = reachablePath;
  const branchStable = {
    modal: "\u25A1*\u25C7*G",
    question: "Can every state it can enter still finish?",
    verdict: reachableDead.length === 0 ? "pass" : "fail"
  };
  const firstTrap = reachableDead[0];
  if (firstTrap?.witness)
    branchStable.witness = firstTrap.witness;
  const safeNodes = nodes.filter((n) => !unsafe.has(n));
  const safeEdges = graph.edges.filter(([f, t]) => !unsafe.has(f) && !unsafe.has(t));
  const { fwd: safeFwd, rev: safeRev } = adjacency(safeNodes, safeEdges);
  const safeGoals = new Set(graph.goal.filter((g) => !unsafe.has(g)));
  const safePre = closure(safeGoals, safeRev);
  const entryIsSafe = !unsafe.has(graph.entry);
  const safeDeadSet = new Set(safeNodes.filter((n) => !safePre.has(n)));
  const notApplicable = (modal, question) => ({
    modal,
    question,
    verdict: "not-applicable",
    reason: "no unsafe states were declared"
  });
  let safeReachable;
  let safeStable;
  if (!hasUnsafe) {
    safeReachable = notApplicable("\u25C7*_safe G", "Is there a path to done that never crosses an unsafe state?");
    safeStable = notApplicable("\u25A1*_safe \u25C7*_safe G", "Both at once \u2014 the only real guarantee.");
  } else {
    const safePath = entryIsSafe ? pathTo(graph.entry, safeGoals, safeFwd) : void 0;
    safeReachable = {
      modal: "\u25C7*_safe G",
      question: "Is there a path to done that never crosses an unsafe state?",
      verdict: entryIsSafe && safePre.has(graph.entry) ? "pass" : "fail"
    };
    if (!entryIsSafe)
      safeReachable.reason = `the entry state "${graph.entry}" is itself unsafe`;
    else if (safeGoals.size === 0)
      safeReachable.reason = "every goal state is marked unsafe";
    if (safePath)
      safeReachable.witness = safePath;
    const safeReachableStates = entryIsSafe ? closure([graph.entry], safeFwd) : /* @__PURE__ */ new Set();
    const safeTraps = sorted(safeReachableStates).filter((s) => safeDeadSet.has(s));
    safeStable = {
      modal: "\u25A1*_safe \u25C7*_safe G",
      question: "Both at once \u2014 the only real guarantee.",
      verdict: entryIsSafe && safeTraps.length === 0 && safePre.has(graph.entry) ? "pass" : "fail"
    };
    if (!entryIsSafe)
      safeStable.reason = `the entry state "${graph.entry}" is itself unsafe`;
    const safeTrapWitness = safeTraps[0] ? pathTo(graph.entry, /* @__PURE__ */ new Set([safeTraps[0]]), safeFwd) : void 0;
    if (safeTrapWitness)
      safeStable.witness = safeTrapWitness;
  }
  const unsafeCut = [];
  if (hasUnsafe) {
    const onSomePath = sorted(unsafe).filter((u) => reachableStates.has(u) && live.has(u));
    for (const state of onSomePath) {
      const keep = nodes.filter((n) => n !== state);
      const { fwd: cutFwd } = adjacency(keep, graph.edges.filter(([f, t]) => f !== state && t !== state));
      const stillReaches = graph.entry !== state && pathTo(graph.entry, goals, cutFwd) !== void 0;
      unsafeCut.push({ state, unavoidable: !stillReaches });
    }
  }
  return {
    reachable,
    branchStable,
    safeReachable,
    safeStable,
    dead,
    reachableDead,
    safeDead: sorted(safeDeadSet),
    unsafeCut,
    reachableStates: sorted(reachableStates),
    liveStates: sorted(live),
    stats: {
      nodes: nodes.length,
      edges: graph.edges.length,
      dead: dead.length,
      reachableDead: reachableDead.length
    }
  };
}

// ../../packages/core/dist/adapters/json.js
var jsonAdapter = {
  name: "json",
  matches(input) {
    const text = input.trim();
    if (!text.startsWith("{"))
      return false;
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed["nodes"]) && Array.isArray(parsed["edges"]) && "entry" in parsed;
    } catch {
      return false;
    }
  },
  parse(input) {
    const raw = JSON.parse(input);
    const edges = [];
    for (const edge of raw["edges"] ?? []) {
      if (Array.isArray(edge)) {
        edges.push([String(edge[0]), String(edge[1])]);
        continue;
      }
      if (edge && typeof edge === "object") {
        const o = edge;
        const from = o["from"] ?? o["source"];
        const to = o["to"] ?? o["target"];
        if (from !== void 0 && to !== void 0) {
          edges.push([String(from), String(to)]);
          continue;
        }
      }
      throw new Error(`edge is neither a [from, to] pair nor a {from, to} object: ${JSON.stringify(edge)}`);
    }
    const graph = {
      entry: String(raw["entry"] ?? ""),
      goal: (raw["goal"] ?? []).map(String),
      nodes: (raw["nodes"] ?? []).map(String),
      edges
    };
    const unsafe = raw["unsafe"];
    if (unsafe)
      graph.unsafe = unsafe.map(String);
    return { graph, inferred: [], missing: [] };
  }
};

// ../../packages/core/dist/adapters/langgraph.js
var langgraphAdapter = {
  name: "langgraph",
  matches(input) {
    const text = input.trim();
    if (!text.startsWith("{"))
      return false;
    try {
      const parsed = JSON.parse(text);
      const nodes = parsed["nodes"];
      if (!Array.isArray(nodes) || !Array.isArray(parsed["edges"]))
        return false;
      const ids = nodes.map((n) => n && typeof n === "object" ? n["id"] : n);
      return ids.includes("__start__") || ids.includes("__end__");
    } catch {
      return false;
    }
  },
  parse(input) {
    const raw = JSON.parse(input);
    const inferred = [];
    const missing = [];
    const nodes = (raw["nodes"] ?? []).map((n) => n && typeof n === "object" ? String(n["id"]) : String(n));
    const edges = [];
    let conditional = 0;
    for (const edge of raw["edges"] ?? []) {
      if (!edge || typeof edge !== "object")
        continue;
      const o = edge;
      edges.push([String(o["source"]), String(o["target"])]);
      if (o["conditional"])
        conditional++;
    }
    const graph = { entry: "", goal: [], nodes, edges };
    if (nodes.includes("__start__")) {
      graph.entry = "__start__";
      inferred.push("entry inferred as LangGraph's __start__ node");
    } else {
      missing.push("entry \u2014 no __start__ node found, pass one explicitly");
    }
    if (nodes.includes("__end__")) {
      graph.goal = ["__end__"];
      inferred.push("goal inferred as LangGraph's __end__ node (END)");
    } else {
      missing.push("goal \u2014 no __end__ node found, pass one explicitly");
    }
    if (conditional > 0) {
      inferred.push(`${conditional} conditional edge${conditional === 1 ? "" : "s"} treated as always traversable \u2014 this is a static reading of the declared graph, not of runtime behaviour`);
    }
    return { graph, inferred, missing };
  }
};

// ../../packages/core/dist/adapters/mermaid.js
var ARROW = /^(.+?)\s*-{2,3}>|^(.+?)\s*-{1,2}\.-*>/;
function nodeId(raw) {
  const text = raw.trim().replace(/^\|[^|]*\|\s*/, "");
  const match = text.match(/^([A-Za-z0-9_.-]+)\s*(?:[[({<]|$)/);
  return match?.[1] ?? text;
}
function splitEdge(line) {
  const arrow2 = line.match(/-{2,3}>|-{1,2}\.-*>|={2,3}>/);
  if (!arrow2 || arrow2.index === void 0)
    return void 0;
  const left = line.slice(0, arrow2.index);
  let right = line.slice(arrow2.index + arrow2[0].length);
  right = right.replace(/^\|[^|]*\|/, "");
  const from = left.split(/\s+/).filter(Boolean).pop();
  if (!from)
    return void 0;
  const to = right.replace(/:.*$/, "");
  return [nodeId(from), nodeId(to)];
}
var mermaidAdapter = {
  name: "mermaid",
  matches(input) {
    return /^\s*(stateDiagram(-v2)?|flowchart\s+\w+|graph\s+\w+)/m.test(input);
  },
  parse(input) {
    const inferred = [];
    const missing = [];
    const isState = /^\s*stateDiagram/m.test(input);
    const order = [];
    const seen = /* @__PURE__ */ new Set();
    const add = (n) => {
      if (n && !seen.has(n)) {
        seen.add(n);
        order.push(n);
      }
    };
    const edges = [];
    const starts = /* @__PURE__ */ new Set();
    const terminals = /* @__PURE__ */ new Set();
    for (const rawLine of input.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("%%"))
        continue;
      if (/^(stateDiagram|flowchart|graph|classDef|class |click |style |subgraph|end$|direction )/.test(line)) {
        continue;
      }
      if (!ARROW.test(line) && !/-{2,3}>|={2,3}>/.test(line))
        continue;
      const pair = splitEdge(line);
      if (!pair)
        continue;
      const [from, to] = pair;
      if (from === "[*]") {
        if (to !== "[*]") {
          starts.add(to);
          add(to);
        }
        continue;
      }
      if (to === "[*]") {
        terminals.add(from);
        add(from);
        continue;
      }
      add(from);
      add(to);
      edges.push([from, to]);
    }
    const graph = { entry: "", goal: [], nodes: order, edges };
    if (starts.size === 1) {
      graph.entry = [...starts][0];
      inferred.push(`entry inferred from the [*] --> ${graph.entry} transition`);
    } else if (starts.size > 1) {
      missing.push(`entry \u2014 the diagram declares ${starts.size} start transitions, pass one explicitly`);
    } else {
      const targets = new Set(edges.map(([, t]) => t));
      const roots = order.filter((n) => !targets.has(n));
      if (roots.length === 1) {
        graph.entry = roots[0];
        inferred.push(`entry inferred as "${graph.entry}", the only node with no incoming edge`);
      } else {
        missing.push("entry \u2014 could not be inferred, pass one explicitly");
      }
    }
    if (terminals.size > 0) {
      graph.goal = [...terminals];
      inferred.push(`goal inferred from ${terminals.size} "--> [*]" terminal transition(s)`);
    } else if (isState) {
      missing.push('goal \u2014 no "--> [*]" terminal found, pass one explicitly');
    } else {
      missing.push('goal \u2014 a flowchart has no terminal concept, so it must be declared; inferring "any node with no outgoing edge" would hide the exact bug this tool looks for');
    }
    return { graph, inferred, missing };
  }
};

// ../../packages/core/dist/adapters/n8n.js
var n8nAdapter = {
  name: "n8n",
  matches(input) {
    const text = input.trim();
    if (!text.startsWith("{"))
      return false;
    try {
      const parsed = JSON.parse(text);
      const nodes = parsed["nodes"];
      if (!Array.isArray(nodes))
        return false;
      const conns = parsed["connections"];
      const looksN8n = nodes.some((n) => n && typeof n === "object" && "name" in n && "type" in n);
      return looksN8n && !!conns && typeof conns === "object";
    } catch {
      return false;
    }
  },
  parse(input) {
    const raw = JSON.parse(input);
    const inferred = [];
    const missing = [];
    const rawNodes = raw["nodes"] ?? [];
    const nodes = rawNodes.map((n) => String(n["name"]));
    const edges = [];
    const connections = raw["connections"] ?? {};
    for (const [from, outputs] of Object.entries(connections)) {
      if (!outputs || typeof outputs !== "object")
        continue;
      for (const branch of Object.values(outputs)) {
        if (!Array.isArray(branch))
          continue;
        for (const group of branch) {
          if (!Array.isArray(group))
            continue;
          for (const target of group) {
            if (target && typeof target === "object") {
              edges.push([from, String(target["node"])]);
            }
          }
        }
      }
    }
    const graph = { entry: "", goal: [], nodes, edges };
    const triggers = rawNodes.filter((n) => /trigger|webhook|start|cron|schedule/i.test(String(n["type"])));
    if (triggers.length === 1) {
      graph.entry = String(triggers[0]?.["name"]);
      inferred.push(`entry inferred from the trigger node "${graph.entry}" (${String(triggers[0]?.["type"])})`);
    } else if (triggers.length > 1) {
      missing.push(`entry \u2014 the workflow has ${triggers.length} trigger nodes (${triggers.map((t) => String(t["name"])).join(", ")}), pass one explicitly`);
    } else {
      missing.push("entry \u2014 no trigger node found, pass one explicitly");
    }
    missing.push('goal \u2014 n8n workflows have no terminal node, so "done" must be declared; inferring it from dangling nodes would hide the dead states this tool reports');
    return { graph, inferred, missing };
  }
};

// ../../packages/core/dist/adapters/index.js
var adapters = [langgraphAdapter, n8nAdapter, jsonAdapter, mermaidAdapter];
var adapterNames = adapters.map((a) => a.name);
function getAdapter(name) {
  const found = adapters.find((a) => a.name === name);
  if (!found) {
    throw new Error(`unknown adapter "${name}" \u2014 available: ${adapterNames.join(", ")}`);
  }
  return found;
}
function detect(input) {
  return adapters.find((a) => {
    try {
      return a.matches(input);
    } catch {
      return false;
    }
  });
}
function parseGraph(input, options = {}) {
  const adapter = options.adapter ? getAdapter(options.adapter) : detect(input);
  if (!adapter) {
    throw new Error(`could not detect the graph format \u2014 pass one of: ${adapterNames.join(", ")}`);
  }
  const result = adapter.parse(input);
  const missing = [...result.missing];
  if (options.entry) {
    result.graph.entry = options.entry;
    for (let i = missing.length - 1; i >= 0; i--) {
      if (missing[i]?.startsWith("entry"))
        missing.splice(i, 1);
    }
  }
  if (options.goal?.length) {
    result.graph.goal = options.goal;
    for (let i = missing.length - 1; i >= 0; i--) {
      if (missing[i]?.startsWith("goal"))
        missing.splice(i, 1);
    }
  }
  if (options.unsafe?.length)
    result.graph.unsafe = options.unsafe;
  return { ...result, missing, adapter: adapter.name };
}

// ../../packages/core/dist/report.js
var PROPERTY_KEYS = ["reachable", "branchStable", "safeReachable", "safeStable"];
var PROPERTY_LABELS = {
  reachable: "reachable",
  branchStable: "branch-stable",
  safeReachable: "safe-reachable",
  safeStable: "safe-stable"
};
var MARK = { pass: "PASS", fail: "FAIL", "not-applicable": " n/a" };
var STATIC_ANALYSIS_NOTE = "sinkstate analyses the declared graph, not runtime behaviour. A conditional edge is treated as always traversable.";
function exitCode(analysis, required) {
  return required.some((key) => analysis[key].verdict === "fail") ? 1 : 0;
}
var arrow = (path) => (path ?? []).join(" \u2192 ");
var paint = (on, code, text) => on ? `\x1B[${code}m${text}\x1B[0m` : text;
function formatText(analysis, options = {}) {
  const c = options.color ?? false;
  const limit = options.limit ?? 20;
  const lines = [];
  const { stats } = analysis;
  lines.push(`graph: ${stats.nodes} states, ${stats.edges} transitions`);
  lines.push("");
  for (const key of PROPERTY_KEYS) {
    const result = analysis[key];
    const colour = result.verdict === "pass" ? "32" : result.verdict === "fail" ? "31" : "90";
    const mark = paint(c, colour, MARK[result.verdict] ?? "????");
    lines.push(`  ${mark}  ${PROPERTY_LABELS[key].padEnd(15)} ${result.modal}`);
    if (result.reason)
      lines.push(`        ${result.reason}`);
    if (result.witness && result.verdict === "pass") {
      lines.push(`        path: ${arrow(result.witness)}`);
    }
    if (result.witness && result.verdict === "fail") {
      lines.push(`        reached via: ${arrow(result.witness)}`);
    }
  }
  if (analysis.dead.length > 0) {
    lines.push("");
    const reachable = analysis.reachableDead.length;
    lines.push(paint(c, "31", `${analysis.dead.length} dead state${analysis.dead.length === 1 ? "" : "s"}`) + ` (${reachable} reachable from the entry):`);
    for (const dead of analysis.dead.slice(0, limit)) {
      const why = dead.cause === "no-outgoing-edges" ? "no outgoing transitions" : `trapped in a closed component of ${dead.component.length}: ${dead.component.join(", ")}`;
      const tag = analysis.reachableDead.some((d) => d.state === dead.state) ? "" : " (unreachable from entry)";
      lines.push(`  ${dead.state}${tag} \u2014 ${why}`);
      if (dead.witness)
        lines.push(`      entered via: ${arrow(dead.witness)}`);
    }
    if (analysis.dead.length > limit) {
      lines.push(`  \u2026 and ${analysis.dead.length - limit} more`);
    }
  }
  if (analysis.unsafeCut.length > 0) {
    lines.push("");
    lines.push("unsafe states on a path to done:");
    for (const cut of analysis.unsafeCut) {
      lines.push(`  ${cut.state}${cut.unavoidable ? paint(c, "31", " \u2014 unavoidable: every path to done crosses it") : ""}`);
    }
  }
  lines.push("");
  lines.push(paint(c, "90", STATIC_ANALYSIS_NOTE));
  return lines.join("\n");
}
var safeId = (name) => {
  let out = "n";
  for (const unit of new TextEncoder().encode(name)) {
    out += unit.toString(16).padStart(2, "0");
  }
  return out;
};
function toMermaid(graph, analysis, maxNodes = 60) {
  const dead = new Set(analysis.dead.map((d) => d.state));
  const unsafe = new Set(graph.unsafe ?? []);
  const goals = new Set(graph.goal);
  const witness = new Set([analysis.branchStable.witness, analysis.reachable.witness].flatMap((p) => p ?? []));
  let nodes = graph.nodes;
  let truncated = false;
  if (nodes.length > maxNodes) {
    const keep = /* @__PURE__ */ new Set([graph.entry, ...goals, ...dead, ...witness]);
    for (const [from, to] of graph.edges) {
      if (keep.has(from))
        keep.add(to);
      if (keep.has(to))
        keep.add(from);
    }
    nodes = graph.nodes.filter((n) => keep.has(n));
    truncated = true;
  }
  const shown = new Set(nodes);
  const lines = ["flowchart TD"];
  for (const node of nodes) {
    const shape = goals.has(node) ? `([${node}])` : dead.has(node) ? `[["${node}"]]` : `["${node}"]`;
    lines.push(`  ${safeId(node)}${shape}`);
  }
  for (const [from, to] of graph.edges) {
    if (!shown.has(from) || !shown.has(to))
      continue;
    lines.push(`  ${safeId(from)} --> ${safeId(to)}`);
  }
  lines.push("  classDef dead fill:#7f1d1d,stroke:#ef4444,color:#fff");
  lines.push("  classDef goal fill:#14532d,stroke:#22c55e,color:#fff");
  lines.push("  classDef unsafe fill:#78350f,stroke:#f59e0b,color:#fff");
  lines.push("  classDef entry fill:#1e3a8a,stroke:#3b82f6,color:#fff");
  const classed = (name, members) => {
    const present = members.filter((m) => shown.has(m));
    if (present.length)
      lines.push(`  class ${present.map(safeId).join(",")} ${name}`);
  };
  classed("dead", [...dead]);
  classed("goal", [...goals]);
  classed("unsafe", [...unsafe].filter((u) => !dead.has(u)));
  classed("entry", [graph.entry]);
  if (truncated) {
    lines.push(`  %% showing ${nodes.length} of ${graph.nodes.length} states: the dead set, the witness path and their neighbours`);
  }
  return lines.join("\n");
}

// src/index.ts
var VERSION = "0.1.0";
var USAGE = `sinkstate ${VERSION} \u2014 which states can your agent enter but never leave?

Usage:
  sinkstate <file>                 analyse a graph file
  sinkstate -                      read the graph from stdin
  cat graph.json | sinkstate

Options:
  --adapter <name>     ${adapterNames.join(" | ")} (default: auto-detect)
  --entry <state>      entry state, when the adapter cannot infer it
  --goal <a,b>         goal states, comma separated
  --unsafe <a,b>       states a safe path may not cross
  --require <props>    properties that must pass, comma separated
                       (${PROPERTY_KEYS.join(", ")}; default: reachable,branchStable)
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
var ALIASES = {
  reachable: "reachable",
  "branch-stable": "branchStable",
  branchstable: "branchStable",
  branchStable: "branchStable",
  "safe-reachable": "safeReachable",
  safereachable: "safeReachable",
  safeReachable: "safeReachable",
  "safe-stable": "safeStable",
  safestable: "safeStable",
  safeStable: "safeStable"
};
var UsageError = class extends Error {
};
function parseArgs(argv) {
  const options = {
    require: ["reachable", "branchStable"],
    json: false,
    mermaid: false,
    color: process.stdout.isTTY === true && !process.env["NO_COLOR"]
  };
  const list = (value, flag) => {
    if (value === void 0) throw new UsageError(`${flag} needs a value`);
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        process.stdout.write(`${USAGE}
`);
        process.exit(0);
        break;
      case "-v":
      case "--version":
        process.stdout.write(`${VERSION}
`);
        process.exit(0);
        break;
      case "--json":
        options.json = true;
        break;
      case "--mermaid":
        options.mermaid = true;
        break;
      case "--no-color":
        options.color = false;
        break;
      case "--adapter":
        options.adapter = argv[++i];
        if (!options.adapter) throw new UsageError("--adapter needs a value");
        break;
      case "--entry":
        options.entry = argv[++i];
        if (!options.entry) throw new UsageError("--entry needs a value");
        break;
      case "--goal":
        options.goal = list(argv[++i], "--goal");
        break;
      case "--unsafe":
        options.unsafe = list(argv[++i], "--unsafe");
        break;
      case "--require": {
        const names = list(argv[++i], "--require");
        options.require = names.map((name) => {
          const key = ALIASES[name];
          if (!key) {
            throw new UsageError(`unknown property "${name}" \u2014 expected one of: ${Object.keys(ALIASES).join(", ")}`);
          }
          return key;
        });
        break;
      }
      default:
        if (arg.startsWith("--")) throw new UsageError(`unknown option ${arg}`);
        if (options.file) throw new UsageError("only one input file is accepted");
        options.file = arg;
    }
  }
  return options;
}
async function readInput(file) {
  if (file && file !== "-") return readFile(file, "utf8");
  if (process.stdin.isTTY) throw new UsageError("no input \u2014 pass a file, or pipe a graph on stdin");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = await readInput(options.file);
  const parsed = parseGraph(input, {
    ...options.adapter ? { adapter: options.adapter } : {},
    ...options.entry ? { entry: options.entry } : {},
    ...options.goal ? { goal: options.goal } : {},
    ...options.unsafe ? { unsafe: options.unsafe } : {}
  });
  if (parsed.missing.length > 0) {
    process.stderr.write(
      `sinkstate: the ${parsed.adapter} adapter could not determine everything it needs:
` + parsed.missing.map((m) => `  - ${m}
`).join("") + `
Pass them explicitly, e.g. --entry start --goal done
`
    );
    return 2;
  }
  const analysis = analyze(parsed.graph);
  if (options.mermaid) {
    process.stdout.write(`${toMermaid(parsed.graph, analysis)}
`);
    return exitCode(analysis, options.require);
  }
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          adapter: parsed.adapter,
          inferred: parsed.inferred,
          note: STATIC_ANALYSIS_NOTE,
          ...analysis
        },
        null,
        2
      )}
`
    );
    return exitCode(analysis, options.require);
  }
  for (const note of parsed.inferred) {
    process.stderr.write(`sinkstate: ${note}
`);
  }
  if (parsed.inferred.length) process.stderr.write("\n");
  process.stdout.write(`${formatText(analysis, { color: options.color })}
`);
  const failed = options.require.filter((key) => analysis[key].verdict === "fail");
  if (failed.length) {
    process.stderr.write(
      `
sinkstate: required ${failed.length === 1 ? "property" : "properties"} failed: ${failed.map((k) => PROPERTY_LABELS[k]).join(", ")}
`
    );
  }
  return exitCode(analysis, options.require);
}
main().then((code) => process.exit(code)).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`sinkstate: ${message}
`);
  process.exit(err instanceof UsageError ? 2 : 2);
});
