// Measure Noodle's hearing on the local corpus (design section 26; PLAN.md checkpoint 2): how often
// any parse exists, how much of each message the best cover reads, how many tokens are known, and
// the chart's size and speed. Development data only; nothing here tunes anything.
//   node scripts/measure.mjs [--group real|napkin|...] [--limit N] [--max-tokens N] [--json]
// Needs a build first (pnpm build). Prints aggregates and ids, never the messages themselves.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const root = join(import.meta.dirname, "..", "dist", "runtime");
const { seededStore } = await import(join(root, "seed.js"));
const { hear, segmentations } = await import(join(root, "hear.js"));
const { Chart } = await import(join(root, "chart.js"));
const { Weights } = await import(join(root, "score.js"));

const args = process.argv.slice(2);
const value = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const group = value("--group");
const limit = Number(value("--limit") ?? Infinity);
const maxTokens = Number(value("--max-tokens") ?? 60);

const dir = join(homedir(), ".napkin/corpus/tests");
const cases = readFileSync(join(dir, "cases.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((c) => !group || c.group === group)
  .slice(0, limit);

const store = seededStore();
const weights = new Weights(store);
const rows = [];
for (const c of cases) {
  const t0 = performance.now();
  const h = hear(store, c.text);
  if (h.tokens.length > maxTokens) {
    rows.push({ id: c.id, group: c.group, tokens: h.tokens.length, skippedLong: true });
    continue;
  }
  const known = h.candidates.filter((cs) => cs.some((x) => x.source !== "Unknown")).length;
  let edges = 0;
  let covered = 0;
  let full = true;
  let segments = 0;
  for (const [a, b] of segmentations(store, h)[0]) {
    const ch = new Chart(store, h, a, b, weights.get).build();
    for (let i = a; i < b; i++) for (let j = i + 1; j <= b; j++) edges += ch.edges(i, j).length;
    const best = ch.covers()[0];
    segments++;
    if (!best || best.edges.length !== 1 || best.skipped.length) full = false;
    if (best) covered += b - a - best.skipped.length;
  }
  rows.push({ id: c.id, group: c.group, tokens: h.tokens.length, known, covered, full, segments, edges, ms: performance.now() - t0 });
}

const measured = rows.filter((r) => !r.skippedLong);
const sum = (f) => measured.reduce((n, r) => n + f(r), 0);
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const report = {
  cases: rows.length,
  measured: measured.length,
  tooLong: rows.length - measured.length,
  knownTokens: pct(sum((r) => r.known) / Math.max(1, sum((r) => r.tokens))),
  coveredTokens: pct(sum((r) => r.covered) / Math.max(1, sum((r) => r.tokens))),
  fullParse: pct(measured.filter((r) => r.full).length / Math.max(1, measured.length)),
  medianMs: median(measured.map((r) => r.ms)).toFixed(1),
  p95Ms: [...measured.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(measured.length * 0.95)]?.toFixed(1),
  medianEdges: median(measured.map((r) => r.edges)),
};
if (args.includes("--json")) console.log(JSON.stringify({ report, rows }));
else for (const [k, v] of Object.entries(report)) console.log(`${k.padEnd(14)} ${v}`);
