// Seed checks (docs/specs/testing.md section 2.2): the seed parses, every entry has a seed source,
// every name it uses is declared in the seed or structural, the bridge names no domain command,
// and the counts per part. Used by the seed tests and by `pnpm seed:count`.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Call, type Expr, type NconFile, parse } from "../ncon/index.js";
import { STRUCTURAL_NAMES } from "../structural.js";

/** The eight parts, in the order of built-ins.md section 3, with their files. */
export const PARTS = [
  ["core", "core.ncon"],
  ["function-words", "function-words.ncon"],
  ["bridge", "bridge.ncon"],
  ["lexical-rules", "lexical-rules.ncon"],
  ["weights", "weights.ncon"],
  ["policies", "policies.ncon"],
  ["genres", "genres.ncon"],
  ["realizations", "realizations.ncon"],
] as const;

/**
 * The frozen list of the domain's command and subcommand names and aliases (design section 29),
 * as the heads they would encode to. No bridge entry may name one.
 */
export const DOMAIN_COMMANDS = [
  "Commit", "Push", "Pull", "Branch", "Checkout", "Switch", "Merge", "Revert", "Reset", "Stash", "Diff",
  "Status", "Tag", "Fetch", "Clone", "Pr", "PullRequest", "Git",
];

const READING_PARTS = new Set(["on", "pattern", "wants", "becomes", "needs", "effects", "checks", "mode", "direction"]);
const META = new Set(["from", "at", "status", "weight", "id"]);

export interface Part {
  name: string;
  file: string;
  ncon: NconFile;
  /** Top-level forms, the Pack header aside (built-ins.md section 3: an entry is one form). */
  entries: number;
}

export interface Report {
  parts: Part[];
  total: number;
  /** Heads used somewhere in the seed that no seed form declares and that are not structural. */
  undeclared: Map<string, Set<string>>;
  /** Entries whose source is not Seed(<their part>). */
  unsourced: string[];
  /** Domain command names that appear in the bridge. */
  domainInBridge: string[];
}

export function loadSeed(dir: string): Part[] {
  return PARTS.map(([name, file]) => {
    const ncon = parse(readFileSync(join(dir, file), "utf8"));
    return { name, file, ncon, entries: ncon.forms.filter((f) => f.head !== "Pack").length };
  });
}

export function check(dir: string): Report {
  const parts = loadSeed(dir);
  const declared = new Set<string>();
  const used = new Map<string, Set<string>>();
  const unsourced: string[] = [];
  const domainInBridge = new Set<string>();

  const use = (head: string, file: string) => {
    if (!used.has(head)) used.set(head, new Set());
    used.get(head)!.add(file);
  };
  const walk = (e: Expr, file: string, visit: (c: Call) => void) => {
    if (e.kind !== "call") return;
    visit(e);
    for (const a of e.args) {
      if (a.name !== undefined && !META.has(a.name) && !READING_PARTS.has(a.name)) use(roleName(a.name), file);
      walk(a.value, file, visit);
    }
  };

  for (const p of parts) {
    const pack = p.ncon.forms[0];
    const packFrom = pack?.head === "Pack" ? named(pack, "from") : undefined;
    if (!isSeedSource(packFrom, p.name)) unsourced.push(`${p.file}: the Pack's from is not Seed("${p.name}")`);
    for (const form of p.ncon.forms) {
      if (form.head === "Pack") continue;
      const from = named(form, "from");
      if (from !== undefined && !isSeedSource(from, p.name)) unsourced.push(`${p.file}:${form.pos.line}`);
      if (form.head === "Concept" || form.head === "Fact") {
        const subject = form.args[0].value as Call;
        declared.add(subject.head);
      }
      for (const a of form.args) {
        if (a.name !== undefined && META.has(a.name)) continue;
        if (a.name !== undefined && !READING_PARTS.has(a.name)) use(roleName(a.name), p.file);
        walk(a.value, p.file, (c) => {
          use(c.head, p.file);
          if (p.name === "bridge" && DOMAIN_COMMANDS.includes(c.head)) domainInBridge.add(c.head);
        });
      }
    }
  }

  const undeclared = new Map([...used].filter(([h]) => !declared.has(h) && !STRUCTURAL_NAMES.has(h)));
  return {
    parts,
    total: parts.reduce((n, p) => n + p.entries, 0),
    undeclared,
    unsourced,
    domainInBridge: [...domainInBridge],
  };
}

const roleName = (name: string) => name[0].toUpperCase() + name.slice(1);

function named(form: Call, name: string): Expr | undefined {
  return form.args.find((a) => a.name === name)?.value;
}

function isSeedSource(e: Expr | undefined, part: string): boolean {
  return (
    e?.kind === "call" &&
    e.head === "Seed" &&
    e.args.length === 1 &&
    e.args[0].value.kind === "string" &&
    e.args[0].value.value === part
  );
}
