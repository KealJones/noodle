// The week 1 kill test (design section 29; PLAN.md phase 1), run on Keal's hand-written reductions.
//   node scripts/killtest.mjs [file]        (default ~/.noodle/experiment/killtest.ncon)
// The file (format: docs/killtest.md) holds documentation reductions and request reductions. Two
// numbers decide it:
// - representability: the share of reductions written only in the seed's vocabulary (core
//   meanings and structural concepts) plus the glossary terms the file declares. Stop or redesign
//   under 70 percent.
// - convergence: for each request, the documentation reductions ranked by the scored match
//   (runtime.md 6.2); top-1 accuracy against the documentation it should reach. Stop under 60
//   percent.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dist = join(import.meta.dirname, "..", "dist");
const { seededStore } = await import(join(dist, "runtime", "seed.js"));
const { softMatch } = await import(join(dist, "runtime", "softmatch.js"));
const { isCall, positional, walk } = await import(join(dist, "runtime", "expr.js"));
const { STRUCTURAL_NAMES } = await import(join(dist, "structural.js"));
const { parse } = await import(join(dist, "ncon", "index.js"));

const file = process.argv[2] ?? join(homedir(), ".noodle", "experiment", "killtest.ncon");
if (!existsSync(file)) {
  console.error(`no kill test file at ${file}; see docs/killtest.md for its format`);
  process.exit(1);
}
const store = seededStore();
// The closed list: every concept the core part declares (seed/core.ncon).
const coreNames = new Set(
  parse(readFileSync(join(import.meta.dirname, "..", "seed", "core.ncon"), "utf8"))
    .forms.filter((f) => f.head === "Concept")
    .map((f) => f.args[0].value.head),
);
store.load(readFileSync(file, "utf8"));
const glossary = new Set(store.factsWithHead("Glossary").map((f) => f.subject));
const docs = [];
const requests = [];
for (const f of store.factsWithHead("Reduction")) {
  const reduction = positional(f.claim)[0];
  const expects = store.facts(f.subject, "Expects").map((x) => positional(x.claim)[0]);
  if (expects.length) requests.push({ id: f.subject, reduction, expects: isCall(expects[0]) ? expects[0].head : undefined });
  else docs.push({ id: f.subject, reduction });
}

const outside = (e) => [...walk(e)].filter((x) => isCall(x) && !coreNames.has(x.head) && !STRUCTURAL_NAMES.has(x.head) && !glossary.has(x.head)).map((x) => x.head);
const all = [...docs, ...requests];
const expressible = all.filter((r) => outside(r.reduction).length === 0);
console.log(`documentation reductions: ${docs.length}, request reductions: ${requests.length}`);
console.log(`representable: ${expressible.length}/${all.length} (${((100 * expressible.length) / Math.max(1, all.length)).toFixed(1)}%; stop under 70%)`);
for (const r of all) {
  const o = [...new Set(outside(r.reduction))];
  if (o.length) console.log(`  ${r.id}: outside the vocabulary: ${o.join(", ")}`);
}

let right = 0;
for (const q of requests) {
  const ranked = docs
    .map((d) => ({ id: d.id, m: softMatch(store, d.reduction, q.reduction) }))
    .filter((x) => x.m)
    .sort((a, b) => b.m.score - a.m.score);
  const top = ranked[0]?.id;
  if (top && top === q.expects) right++;
  console.log(`  ${q.id}: expects ${q.expects}, top ${top ?? "none"}${ranked[0] ? ` (${ranked[0].m.score.toFixed(2)})` : ""}${top === q.expects ? "" : "  <-- miss"}`);
}
console.log(`convergence (top-1): ${right}/${requests.length} (${((100 * right) / Math.max(1, requests.length)).toFixed(1)}%; stop under 60%)`);
