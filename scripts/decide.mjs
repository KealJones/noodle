#!/usr/bin/env node
// `pnpm decide` (PLAN.md phase 6; design section 29; testing.md sections 5 to 9): the deciding run.
// It scores the frozen system's arms (A, A+ zero-shot, A+ trained) on the confirmatory set (fresh
// captured prompts labelled blind with pnpm label after the freeze; never the development corpus),
// on end state for real requests, with the no-name set (Keal's blind paraphrases and the real
// no-name requests) reported beside, and applies the go and stop rules exactly as frozen from
// design section 29, quoting them.
//   pnpm decide [--frozen ID] [--resamples N]
//
// It refuses to run, saying why, if: no frozen system is named or the system here differs from its
// manifest (NOODLE_FROZEN=<id> runs the frozen one; check out the frozen commit to decide); the
// pilot has not set n; the confirmatory set has fewer than n real requests (it says how many more);
// or a baseline the go rule compares against is missing (scripts/baselines/).
//
// End state is what the act would do, checked in Suppose (a dry run): nothing effectful runs, and
// each item runs in a sandbox restored from its fixture (a clone into a temporary directory, its
// remotes pointed at empty local bare repositories), never in Keal's repositories.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { captures } from "./label.mjs";

const dist = join(import.meta.dirname, "..", "dist");
const { isCall, positional, role } = await import(join(dist, "runtime", "expr.js"));

const jsonl = (p) =>
  existsSync(p)
    ? readFileSync(p, "utf8").split("\n").filter(Boolean).flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      })
    : [];

// ---------------------------------------------------------------------------------------------
// The confirmatory set

/**
 * The confirmatory items: gold lines (the latest per id) for prompts captured after the freeze and
 * labelled after they were captured. `real` are requests (acts and constraints), `negative` the
 * prompts that are not git acts (the false-act rate).
 */
export function confirmatory(gold, caps, frozenAt) {
  const at = new Map(caps.map((c) => [c.id, c]));
  const latest = new Map();
  for (const g of gold) latest.set(g.id, g);
  const items = [...latest.values()].flatMap((g) => {
    const cap = at.get(g.id);
    if (!cap || !(cap.at > frozenAt) || !(g.labelledAt > cap.at)) return [];
    return [{ ...g, capturedAt: cap.at, conversation: cap.sessionId ?? g.id }];
  });
  return { real: items.filter((g) => g.class === "acts" || g.class === "constraint"), negative: items.filter((g) => g.class === "none") };
}

/** Every reason decide may not run; empty when it may. */
export function refusals({ manifest, differences = [], real = 0, baselines = [] }) {
  const out = [];
  if (!manifest) out.push("no frozen system: run pnpm freeze (after the pilot), then pnpm decide --frozen <id>");
  for (const d of differences) out.push(`the system here differs from the frozen manifest: ${d}`);
  const n = manifest?.preregistered?.n;
  if (!n) out.push(`n is not set: the pilot (stage 1) writes n, the margin and alpha to pilot.json, and the system is frozen after it (the design's estimate is on the order of 170). ${real} real requests are in the confirmatory set so far.`);
  if (n && real < n) out.push(`n is not reached: ${real} of ${n} real requests in the confirmatory set; ${n - real} more needed`);
  if (!baselines.some((b) => b.role === "name-match")) out.push("no command-name match baseline with the slot filler (scripts/baselines/, role name-match)");
  if (!baselines.some((b) => b.role === "trained")) out.push("no trained classifier baseline with the slot filler (scripts/baselines/, role trained)");
  return out;
}

// ---------------------------------------------------------------------------------------------
// Acts, the gold and the mapping (freeze.mjs MAPPING)

/** A system act as the scorer sees it: program, and its argument list (or the file of Read/Edit). */
export function sysAct(e) {
  if (!isCall(e)) return { head: "?", argv: [] };
  const str = (x) => (x?.kind === "string" ? x.value : x?.kind === "number" ? String(x.value) : isCall(x) && x.head === "Joined" ? positional(x).map(str).join("") : `<${isCall(x) ? x.head : "?"}>`);
  if (e.head === "Run") {
    const [program, args] = positional(e);
    return { program: str(program), argv: isCall(args) ? positional(args).map(str) : [] };
  }
  const files = positional(e).map(str);
  if (e.head === "Read") return { sub: "read", argv: [], files };
  if (e.head === "Write" || e.head === "Edit") return { sub: "edit", argv: [], files };
  return { sub: e.head.toLowerCase(), argv: [] };
}

const MESSAGE_FLAGS = new Set(["-m", "--message"]);
const GOLD_KEYS = new Set(["program", "sub", "flags", "files", "message", "outsideActSet"]);
const tidy = (t) => normalize(String(t)).replace(/\/$/, "");

/** The system act's subcommand, as the gold names it (two words joined by a dash where it does). */
function subOf(gold, s) {
  if (!s.program) return { sub: s.sub, rest: s.argv };
  const [a, b, ...more] = s.argv;
  if (gold.sub?.includes("-") && b !== undefined && `${a}-${b}` === gold.sub) return { sub: gold.sub, rest: more };
  return { sub: a, rest: s.argv.slice(1) };
}

/** Whether the act labels agree (metric a). */
export function sameLabel(gold, s) {
  return (gold.program ?? undefined) === (s.program ?? undefined) && subOf(gold, s).sub === gold.sub;
}

/** Whether a system act does what the gold act does (metric b, by the mapping). */
export function sameAct(gold, s, defaults = {}) {
  if (!sameLabel(gold, s)) return { ok: false };
  if (gold.program === "gh" && gold.sub?.startsWith("pr")) return { ok: true, labelOnly: true };
  let { rest } = subOf(gold, s);
  let message;
  const args = [];
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (MESSAGE_FLAGS.has(t)) message = rest[++i] ?? "";
    else if (t.startsWith("--message=")) message = t.slice("--message=".length);
    else args.push(t);
  }
  // Typed values (testing.md 5.1): paths, branches, refs, remotes and urls as strings, numbers as written.
  const want = [...(gold.flags ?? []), ...(gold.files ?? []), ...Object.entries(gold).filter(([k, v]) => !GOLD_KEYS.has(k) && (typeof v === "string" || typeof v === "number")).map(([, v]) => String(v))];
  const optional = new Set([defaults.branch, ...(defaults.remotes ?? [])].filter(Boolean));
  const bag = (xs) => xs.map(tidy).filter((x) => !optional.has(x)).sort();
  const files = s.files ?? [];
  const got = [...args, ...files];
  // A message the request dictated is that message; any other passes its constraints (unchecked here).
  const said = !gold.message || (message !== undefined && (gold.message.text === undefined || message.trim() === gold.message.text.trim()));
  const ok = JSON.stringify(bag(want)) === JSON.stringify(bag(got)) && said;
  return { ok, unchecked: gold.message?.constraints?.length ? gold.message.constraints : undefined };
}

function matchActs(goldActs, sys, cmp, any) {
  if (goldActs.length !== sys.length) return false;
  if (!any) return goldActs.every((g, i) => cmp(g, sys[i]));
  const used = new Set();
  return goldActs.every((g) => {
    const k = sys.findIndex((s, i) => !used.has(i) && cmp(g, s));
    return k >= 0 && used.add(k);
  });
}

/** The rules the turn would store, from its echoes: { rule, act, until }. */
export function storedRules(said) {
  const out = [];
  for (const e of said ?? []) {
    const c = isCall(e) && e.head === "Echo" ? positional(e)[0] : undefined;
    if (!isCall(c) || c.head !== "Constraint") continue;
    const rule = positional(c)[0];
    if (!isCall(rule)) continue;
    out.push({ rule: rule.head.toLowerCase(), act: sysAct(positional(rule)[0]), until: role(c, "until") !== undefined });
  }
  return out;
}

/** One item, both metrics: { label, end } and what the mapping could not check. */
export function scoreItem(gold, heard, defaults = {}) {
  const any = gold.order === "any";
  const goldActs = gold.acts ?? [];
  const sys = heard.acts ?? [];
  const unchecked = [];
  const rulesOk = (gold.constraints ?? []).every((g) =>
    storedRules(heard.said).some((r) => r.rule === g.rule && sameLabel(g.act, r.act) && r.until === Boolean(g.until)),
  );
  const label = matchActs(goldActs, sys, sameLabel, any) && rulesOk;
  const end =
    matchActs(goldActs, sys, (g, s) => {
      const r = sameAct(g, s, defaults);
      if (r.ok && r.unchecked) unchecked.push(...r.unchecked);
      return r.ok;
    }, any) && rulesOk;
  return { label, end, unchecked };
}

/** A fixture's defaults: its current branch and the remotes a push or pull may leave out. */
export function defaultsOf(meta) {
  const remotes = Object.keys(meta?.repo?.remotes ?? {});
  return { branch: meta?.repo?.branch ?? undefined, remotes: remotes.length === 1 ? remotes : remotes.filter((r) => r === "origin") };
}

/** Of the readings that won, the share of words they used. */
export function coverage(record) {
  let used = 0;
  let skipped = 0;
  for (const r of record?.reasons ?? []) {
    if (!String(r.what).startsWith("reading of")) continue;
    for (const [k, v] of r.candidates[r.winner]?.features ?? []) {
      if (k === "WordsUsed") used += v;
      else if (k.startsWith("WordsUsed:Skipped:")) skipped -= v;
    }
  }
  return used + skipped ? used / (used + skipped) : 0;
}

/** How sure the winner was: its score's lead over the runner-up, summed over segments. */
export function confidence(record) {
  let lead = 0;
  for (const r of record?.reasons ?? []) {
    if (!String(r.what).startsWith("reading of")) continue;
    const s = r.candidates.map((c) => c.score);
    lead += s.length > 1 ? s[r.winner] - Math.max(...s.filter((_, i) => i !== r.winner)) : 10;
  }
  return lead;
}

// ---------------------------------------------------------------------------------------------
// Statistics (testing.md section 7)

export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

function lgamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let s = 1.000000000190015;
  for (const c of g) s += c / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}

/** One-sided exact binomial test: P(X >= k) when the rate is p0. */
export function binomialP(k, n, p0) {
  let p = 0;
  for (let i = k; i <= n; i++) p += Math.exp(lgamma(n + 1) - lgamma(i + 1) - lgamma(n - i + 1) + i * Math.log(p0) + (n - i) * Math.log(1 - p0));
  return Math.min(1, p);
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paired bootstrap of the difference in accuracy (a minus b), resampling conversations. */
export function bootstrap(a, b, clusters, resamples = 10000, seed = 29) {
  const groups = new Map();
  clusters.forEach((c, i) => groups.set(c, [...(groups.get(c) ?? []), i]));
  const keys = [...groups.keys()];
  const next = rng(seed);
  const diffs = [];
  for (let r = 0; r < resamples; r++) {
    let n = 0;
    let d = 0;
    for (let j = 0; j < keys.length; j++) {
      for (const i of groups.get(keys[Math.floor(next() * keys.length)])) {
        n++;
        d += Number(a[i]) - Number(b[i]);
      }
    }
    diffs.push(n ? d / n : 0);
  }
  return diffs;
}

/** Holm's step-down: which of the p values are rejected at family-wise alpha. */
export function holm(ps, alpha) {
  const order = ps.map((p, i) => [p, i]).sort((x, y) => x[0] - y[0]);
  const out = ps.map(() => false);
  for (let r = 0; r < order.length; r++) {
    if (order[r][0] > alpha / (order.length - r)) break;
    out[order[r][1]] = true;
  }
  return out;
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + Number(x), 0) / xs.length : 0);

/**
 * The go rule of design section 29, as frozen, on per-item end-state correctness of the confirmatory
 * real requests: A+ trained against the floor (exact binomial), against command-name match with the
 * slot filler (superiority by the margin, paired bootstrap by conversation) and against the best
 * trained classifier with the slot filler (non-inferiority at the margin, the lower test of TOST);
 * the three tests corrected by Holm; and the wins mostly (over half) from parses covering at least
 * 70 percent of their words. Stop is everything else.
 */
export function applyRules({ trained, nameMatch, trainedBaselines, coverage: cov, clusters, prereg, resamples = 10000 }) {
  const n = trained.length;
  const k = trained.filter(Boolean).length;
  const [bestName, best] = Object.entries(trainedBaselines).sort((x, y) => mean(y[1]) - mean(x[1]))[0];
  const sup = bootstrap(trained, nameMatch, clusters, resamples);
  const non = bootstrap(trained, best, clusters, resamples);
  const tests = [
    { name: `end state at least the floor (${prereg.floor})`, estimate: k / n, p: binomialP(k, n, prereg.floor) },
    { name: `better than command-name match with the slot filler by the margin (${prereg.margin})`, estimate: mean(trained) - mean(nameMatch), p: sup.filter((d) => d <= prereg.margin).length / sup.length },
    { name: `not worse than the best trained classifier with the slot filler (${bestName}) by more than the margin`, estimate: mean(trained) - mean(best), p: non.filter((d) => d <= -prereg.margin).length / non.length },
  ];
  holm(tests.map((t) => t.p), prereg.alpha).forEach((r, i) => (tests[i].passed = r));
  const wins = trained.map((t, i) => (t ? cov[i] : undefined)).filter((x) => x !== undefined);
  const understood = wins.length ? wins.filter((c) => c >= 0.7).length / wins.length : 0;
  const mostly = { name: "wins mostly from parses covering at least 70 percent of their words", estimate: understood, passed: understood > 0.5 };
  return { go: tests.every((t) => t.passed) && mostly.passed, tests: [...tests, mostly] };
}

/** Risk against coverage: the accuracy of the most confident share of the items, by deciles. */
export function riskCoverage(right, conf) {
  const order = conf.map((c, i) => [c, i]).sort((a, b) => b[0] - a[0]);
  return [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((share) => {
    const top = order.slice(0, Math.max(1, Math.round(share * order.length)));
    return { coverage: share, accuracy: mean(top.map(([, i]) => right[i])) };
  });
}

// ---------------------------------------------------------------------------------------------
// The sandbox (testing.md section 5.2)

/**
 * Restores a fixture into a fresh temporary directory: a clone of the repository at the captured
 * commit with the uncommitted work and untracked files, remotes pointed at empty local bare
 * repositories, HOME inside it. Keal's repository is only read. Returns the directory, or
 * undefined (with an empty directory made) when the fixture cannot be restored.
 */
export function sandbox(meta, fixtureDir) {
  const dir = mkdtempSync(join(tmpdir(), "noodle-decide-"));
  const repo = meta?.repo;
  const env = { ...process.env, HOME: dir, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "x", GIT_AUTHOR_EMAIL: "x@x", GIT_COMMITTER_NAME: "x", GIT_COMMITTER_EMAIL: "x@x" };
  const git = (cwd, ...a) => execFileSync("git", a, { cwd, env, stdio: ["ignore", "pipe", "ignore"], timeout: 120000 });
  const work = join(dir, "work");
  try {
    if (!repo?.head || !repo.parentRepo || !existsSync(repo.parentRepo)) throw new Error("no repository");
    git(dir, "clone", "--quiet", "--no-hardlinks", "--no-checkout", repo.parentRepo, work);
    git(work, "fetch", "--quiet", repo.parentRepo, `+refs/noodle/capture/${meta.id}/*:refs/noodle/*`);
    git(work, "checkout", "--quiet", "-B", repo.branch ?? "fixture", repo.head);
    if (repo.pins?.work) git(work, "stash", "apply", "--index", "--quiet", "refs/noodle/work");
    for (const name of Object.keys(repo.remotes ?? {})) {
      const bare = join(dir, "remotes", name);
      mkdirSync(bare, { recursive: true });
      git(bare, "init", "--bare", "--quiet");
      git(work, "remote", "set-url", name, bare);
    }
    if (repo.untracked?.archived) execFileSync("tar", ["-xzf", join(fixtureDir, "untracked.tar.gz"), "-C", work], { timeout: 60000 });
    return { root: work, dir, restored: true };
  } catch {
    mkdirSync(work, { recursive: true });
    return { root: work, dir, restored: false };
  }
}

// ---------------------------------------------------------------------------------------------
// The run

/** The no-name set (design section 29, reported, not deciding): real ones and Keal's paraphrases. */
export function noNameSet(tests) {
  const labels = new Map(jsonl(join(tests, "labels.jsonl")).map((l) => [l.i, l]));
  const real = jsonl(join(tests, "noname-real.jsonl")).filter((x) => x.acts?.length).map((x) => ({ set: "real", text: x.text, acts: x.acts }));
  const para = jsonl(join(tests, "paraphrases-keal.jsonl"))
    .filter((p) => p.verdict === "ok" && labels.get(p.i)?.acts?.length)
    .map((p) => ({ set: "paraphrase", text: p.paraphrase, acts: labels.get(p.i).acts }));
  return [...real, ...para];
}

/** The no-name labels name the acts, repeated or not, in any order: the same set of act labels. */
export const sameLabels = (gold, sys) => gold.every((g) => sys.some((s) => sameLabel(g, s))) && sys.every((s) => gold.some((g) => sameLabel(g, s)));

/** The arms, and the variant with Keal's stage-0 confirmations reported beside them. */
export const ARM_NAMES = ["A", "A+ zero-shot", "A+ trained", "A+ trained, confirmed"];

/**
 * Every item heard by every arm as a dry run, and predicted by every baseline, each in a sandbox
 * restored from the item's fixture and removed after: one row per item with both metrics.
 */
export async function scoreAll({ sys, items, baselines, root, createSession, inMemory = false }) {
  const rows = [];
  for (const g of items) {
    const fixtureDir = join(root, "fixtures", g.fixture ?? g.id);
    const meta = existsSync(join(fixtureDir, "meta.json")) ? JSON.parse(readFileSync(join(fixtureDir, "meta.json"), "utf8")) : undefined;
    const box = sandbox(meta, fixtureDir);
    const defaults = defaultsOf(meta);
    const row = { id: g.id, class: g.class, namesCommand: g.namesCommand, conversation: g.conversation, labelledAt: g.labelledAt, restored: box.restored, arms: {}, baselines: {} };
    try {
      for (const arm of ARM_NAMES) {
        const trained = arm.startsWith("A+ trained");
        const { store, weights } = sys.arm(trained ? "A+ trained" : arm, inMemory);
        const s = createSession(store, box.root, { tutor: false }, undefined, { weights, confirmed: arm.endsWith("confirmed") ? sys.confirmations() : [] });
        try {
          // Asking is disabled in A and A+ zero-shot, which have no calibration (design section 29).
          const r = await s.turn(g.text, { dry: true, ask: trained });
          const heard = { acts: r.acts.map(sysAct), said: r.record.said };
          row.arms[arm] = { ...scoreItem(g, heard, defaults), acted: heard.acts.length > 0, coverage: coverage(r.record), confidence: confidence(r.record) };
        } catch (e) {
          row.arms[arm] = { label: false, end: false, unchecked: [], acted: false, coverage: 0, confidence: -Infinity, error: String(e).slice(0, 120) };
        }
      }
      for (const b of baselines) {
        const acts = await b.predict({ ...g, meta, root: box.root, turns: jsonl(join(fixtureDir, "turns.jsonl")) });
        row.baselines[b.name] = { ...scoreItem(g, { acts, said: [] }, defaults), acted: acts.length > 0, role: b.role };
      }
    } finally {
      rmSync(box.dir, { recursive: true, force: true });
    }
    rows.push(row);
  }
  return rows;
}

async function loadBaselines(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs")).sort()) out.push((await import(pathToFileURL(join(dir, f)).href)).default);
  return out;
}

function quote(rules) {
  console.log("Pre-registered (design section 29):\n");
  console.log(`  ${rules.go}\n\n  ${rules.stop}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const F = await import(join(dist, "assistant", "frozen.js"));
  const repo = join(import.meta.dirname, "..");
  const root = F.EXPERIMENT;
  const id = opt("--frozen") ?? process.env.NOODLE_FROZEN ?? (existsSync(join(root, "frozen")) && readdirSync(join(root, "frozen")).length === 1 ? readdirSync(join(root, "frozen"))[0] : undefined);
  let manifest;
  let dir;
  let differences = [];
  if (id) {
    try {
      ({ manifest, dir } = F.readManifest(id, root));
      differences = F.differences(manifest, dir);
      const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
      if (head !== manifest.commit) differences.push(`checked out ${head.slice(0, 7)}, frozen ${manifest.commit.slice(0, 7)}`);
      if (execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).trim()) differences.push("the working tree is dirty");
    } catch (e) {
      differences.push(e.message);
    }
  }
  const { quoteRules } = await import("./freeze.mjs");
  const rules = manifest?.rules ?? quoteRules(readFileSync(join(repo, "docs", "design.md"), "utf8"));
  quote(rules);
  if (!manifest) console.log("(quoted from docs/design.md as it is now: nothing is frozen yet)\n");
  const gold = jsonl(join(root, "gold.jsonl"));
  const caps = captures(root);
  const set = confirmatory(gold, caps, manifest?.frozenAt ?? "");
  const baselines = await loadBaselines(join(repo, "scripts", "baselines"));
  const why = refusals({ manifest, differences, real: set.real.length, baselines });
  if (why.length) {
    console.log("Refusing to decide:");
    for (const w of why) console.log(`  - ${w}`);
    console.log(`\nCaptured prompts: ${caps.length}; gold lines: ${gold.length}; confirmatory: ${set.real.length} real requests, ${set.negative.length} negative.`);
    process.exitCode = 1;
    return;
  }

  // Everything checks: score each arm and baseline on every item, in its own sandbox.
  const { createSession } = await import(join(dist, "assistant", "index.js"));
  const sys = new F.FrozenSystem(id);
  const armNames = ARM_NAMES;
  const startedAt = new Date().toISOString();
  const rows = await scoreAll({ sys, items: [...set.real, ...set.negative], baselines, root, createSession });

  const real = rows.filter((r) => r.class !== "none");
  const neg = rows.filter((r) => r.class === "none");
  const pct = (xs) => {
    const k = xs.filter(Boolean).length;
    const [lo, hi] = wilson(k, xs.length);
    return `${((100 * k) / Math.max(1, xs.length)).toFixed(1)}% (${k}/${xs.length}, 95% ${(100 * lo).toFixed(1)} to ${(100 * hi).toFixed(1)})`;
  };
  const systems = [...armNames.map((a) => ["arm", a, (r) => r.arms[a]]), ...baselines.map((b) => ["baseline", b.name, (r) => r.baselines[b.name]])];
  console.log(`Confirmatory set: ${real.length} real requests (${real.filter((r) => !r.restored).length} without a restored fixture), ${neg.length} negative.\n`);
  for (const [kind, name, get] of systems) {
    console.log(`${kind} ${name}`);
    console.log(`  (b) end state      ${pct(real.map((r) => get(r).end))}`);
    console.log(`  (a) act label      ${pct(real.map((r) => get(r).label))}`);
    console.log(`  names the command  ${pct(real.filter((r) => r.namesCommand).map((r) => get(r).end))}; without: ${pct(real.filter((r) => !r.namesCommand).map((r) => get(r).end))}`);
    console.log(`  false acts         ${pct(neg.map((r) => get(r).acted))}`);
  }
  const unchecked = real.filter((r) => r.arms["A+ trained"].unchecked?.length).length;
  if (unchecked) console.log(`\n${unchecked} items' end state passed with commit message constraints unchecked (testing.md open question 2).`);
  console.log("\nRisk against coverage, A+ trained (most confident share: end state):");
  for (const p of riskCoverage(real.map((r) => r.arms["A+ trained"].end), real.map((r) => r.arms["A+ trained"].confidence))) console.log(`  ${(100 * p.coverage).toFixed(0)}%: ${(100 * p.accuracy).toFixed(1)}%`);

  // The no-name set, beside (act label only: these have no fixtures).
  const nn = noNameSet(join(homedir(), ".napkin", "corpus", "tests"));
  if (nn.length) {
    console.log(`\nNo-name set (reported, not deciding): ${nn.length} items, act label accuracy`);
    const empty = mkdtempSync(join(tmpdir(), "noodle-noname-"));
    for (const arm of F.ARMS) {
      const { store, weights } = sys.arm(arm);
      const right = { real: [], paraphrase: [] };
      for (const x of nn) {
        const s = createSession(store, empty, { tutor: false }, undefined, { weights, confirmed: [] });
        const acts = await s.turn(x.text, { dry: true, ask: false }).then((r) => r.acts.map(sysAct)).catch(() => []);
        right[x.set].push(sameLabels(x.acts, acts));
      }
      console.log(`  ${arm.padEnd(14)} real ${pct(right.real)}; paraphrases ${pct(right.paraphrase)}`);
    }
    rmSync(empty, { recursive: true, force: true });
  }

  const trainedBaselines = Object.fromEntries(baselines.filter((b) => b.role === "trained").map((b) => [b.name, real.map((r) => r.baselines[b.name].end)]));
  const nameMatch = baselines.filter((b) => b.role === "name-match").map((b) => real.map((r) => r.baselines[b.name].end)).sort((x, y) => mean(y) - mean(x))[0];
  const result = applyRules({
    trained: real.map((r) => r.arms["A+ trained"].end),
    nameMatch,
    trainedBaselines,
    coverage: real.map((r) => r.arms["A+ trained"].coverage),
    clusters: real.map((r) => r.conversation),
    prereg: manifest.preregistered,
    resamples: Number(opt("--resamples") ?? 10000),
  });
  console.log("\nThe go rule, test by test (Holm over the first three):");
  for (const t of result.tests) console.log(`  ${t.passed ? "pass" : "fail"}  ${t.name}: ${t.estimate.toFixed(3)}${t.p !== undefined ? `, p = ${t.p.toFixed(4)}` : ""}`);
  console.log(`\n${result.go ? "GO" : "STOP"}`);
  const out = join(root, "decided");
  mkdirSync(out, { recursive: true });
  const file = join(out, `${id}-${startedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ frozen: id, startedAt, scoredAt: new Date().toISOString(), rules, preregistered: manifest.preregistered, result, rows }, null, 1) + "\n");
  console.log(`kept ${file}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
