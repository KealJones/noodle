// Score today's Napkin against the local test corpus (~/.napkin/corpus/tests). One adapter, not
// the definition of correct: the corpus is implementation-neutral (see its README.md).
//   node scripts/corpus.mjs [--group real|napkin|bench|files|explain|callouts] [--limit N]
//                           [--id ID] [--json] [--offline] [--timeout MS]
// Needs a build first (pnpm build). Learning is off; each case is heard in a fresh conversation
// in one freshly seeded store, the way the studio records turns.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// Copied from Napkin as the first adapter: until Noodle has a runtime, it scores Napkin's build
// (the baseline, PLAN.md phase 1). Point NAPKIN_DIST at a built packages/concept-runtime/dist.
const DIST = process.env.NAPKIN_DIST ?? join(homedir(), "Git/Personal/napkin/packages/concept-runtime/dist");
const { ConceptStore } = await import(join(DIST, "store/store.js"));
const { seed } = await import(join(DIST, "seed/seed.js"));
const { Runtime } = await import(join(DIST, "runtime/evaluator.js"));
const { turn } = await import(join(DIST, "runtime/turn.js"));
const { ConversationRepository } = await import(join(DIST, "memory/conversations.js"));
const { c, format } = await import(join(DIST, "concept/expression.js"));

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const dir = join(homedir(), ".napkin/corpus/tests");
const jsonl = (f) =>
  readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

// Structural view of an expression string: its heads and parent>child head pairs. Read from the
// text, so an analyst's sketch that does not parse still scores.
function shape(text) {
  const heads = new Set();
  const pairs = new Set();
  const stack = [];
  const re = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|([A-Z][A-Za-z0-9_]*)\s*\(|(\()|(\))/g;
  for (let m; (m = re.exec(text ?? "")); ) {
    if (m[1]) {
      heads.add(m[1]);
      if (stack.length && stack[stack.length - 1]) pairs.add(`${stack[stack.length - 1]}>${m[1]}`);
      stack.push(m[1]);
    } else if (m[2]) stack.push(null);
    else if (m[3]) stack.pop();
  }
  return { heads, pairs };
}
const dice = (a, b) => {
  if (!a.size && !b.size) return 1;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return (2 * n) / (a.size + b.size);
};
export function similarity(heard, sketch) {
  const h = shape(heard);
  const s = shape(sketch);
  return (dice(h.heads, s.heads) + dice(h.pairs, s.pairs)) / 2;
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9.\- ]+/g, " ").replace(/\s+/g, " ").trim();
function answered(kind, gold, said) {
  const g = norm(gold);
  const s = norm(said);
  if (!s) return false;
  if (kind === "option") return new RegExp(`(^|\\s)${g}(\\s|$)`).test(s.split(" ").slice(0, 3).join(" "));
  if (kind === "yesno") return s.split(" ")[0] === g;
  if (kind === "number") return (String(said).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/g) ?? []).some((n) => Number(n) === Number(String(gold).replace(/,/g, "")));
  return s === g || s.includes(g);
}

let cases = jsonl("cases.jsonl");
if (value("--group")) cases = cases.filter((x) => x.group === value("--group"));
if (value("--id")) cases = cases.filter((x) => String(x.id) === value("--id"));
const offline = flag("--offline");
const skipped = offline ? cases.filter((x) => x.needsWorld) : [];
if (offline) cases = cases.filter((x) => !x.needsWorld);
if (value("--limit")) cases = cases.slice(0, Number(value("--limit")));
const chosen = new Set(cases.map((x) => x.id));
const paraphrases = jsonl("paraphrases.jsonl").filter((p) => chosen.has(p.of));

const store = new ConceptStore();
seed(store);
const conversations = new ConversationRepository(store);
const limit = Number(value("--timeout") ?? 20000);

async function hearTurn(text) {
  const { id } = conversations.create(false);
  const runtime = new Runtime(store);
  const heard = conversations.receive();
  runtime.trace.said(heard.seq);
  let timer;
  const t = await Promise.race([
    turn(runtime, text, c("Execution"), { learn: false, research: !offline, conversation: id }),
    new Promise((_, no) => (timer = setTimeout(() => no(new Error(`timeout ${limit}ms`)), limit))),
  ]).finally(() => clearTimeout(timer));
  return {
    heard: t.parsed ?? (t.heard.expression ? format(t.heard.expression) : ""),
    spoken: t.spoken ?? "",
    rendered: t.rendered ?? "",
    problems: t.heard.problems,
  };
}

const results = [];
const byId = new Map();
for (const k of cases) {
  const r = { id: k.id, group: k.group, source: k.source, text: k.text };
  try {
    Object.assign(r, await hearTurn(k.text));
    if (k.expect.readingSketch) r.readingSim = +similarity(r.heard, k.expect.readingSketch).toFixed(3);
    if (k.checks.includes("answer")) r.answerOk = answered(k.expect.answerKind, k.expect.answer, r.spoken || r.rendered);
  } catch (e) {
    r.error = String(e?.message ?? e);
  }
  results.push(r);
  byId.set(k.id, r);
}
const paraResults = [];
for (const p of paraphrases) {
  const orig = byId.get(p.of);
  const r = { id: p.id, of: p.of, style: p.style, text: p.text };
  try {
    Object.assign(r, await hearTurn(p.text));
    if (orig && !orig.error) {
      r.agree = r.heard === orig.heard;
      r.sim = +similarity(r.heard, orig.heard).toFixed(3);
    }
  } catch (e) {
    r.error = String(e?.message ?? e);
  }
  paraResults.push(r);
}

const mean = (xs) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) : null);
const summary = {};
for (const g of [...new Set(results.map((r) => r.group))]) {
  const rs = results.filter((r) => r.group === g);
  const ps = paraResults.filter((p) => byId.get(p.of)?.group === g && p.agree !== undefined);
  const ans = rs.filter((r) => r.answerOk !== undefined);
  summary[g] = {
    cases: rs.length,
    errors: rs.filter((r) => r.error).length,
    readingSim: mean(rs.filter((r) => r.readingSim !== undefined).map((r) => r.readingSim)),
    answers: ans.length ? `${ans.filter((r) => r.answerOk).length}/${ans.length}` : "-",
    paraphraseAgree: ps.length ? `${ps.filter((p) => p.agree).length}/${ps.length}` : "-",
    paraphraseSim: mean(ps.map((p) => p.sim)),
  };
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = join(dir, `results-${stamp}.jsonl`);
writeFileSync(out, [...results, ...paraResults].map((r) => JSON.stringify(r)).join("\n") + "\n");
if (flag("--json")) console.log(JSON.stringify({ summary, skippedOffline: skipped.length, results: out }, null, 2));
else {
  console.log(`${"group".padEnd(9)} ${"cases".padStart(5)} ${"err".padStart(4)} ${"readSim".padStart(8)} ${"answers".padStart(9)} ${"paraAgree".padStart(10)} ${"paraSim".padStart(8)}`);
  for (const [g, s] of Object.entries(summary))
    console.log(`${g.padEnd(9)} ${String(s.cases).padStart(5)} ${String(s.errors).padStart(4)} ${String(s.readingSim ?? "-").padStart(8)} ${String(s.answers).padStart(9)} ${String(s.paraphraseAgree).padStart(10)} ${String(s.paraphraseSim ?? "-").padStart(8)}`);
  if (offline) console.log(`(${skipped.length} cases skipped: need the network)`);
  console.log(`results: ${out}`);
}
process.exit(0);
