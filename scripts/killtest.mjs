// The kill test (design section 29; PLAN.md phases 1 and 4).
//   node scripts/killtest.mjs [file]        (default ~/.noodle/experiment/killtest.ncon)
//
// Always: stage 0's parse line. The in-domain development prompts (labelled acts or constraint, on
// the development side of ~/.noodle/experiment/split.json, never the holdout) are heard with
// everything imported; a prompt has a full parse when each segment's best cover is one edge with
// nothing skipped, and a near-full parse when at least 70 percent of its content words are inside
// the widest edge of each segment's best cover (one connected reading per segment: words read as
// fragments of their own do not count, or a cover of single-word edges would pass). Coverage by
// any edge of the cover is printed beside it, for comparison. A content word is a word token none of whose candidates is a concept
// of the seed's function-word lexicon (seed/function-words.ncon). Stop under 60 percent.
//
// With Keal's file (format: docs/killtest.md) of documentation reductions and request reductions,
// two more numbers:
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

const { packedStore } = await import(join(dist, "assistant", "index.js"));
const { hear, segmentations } = await import(join(dist, "runtime", "hear.js"));
const { Chart } = await import(join(dist, "runtime", "chart.js"));
const { Weights } = await import(join(dist, "runtime", "score.js"));

// ---- stage 0's parse line
{
  const jsonl = (p) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const corpus = jsonl(join(homedir(), ".napkin", "corpus", "all.jsonl"));
  const holdout = new Set(JSON.parse(readFileSync(join(homedir(), ".noodle", "experiment", "split.json"), "utf8")).holdout);
  const prompts = jsonl(join(homedir(), ".napkin", "corpus", "tests", "labels.jsonl")).filter(
    (l) => typeof l.i === "number" && !holdout.has(l.i) && l.verdict !== "drop" && (l.class === "acts" || l.class === "constraint") && corpus[l.i]?.text && !corpus[l.i].text.trimStart().startsWith("<heartbeat>"),
  );
  const functionWords = new Set(
    parse(readFileSync(join(import.meta.dirname, "..", "seed", "function-words.ncon"), "utf8"))
      .forms.filter((f) => f.head === "Concept")
      .map((f) => f.args[0].value.head),
  );
  const packed = packedStore();
  const weights = new Weights(packed);
  const MAX_TOKENS = 60;
  let full = 0;
  let near = 0;
  let nearAny = 0;
  let long = 0;
  let measured = 0;
  for (const l of prompts) {
    const h = hear(packed, corpus[l.i].text);
    if (h.tokens.length > MAX_TOKENS) {
      long++;
      continue;
    }
    measured++;
    const content = h.tokens.map((t, k) => /[\p{L}\p{N}]/u.test(t.text) && !h.candidates[k].some((c) => c.concept && functionWords.has(c.concept)));
    const inEdge = new Array(h.tokens.length).fill(false);
    const inWidest = new Array(h.tokens.length).fill(false);
    let whole = true;
    for (const [a, b] of segmentations(packed, h)[0]) {
      const best = new Chart(packed, h, a, b, weights.get).build().covers()[0];
      if (!best || best.edges.length !== 1 || best.skipped.length) whole = false;
      for (const e of best?.edges ?? []) for (let k = e.start; k < e.end; k++) inEdge[k] = true;
      const widest = [...(best?.edges ?? [])].sort((x, y) => y.end - y.start - (x.end - x.start))[0];
      if (widest) for (let k = widest.start; k < widest.end; k++) inWidest[k] = true;
    }
    const n = content.filter(Boolean).length;
    const covered = content.filter((c, k) => c && inWidest[k]).length;
    const anyEdge = content.filter((c, k) => c && inEdge[k]).length;
    if (whole) full++;
    if (whole || (n > 0 && covered / n >= 0.7)) near++;
    if (whole || (n > 0 && anyEdge / n >= 0.7)) nearAny++;
  }
  const pct = (a, b) => `${a}/${b} (${((100 * a) / Math.max(1, b)).toFixed(1)}%)`;
  console.log(`in-domain development prompts: ${prompts.length}, over ${MAX_TOKENS} tokens: ${long}`);
  console.log(`full parse: ${pct(full, measured)} of those heard`);
  console.log(`full or near-full parse: ${pct(near, measured)} of those heard, ${pct(near, prompts.length)} counting the long ones as failing; stop under 60%`);
  console.log(`  (70% of content words inside any edge of the cover, fragments counted: ${pct(nearAny, measured)})`);
  packed.close();
}

const file = process.argv[2] ?? join(homedir(), ".noodle", "experiment", "killtest.ncon");
if (!existsSync(file)) {
  console.log(`\nno kill test file at ${file} (Keal's hand-written reductions; format in docs/killtest.md): representability and convergence not run`);
  process.exit(0);
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
