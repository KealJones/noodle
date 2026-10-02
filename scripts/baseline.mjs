// The zero-effort baseline (design section 29; PLAN.md phase 1): command-name match. A prompt's act
// is every learned command whose name appears in it as a word, in order (for a two-level command,
// both words). Same labels, same development side of the split, and the same knowledge Noodle has
// (the commands learned from the man pages), so the two are compared on equal terms.
//   node scripts/baseline.mjs
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dist = join(import.meta.dirname, "..", "dist");
const { packedStore } = await import(join(dist, "assistant", "index.js"));
const { isCall, positional } = await import(join(dist, "runtime", "expr.js"));

const jsonl = (p) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const all = jsonl(join(homedir(), ".napkin", "corpus", "all.jsonl"));
const holdout = new Set(JSON.parse(readFileSync(join(homedir(), ".noodle", "experiment", "split.json"), "utf8")).holdout);
const labels = jsonl(join(homedir(), ".napkin", "corpus", "tests", "labels.jsonl")).filter(
  (l) => typeof l.i === "number" && !holdout.has(l.i) && l.verdict !== "drop" && (l.class === "acts" || l.class === "none") && all[l.i]?.text && all[l.i].text.split(/\s+/).length <= 150,
);

// The learned commands: every reading from a tool's documentation that becomes Run.
const store = packedStore();
const commands = new Map();
for (const f of store.factsWithHead("Usage")) {
  const usage = positional(f.claim)[1];
  if (!isCall(usage)) continue;
  const words = [];
  for (const x of positional(usage)) {
    if (x.kind !== "string") break;
    words.push(x.value);
  }
  if (words.length >= 2) commands.set(words.slice(1).join(" "), { program: words[0], sub: words.slice(1).join("-") });
}

const rows = [];
for (const l of labels) {
  const tokens = all[l.i].text.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
  const got = [];
  for (let i = 0; i < tokens.length; i++)
    for (const [name, act] of commands) {
      const parts = name.split(" ");
      if (parts.every((p, k) => tokens[i + k] === p)) got.push(`${act.program} ${act.sub}`);
    }
  const uniq = [...new Set(got)];
  const want = (l.acts ?? []).map((a) => `${a.program ?? ""} ${a.sub ?? ""}`.trim());
  rows.push({ cls: l.class, want, got: uniq, exact: want.length === uniq.length && want.every((w) => uniq.includes(w)), first: want.length > 0 && uniq[0] === want[0], any: uniq.some((g) => want.includes(g)) });
}
const acts = rows.filter((r) => r.cls === "acts");
const none = rows.filter((r) => r.cls === "none");
const pct = (a, b) => `${b ? ((100 * a) / b).toFixed(1) : "0.0"}% (${a}/${b})`;
console.log(`labelled     ${rows.length}`);
console.log(`actsExact    ${pct(acts.filter((r) => r.exact).length, acts.length)}`);
console.log(`actsFirst    ${pct(acts.filter((r) => r.first).length, acts.length)}`);
console.log(`actsAny      ${pct(acts.filter((r) => r.any).length, acts.length)}`);
console.log(`noneCorrect  ${pct(none.filter((r) => !r.got.length).length, none.length)}`);
console.log(`falseActs    ${pct(none.filter((r) => r.got.length).length, none.length)}`);
