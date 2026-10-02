// Rule lints (testing.md section 2.3): tests over the repository's own source, so the AGENTS.md
// rules are enforced by more than review. Runtime code is src/runtime, primitives aside (they may
// name the structures they return and must touch the world).

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { test } from "node:test";
import { STRUCTURAL_NAMES } from "./structural.js";

const SRC = join(import.meta.dirname, "..", "src");

function files(dir: string, keep: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, keep));
    else if (name.endsWith(".ts") && keep(p)) out.push(p);
  }
  return out;
}

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// Know's source adapters are, with the primitives, the code that touches the world (runtime.md 14):
// they fetch, and they read the formats sources answer in (HTML), so they are not runtime code here.
const KNOW_SOURCES = join("runtime", "know", "sources.ts");
const runtime = files(join(SRC, "runtime"), (p) => !p.endsWith(".test.ts") && !p.includes(`${join("runtime", "primitives")}`) && !p.endsWith(KNOW_SOURCES));
const everything = files(SRC, () => true);

test("runtime code names no concept outside the structural list", () => {
  const bad: string[] = [];
  for (const f of runtime)
    for (const m of code(f).matchAll(/"([A-Z][a-z][A-Za-z0-9]*)"/g))
      if (!STRUCTURAL_NAMES.has(m[1])) bad.push(`${relative(SRC, f)}: ${m[1]}`);
  assert.deepEqual(bad, []);
});

test("no word lists in runtime code", () => {
  const bad: string[] = [];
  for (const f of runtime) {
    const src = code(f);
    // An array, Set or Map literal with three or more strings that are all lowercase words.
    for (const m of src.matchAll(/(?:[=(,]|return)\s*\[([^\][]*)\]/g)) {
      // Only a literal made of strings alone: objects and calls inside are not a list of words.
      if (!/^\s*"[^"]*"(\s*,\s*"[^"]*")*\s*,?\s*$/.test(m[1])) continue;
      const strings = [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
      if (strings.length >= 3 && strings.every((x) => /^[a-z][a-z' ]*$/.test(x))) bad.push(`${relative(SRC, f)}: [${strings.join(", ")}]`);
    }
    // A regular expression that alternates over words.
    for (const m of src.matchAll(/\/((?:[^/\\\n]|\\.)+)\/[gimsuy]*/g))
      if (/(?:^|\()[a-z]{2,}(?:\|[a-z]{2,}){2,}/.test(m[1])) bad.push(`${relative(SRC, f)}: /${m[1]}/`);
  }
  assert.deepEqual(bad, []);
});

// Modules that may reach the world, with the reason each is allowed.
const WORLD_ACCESS: Record<string, string> = {
  "seed.ts": "loads the seed's own files at startup, before any turn",
  "check.ts": "the seed checks read the seed's files",
  "count.ts": "prints the seed counts",
  "store.ts": "the store is SQLite (node:sqlite), the record itself, not the world",
};

test("only primitives touch the world from runtime code", () => {
  const bad: string[] = [];
  for (const f of [...runtime, ...files(join(SRC, "seed"), (p) => !p.endsWith(".test.ts"))]) {
    if (WORLD_ACCESS[basename(f)] || f.endsWith(KNOW_SOURCES)) continue;
    const src = code(f);
    if (/from "node:(fs|child_process|net|https?|dgram)"/.test(src) || /\bfetch\(/.test(src)) bad.push(`${relative(SRC, f)}: imports world access`);
    if (/Date\.now\(|new Date\(\)|performance\.now\(/.test(src)) bad.push(`${relative(SRC, f)}: reads the clock`);
  }
  assert.deepEqual(bad, []);
});

test("no shell strings anywhere", () => {
  // child_process's exec and execSync take a shell string; RegExp's exec is fine.
  const bad = everything.filter((f) => /shell:\s*true|(?<![.\w])execSync\(|(?<![.\w])exec\(/.test(code(f))).map((f) => relative(SRC, f));
  assert.deepEqual(bad, []);
});
