// Score Noodle's acts against Keal's labels (testing.md section 3; AGENTS.md rule 11), on the
// development side of the split only (~/.noodle/experiment/split.json; never the holdout). Each
// prompt is heard in a fresh session as a dry run: nothing runs, the acts the winner would run (or
// offer) are compared with the label's. Prints aggregates and ids, never the prompts.
//   node scripts/acts.mjs [--limit N] [--json]
import { mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const dist = join(import.meta.dirname, "..", "dist");
const { packedStore, createSession } = await import(join(dist, "assistant", "index.js"));
const { isCall, positional } = await import(join(dist, "runtime", "expr.js"));

const args = process.argv.slice(2);
const limit = Number(args.includes("--limit") ? args[args.indexOf("--limit") + 1] : Infinity);
// Very long prompts (pasted logs, documents) are reported as too long rather than heard: the chart
// is cubic in a segment's length, and these are measured separately (pnpm measure).
const maxWords = Number(args.includes("--max-words") ? args[args.indexOf("--max-words") + 1] : 150);
const jsonl = (p) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const all = jsonl(join(homedir(), ".napkin", "corpus", "all.jsonl"));
const split = JSON.parse(readFileSync(join(homedir(), ".noodle", "experiment", "split.json"), "utf8"));
const holdout = new Set(split.holdout);
const labels = jsonl(join(homedir(), ".napkin", "corpus", "tests", "labels.jsonl"))
  .filter((l) => typeof l.i === "number" && !holdout.has(l.i) && l.verdict !== "drop" && (l.class === "acts" || l.class === "none"))
  .slice(0, limit);

const store = packedStore();
const root = mkdtempSync(join(tmpdir(), "noodle-acts-"));

/** An act as the labels name it: a program and subcommand, or a primitive's own name. */
function named(act) {
  if (!isCall(act)) return undefined;
  if (act.head === "Run") {
    const [program, a] = positional(act);
    const sub = isCall(a) ? positional(a)[0] : undefined;
    return { program: program?.value, sub: sub?.kind === "string" ? sub.value : undefined };
  }
  if (act.head === "Read") return { sub: "read" };
  if (act.head === "Write" || act.head === "Edit") return { sub: "edit" };
  return { sub: act.head.toLowerCase() };
}
const k = (a) => `${a.program ?? ""} ${a.sub ?? ""}`.trim();

const rows = [];
for (const l of labels) {
  const text = all[l.i]?.text;
  if (!text) continue;
  if (text.split(/\s+/).length > maxWords) {
    rows.push({ i: l.i, cls: l.class, tooLong: true });
    continue;
  }
  const s = createSession(store, root);
  let acts = [];
  const t0 = performance.now();
  try {
    acts = (await s.turn(text, { dry: true })).acts.map(named).filter(Boolean);
    const ms = performance.now() - t0;
    if (args.includes("--progress")) console.error(`${l.i}\t${text.split(/\s+/).length}w\t${ms.toFixed(0)}ms`);
  } catch (e) {
    rows.push({ i: l.i, cls: l.class, error: String(e).slice(0, 80) });
    continue;
  }
  const want = (l.acts ?? []).map(k).filter(Boolean);
  const got = [...new Set(acts.map(k))];
  rows.push({ i: l.i, cls: l.class, want, got, exact: want.length === got.length && want.every((w) => got.includes(w)), first: want.length > 0 && got[0] === want[0], any: got.some((g) => want.includes(g)) });
}

const of = (f) => rows.filter(f).length;
const actsRows = rows.filter((r) => r.cls === "acts" && !r.error && !r.tooLong);
const noneRows = rows.filter((r) => r.cls === "none" && !r.error && !r.tooLong);
const pct = (a, b) => `${b ? ((100 * a) / b).toFixed(1) : "0.0"}% (${a}/${b})`;
const report = {
  labelled: rows.length,
  errors: of((r) => r.error),
  tooLong: of((r) => r.tooLong),
  actsExact: pct(actsRows.filter((r) => r.exact).length, actsRows.length),
  actsFirst: pct(actsRows.filter((r) => r.first).length, actsRows.length),
  actsAny: pct(actsRows.filter((r) => r.any).length, actsRows.length),
  noneCorrect: pct(noneRows.filter((r) => r.got.length === 0).length, noneRows.length),
  falseActs: pct(noneRows.filter((r) => r.got.length > 0).length, noneRows.length),
};
if (args.includes("--json")) console.log(JSON.stringify({ report, rows }));
else {
  for (const [key, v] of Object.entries(report)) console.log(`${key.padEnd(12)} ${v}`);
  const confusion = new Map();
  for (const r of actsRows) {
    const key2 = `${r.want.join("+") || "-"} -> ${r.got.join("+") || "-"}`;
    confusion.set(key2, (confusion.get(key2) ?? 0) + 1);
  }
  console.log("\nmost common (wanted -> got):");
  for (const [key2, n] of [...confusion].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${key2}`);
}
