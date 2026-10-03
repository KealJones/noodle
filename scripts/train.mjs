#!/usr/bin/env node
// `pnpm train` (design sections 9 and 29, arm A+ trained; runtime.md section 15): fits the scored
// weights to the development labels by the latent-variable structured perceptron, and writes them
// as a learned-weights pack that `pnpm freeze --weights FILE` takes.
//   pnpm train [--epochs N] [--rounds R] [--seed S] [--workers W] [--limit N] [--out FILE] [--no-cv]
//
// Data (testing.md section 6.2): the development side of the exploratory labels
// (scripts/devset.mjs; the holdout is never read, the confirmatory set is not touched). A slice of
// it, by conversation (CALIBRATION_SHARE, its own hash), is held apart from training and used only
// to calibrate and as a second untouched check. The rest is the training set.
//
// The update (runtime.md 15): each prompt is heard as a dry run, and every segment's scored readings
// are kept with their features and the acts each would run. The target is the highest-scoring
// choice of readings (one per segment) whose acts are exactly the gold's; the prediction is the
// chosen one. When they differ in acts, the weights move toward the target and away from the
// prediction by the runtime's own capped update (Weights.update: a template feature moves a quarter
// of the cap, a feature about one thing the whole cap). Several epochs over a shuffled order with a
// fixed seed; the weights kept are the average over every step. Because which readings the chart
// keeps depends on the weights, training runs in rounds: after a round the training prompts are
// heard again with its weights, the new readings join each prompt's pool, and training starts over
// on the larger pools. A prompt whose pool has no choice reaching the gold gives no update (counted
// as unreachable: the oracle recall of the pools).
//
// Numbers: accuracy before training (seed weights) and after it, by 5-fold cross-validation with
// folds by conversation (scripts/devset.mjs fold): each fold is heard with weights trained without
// it, so the after number is not training accuracy. The final weights are trained on the whole
// training set, then checked on the calibration slice. Calibration fits a temperature for the
// softmax over the winners' scores on that slice (runtime.md 8.4); the runtime does not ask on it
// yet, so it is written beside the weights and reported, not used.
//
// The replay gate (testing.md section 4): the final weights are kept only if no hand-checked item
// (labelled by Keal, or verdict ok or fixed in checked.jsonl) that was right with the seed weights
// goes wrong, as src/assistant/replay.ts decides. Where it vetoes, the learned weights of the
// features the regressed items' readings use are put back to the seed's, and it is asked again.
//
// Hearing is the cost (about a second a prompt), so prompts are heard by worker processes
// (`--worker JOB`, the same script) in parallel. A prompt that takes a worker down is kept as an
// error with an empty pool, and the run goes on.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { conversation, devLabels, fold, jsonl } from "./devset.mjs";

const here = import.meta.dirname;
const dist = join(here, "..", "dist");
const TRAIN = join(homedir(), ".noodle", "train");
const PACKS = process.env.NOODLE_PACKS ?? join(homedir(), ".noodle", "packs");
const TESTS = join(homedir(), ".napkin", "corpus", "tests");

/** The share of development items held apart for calibration (design section 9). */
export const CALIBRATION_SHARE = 0.2;
/**
 * The calibration slice: whole conversations, taken in the order of a fixed hash of their key until
 * they hold the share of the items (conversations differ a lot in size, so a share of
 * conversations would not be a share of items).
 */
export function calibrationSlice(rows, share = CALIBRATION_SHARE) {
  const sizes = new Map();
  for (const r of rows) sizes.set(conversation(r), (sizes.get(conversation(r)) ?? 0) + 1);
  const h = (c) => createHash("sha256").update(`calibration|${c}`).digest("hex");
  const out = new Set();
  let n = 0;
  for (const [c, k] of [...sizes].sort((a, b) => h(a[0]).localeCompare(h(b[0])))) {
    if (n >= share * rows.length) break;
    out.add(c);
    n += k;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Acts, named as the labels name them (the same naming as scripts/acts.mjs and the replay gate)

/** An act's label keys: "program sub", and for a two-word subcommand also "program sub-sub2". */
export function actKeys(act, { isCall, positional }) {
  if (!isCall(act)) return [];
  if (act.head === "Run") {
    const [program, a] = positional(act);
    const words = isCall(a) ? positional(a).filter((x) => x.kind === "string").map((x) => x.value) : [];
    const p = program?.kind === "string" ? program.value : "";
    const one = `${p} ${words[0] ?? ""}`.trim();
    return words.length > 1 && /^[a-z]+$/.test(words[1]) ? [one, `${p} ${words[0]}-${words[1]}`] : [one];
  }
  if (act.head === "Read") return ["read"];
  if (act.head === "Write" || act.head === "Edit") return ["edit"];
  return [act.head.toLowerCase()];
}

/** The act set a list of acts names, against a gold set (a two-word subcommand counts where the gold uses it). */
export function actSet(acts, gold) {
  return [...new Set(acts.map((keys) => keys.find((k, i) => i > 0 && gold.includes(k)) ?? keys[0]))];
}
export const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// ---------------------------------------------------------------------------------------------
// The perceptron over pools

/** A score of a feature list under a weight lookup. */
const scoreF = (f, get) => f.reduce((s, [k, v]) => s + get(k) * v, 0);
const toMap = (fs) => {
  const m = new Map();
  for (const f of fs) for (const [k, v] of f) m.set(k, (m.get(k) ?? 0) + v);
  return m;
};

/** The chosen readings: the best-scoring candidate of each segment (the first on a tie, as the runtime sorts). */
export function predict(segs, get) {
  return segs.map((seg) => {
    let best = 0;
    let bs = -Infinity;
    seg.cands.forEach((c, i) => {
      const s = scoreF(c.f, get);
      if (s > bs) (bs = s), (best = i);
    });
    return seg.cands[best];
  });
}

/**
 * The latent target: the highest-scoring choice of one candidate per segment whose acts, together,
 * are exactly the gold set. Each candidate's acts must all be in the gold; the choice must cover it.
 * A dynamic program over segments with the covered part of the gold as its state. Undefined when no
 * choice reaches the gold.
 */
export function target(segs, gold, get) {
  if (!segs.length) return gold.length ? undefined : [];
  const bit = new Map(gold.map((g, i) => [g, 1 << i]));
  const full = (1 << gold.length) - 1;
  let states = new Map([[0, { s: 0, pick: [] }]]);
  for (const seg of segs) {
    const next = new Map();
    for (const c of seg.cands) {
      const keys = actSet(c.acts, gold);
      if (!keys.every((k) => bit.has(k))) continue;
      const m = keys.reduce((x, k) => x | bit.get(k), 0);
      const s = scoreF(c.f, get);
      for (const [st, v] of states) {
        const ns = st | m;
        const val = v.s + s;
        if (!next.has(ns) || next.get(ns).s < val) next.set(ns, { s: val, pick: [...v.pick, c] });
      }
    }
    states = next;
  }
  return states.get(full)?.pick;
}

export const chosenSet = (pick, gold) => actSet(pick.flatMap((c) => c.acts), gold);

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
export function shuffle(xs, rand) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Trains a fresh copy of `base` (seed weights) on examples { segs, gold } and returns the averaged
 * weights and what happened. The update is the runtime's own (Weights.update, capped).
 */
export function perceptron(base, examples, { epochs = 5, seed = 29 } = {}) {
  const w = base.clone();
  w.learned.clear();
  const sum = new Map();
  const last = new Map();
  let t = 0;
  const stats = [];
  const rand = rng(seed);
  for (let e = 0; e < epochs; e++) {
    let mistakes = 0;
    let unreachable = 0;
    for (const ex of shuffle(examples, rand)) {
      t++;
      const pred = predict(ex.segs, w.get);
      if (sameSet(chosenSet(pred, ex.gold), ex.gold)) continue;
      mistakes++;
      const good = target(ex.segs, ex.gold, w.get);
      if (!good) {
        unreachable++;
        continue;
      }
      const before = new Map([...toMap(good.map((c) => c.f)).keys(), ...toMap(pred.map((c) => c.f)).keys()].map((k) => [k, w.get(k)]));
      w.update(toMap(good.map((c) => c.f)), toMap(pred.map((c) => c.f)));
      for (const [k, b] of before) {
        if (w.get(k) === b) continue;
        sum.set(k, (sum.get(k) ?? 0) + b * (t - (last.get(k) ?? 0)));
        last.set(k, t);
      }
    }
    stats.push({ epoch: e + 1, mistakes, unreachable });
  }
  // The average over every step: a weight's value counts for as many steps as it held.
  const avg = base.clone();
  avg.learned.clear();
  for (const [k, s] of sum) {
    const v = (s + w.get(k) * (t - last.get(k))) / Math.max(1, t);
    if (v !== base.get(k)) avg.learned.set(k, Number(v.toFixed(6)));
  }
  return { weights: avg, stats };
}

/** Joins a fresh hearing's segments into a prompt's pool: candidates are kept by segment text, deduplicated. */
export function joinPool(pool, heard) {
  if (!pool) return heard.segs.map((s) => ({ text: s.text, cands: dedupe(s.cands) }));
  return heard.segs.map((s) => {
    const old = pool.find((p) => p.text === s.text);
    return { text: s.text, cands: dedupe([...s.cands, ...(old?.cands ?? [])]) };
  });
}
function dedupe(cands) {
  const seen = new Set();
  return cands.filter((c) => {
    const k = JSON.stringify([c.f, c.acts]);
    return !seen.has(k) && seen.add(k);
  });
}

/** Softmax probability of the winner per segment, multiplied over segments, at temperature T. */
export function topProbability(segs, get, T) {
  let p = 1;
  for (const seg of segs) {
    const s = seg.cands.map((c) => scoreF(c.f, get) / T);
    const m = Math.max(...s);
    const z = s.reduce((a, x) => a + Math.exp(x - m), 0);
    p *= 1 / z;
  }
  return p;
}

/** The temperature with the lowest log loss of "the top is right" on the items. */
export function fitTemperature(items, get) {
  let best = { T: 1, loss: Infinity };
  for (let T = 0.05; T <= 20; T *= 1.15) {
    let loss = 0;
    for (const it of items) {
      const p = Math.min(1 - 1e-6, Math.max(1e-6, topProbability(it.segs, get, T)));
      loss -= it.right ? Math.log(p) : Math.log(1 - p);
    }
    if (loss < best.loss) best = { T: Number(T.toFixed(4)), loss: loss / Math.max(1, items.length) };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Hearing (the worker)

async function worker(jobPath) {
  const job = JSON.parse(readFileSync(jobPath, "utf8"));
  const { packedStore, createSession } = await import(join(dist, "assistant", "index.js"));
  const { weightsFrom } = await import(join(dist, "assistant", "frozen.js"));
  const expr = await import(join(dist, "runtime", "expr.js"));
  const store = packedStore();
  const weights = weightsFrom(store, job.weights || undefined);
  const root = mkdtempSync(join(tmpdir(), "noodle-train-"));
  for (const it of job.items) {
    const s = createSession(store, root, {}, undefined, { weights, confirmed: [] });
    // What each reading would run is known from its dry run (stage two); it is kept here beside
    // the reading's features, by the runtime's own Suppose, without changing what the turn does.
    const actsBy = new Map();
    const suppose = s.suppose.bind(s);
    s.suppose = async (r, segText, conv) => {
      const o = await suppose(r, segText, conv);
      if (r.lfs.length === 1) actsBy.set(expr.key(r.lfs[0]), o.acts);
      return o;
    };
    const segs = [];
    const readings = s.readings.bind(s);
    s.readings = async (covers, chart, rewriter, segText, conv) => {
      const top = await readings(covers, chart, rewriter, segText, conv);
      segs.push({ text: segText, cands: top.map((r) => ({ f: [...r.features].filter(([, v]) => v !== 0), acts: r.lfs.flatMap((lf) => actsBy.get(expr.key(lf)) ?? []).map((a) => actKeys(a, expr)) })) });
      return top;
    };
    try {
      const r = await s.turn(it.text, { dry: true, ask: false });
      process.stdout.write(JSON.stringify({ i: it.i, acts: r.acts.map((a) => actKeys(a, expr)), segs }) + "\n");
    } catch (e) {
      process.stdout.write(JSON.stringify({ i: it.i, error: String(e).slice(0, 120), acts: [], segs: [] }) + "\n");
    }
  }
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------
// The run

function runWorker(items, weightsText) {
  return new Promise((resolve) => {
    const dir = mkdtempSync(join(tmpdir(), "noodle-train-job-"));
    const job = join(dir, "job.json");
    writeFileSync(job, JSON.stringify({ items: items.map(({ i, text }) => ({ i, text })), weights: weightsText }));
    const p = spawn(process.execPath, ["--max-old-space-size=8192", join(here, "train.mjs"), "--worker", job], {
      env: { ...process.env, NOODLE_PACKS: join(TRAIN, "packs"), NOODLE_STORE: join(TRAIN, "store.db") },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (code) => {
      rmSync(dir, { recursive: true, force: true });
      resolve({ code, rows: out.split("\n").filter(Boolean).map((l) => JSON.parse(l)) });
    });
  });
}

/** Hears every item with the weights (null: the seed's), in parallel workers; one row per item. */
async function hearAll(items, weightsText, workers, label) {
  const queue = [...items];
  const out = new Map();
  const t0 = Date.now();
  const size = Math.max(1, Math.min(25, Math.ceil(items.length / workers)));
  async function lane() {
    while (queue.length) {
      let batch = queue.splice(0, size);
      while (batch.length) {
        const { code, rows } = await runWorker(batch, weightsText);
        for (const r of rows) out.set(r.i, r);
        batch = batch.filter((x) => !out.has(x.i));
        // A prompt that took the worker down is kept as an error; the rest of the batch goes on.
        if (code !== 0 && batch.length) {
          const bad = batch.shift();
          out.set(bad.i, { i: bad.i, error: `crashed (exit ${code})`, acts: [], segs: [] });
        }
      }
      process.stderr.write(`\r  ${label}: ${out.size}/${items.length} heard (${((Date.now() - t0) / 1000).toFixed(0)} s)   `);
    }
  }
  await Promise.all(Array.from({ length: workers }, lane));
  process.stderr.write("\n");
  return items.map((it) => ({ ...out.get(it.i), i: it.i }));
}

/** A fresh store over every pack (arm A+), so the weights start from the seed's and nothing learned in chat is in it. */
function prepareStore() {
  mkdirSync(join(TRAIN, "packs"), { recursive: true });
  const want = readdirSync(PACKS).filter((f) => f.endsWith(".ncon"));
  const have = readdirSync(join(TRAIN, "packs"));
  if (want.length !== have.length || want.some((f) => !have.includes(f))) {
    rmSync(TRAIN, { recursive: true, force: true });
    mkdirSync(join(TRAIN, "packs"), { recursive: true });
    for (const f of want) symlinkSync(join(PACKS, f), join(TRAIN, "packs", f));
  }
}

const pct = (k, n) => `${n ? ((100 * k) / n).toFixed(1) : "0.0"}% (${k}/${n})`;
function accuracy(items, heard) {
  const by = new Map(heard.map((h) => [h.i, h]));
  const rows = items.map((it) => ({ it, right: sameSet(actSet(by.get(it.i)?.acts ?? [], it.gold), it.gold) }));
  const acts = rows.filter((r) => r.it.cls === "acts");
  const none = rows.filter((r) => r.it.cls === "none");
  const k = (xs) => xs.filter((r) => r.right).length;
  return { all: [k(rows), rows.length], acts: [k(acts), acts.length], none: [k(none), none.length], right: new Map(rows.map((r) => [r.it.i, r.right])) };
}
const show = (a) => `act items exact ${pct(...a.acts)}; no-act items none ${pct(...a.none)}; all ${pct(...a.all)}`;

/** Training with re-hearing: pools from the seed's hearing, then rounds of train, hear again, join. */
async function trainWithRounds(base, items, seedHeard, opts, label) {
  const pools = new Map(items.map((it) => [it.i, joinPool(undefined, seedHeard.get(it.i) ?? { segs: [] })]));
  let result;
  for (let r = 0; r <= opts.rounds; r++) {
    result = perceptron(base, items.map((it) => ({ segs: pools.get(it.i), gold: it.gold })), opts);
    if (r === opts.rounds) break;
    const again = await hearAll(items, ncon(result.weights), opts.workers, `${label}, round ${r + 1}`);
    for (const h of again) pools.set(h.i, joinPool(pools.get(h.i), h));
  }
  const reached = items.filter((it) => target(pools.get(it.i), it.gold, base.get));
  return { ...result, pools, reachable: reached.length, reachableActs: [reached.filter((it) => it.cls === "acts").length, items.filter((it) => it.cls === "acts").length] };
}

const ncon = (w) => w.toNcon().replace("from=Correction()", "from=Training()");

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const opts = { epochs: Number(opt("--epochs", 5)), rounds: Number(opt("--rounds", 1)), seed: Number(opt("--seed", 29)), workers: Number(opt("--workers", 6)) };
  const out = opt("--out", join(TRAIN, "weights.ncon"));
  const limit = Number(opt("--limit", Infinity));
  prepareStore();
  const { packedStore } = await import(join(dist, "assistant", "index.js"));
  const { weightsFrom } = await import(join(dist, "assistant", "frozen.js"));
  // Built once here, so the workers open a store that is already made.
  const store = packedStore(join(TRAIN, "packs"), join(TRAIN, "store.db"));
  const base = weightsFrom(store);

  const key = (a) => `${a.program ?? ""} ${a.sub ?? ""}`.trim();
  const labels = devLabels({ maxWords: 150 })
    .filter((l) => !l.tooLong)
    .slice(0, limit);
  const slice = calibrationSlice(labels.map((l) => l.row));
  const items = labels.map((l) => ({ i: l.i, text: l.text, cls: l.class, gold: [...new Set((l.acts ?? []).map(key).filter(Boolean))], fold: fold(l.row), calibration: slice.has(conversation(l.row)), labeller: l.labeller }));
  const train = items.filter((it) => !it.calibration);
  const calib = items.filter((it) => it.calibration);
  console.log(`development labels: ${items.length} (training ${train.length}, calibration ${calib.length}); epochs ${opts.epochs}, rounds ${opts.rounds}, seed ${opts.seed}`);

  const seedHeard = new Map((await hearAll(items, null, opts.workers, "seed weights")).map((h) => [h.i, h]));
  const errors = [...seedHeard.values()].filter((h) => h.error).length;
  const before = accuracy(train, [...seedHeard.values()]);
  const beforeCal = accuracy(calib, [...seedHeard.values()]);
  console.log(`before (seed weights), training set: ${show(before)}${errors ? `; ${errors} prompts errored (no act)` : ""}`);

  // Cross-validation by conversation: each fold heard with weights trained without it.
  const report = { at: new Date().toISOString(), opts, items: items.length, train: train.length, calibration: calib.length, before: before.all, beforeActs: before.acts, beforeNone: before.none };
  if (!args.includes("--no-cv")) {
    const cvHeard = [];
    const folds = [];
    for (let k = 0; k < 5; k++) {
      const tr = train.filter((it) => it.fold !== k);
      const te = train.filter((it) => it.fold === k);
      if (!te.length) continue;
      const r = await trainWithRounds(base, tr, seedHeard, opts, `fold ${k + 1}`);
      const heard = await hearAll(te, ncon(r.weights), opts.workers, `fold ${k + 1}, held out`);
      cvHeard.push(...heard);
      const a = accuracy(te, heard);
      const b = accuracy(te, te.map((it) => seedHeard.get(it.i)));
      folds.push({ fold: k + 1, n: te.length, before: b.all, after: a.all, learned: r.weights.learned.size, reachable: [r.reachable, tr.length], reachableActs: r.reachableActs, stats: r.stats });
      console.log(`  fold ${k + 1}: ${te.length} held out, before ${pct(...b.all)}, after ${pct(...a.all)}; ${r.weights.learned.size} weights learned; pools reach the gold on ${pct(r.reachable, tr.length)} of its training prompts (act items ${pct(...r.reachableActs)})`);
    }
    const cv = accuracy(train, cvHeard);
    console.log(`after (cross-validated, folds by conversation), training set: ${show(cv)}`);
    Object.assign(report, { cv: cv.all, cvActs: cv.acts, cvNone: cv.none, folds, cvItems: cvHeard.map((h) => ({ i: h.i, acts: h.acts })) });
  }

  // The final weights, on the whole training set.
  const final = await trainWithRounds(base, train, seedHeard, opts, "final");
  const w = final.weights;
  console.log(`final: ${w.learned.size} weights learned; pools reach the gold on ${pct(final.reachable, train.length)} of the training prompts (act items ${pct(...final.reachableActs)}); epochs ${final.stats.map((s) => s.mistakes).join(", ")} mistakes`);

  // The replay gate, on the hand-checked items.
  const checked = new Set(jsonl(join(TESTS, "checked.jsonl")).filter((c) => ["ok", "fixed"].includes(c.verdict)).map((c) => c.id));
  const gateItems = train.filter((it) => it.labeller === "keal" || checked.has(it.i)).map((it) => ({ i: it.i, text: it.text, want: it.gold }));
  const { ReplayGate } = await import(join(dist, "assistant", "replay.js"));
  const gate = new ReplayGate(store, gateItems);
  const reverted = [];
  for (let tries = 0; tries < 4; tries++) {
    if (await gate.check(new Set(w.learned.keys()), w, base)) break;
    const now = new Map((await hearAll(gateItems, ncon(w), opts.workers, "replay gate")).map((h) => [h.i, h]));
    const was = accuracy(train.filter((it) => now.has(it.i)), gateItems.map((g) => seedHeard.get(g.i))).right;
    const is = accuracy(train.filter((it) => now.has(it.i)), [...now.values()]).right;
    const regressed = gateItems.filter((g) => was.get(g.i) && !is.get(g.i));
    const touched = new Set(regressed.flatMap((g) => (final.pools.get(g.i) ?? []).flatMap((s) => s.cands.flatMap((c) => c.f.map(([k]) => k)))));
    const back = [...w.learned.keys()].filter((k) => touched.has(k) || !regressed.length);
    for (const k of back) w.learned.delete(k);
    reverted.push(...back);
    console.log(`  replay gate: ${regressed.length} hand-checked items regressed; ${back.length} weights put back`);
  }
  console.log(`replay gate: ${gateItems.length} hand-checked items; ${reverted.length ? `${reverted.length} weights put back` : "passed"}`);

  // The calibration slice: untouched by training; the temperature and a second check.
  const calHeard = await hearAll(calib, ncon(w), opts.workers, "calibration slice");
  const cal = accuracy(calib, calHeard);
  const calItems = calHeard.map((h) => ({ segs: h.segs ?? [], right: cal.right.get(h.i) }));
  const temperature = fitTemperature(calItems, w.get);
  console.log(`calibration slice: before ${show(beforeCal)}`);
  console.log(`calibration slice: after  ${show(cal)}; temperature ${temperature.T} (log loss ${temperature.loss.toFixed(3)})`);

  mkdirSync(join(out, ".."), { recursive: true });
  writeFileSync(out, ncon(w));
  Object.assign(report, { final: { learned: w.learned.size, reachable: [final.reachable, train.length], reachableActs: final.reachableActs, stats: final.stats }, gate: { items: gateItems.length, reverted }, calibrationBefore: beforeCal.all, calibrationAfter: cal.all, calibrationActs: cal.acts, calibrationNone: cal.none, temperature });
  writeFileSync(out.replace(/\.ncon$/, "") + ".json", JSON.stringify(report, null, 1) + "\n");
  console.log(`wrote ${out} (pnpm freeze --weights ${out}) and its report beside it`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv[2] === "--worker") await worker(process.argv[3]);
  else await main();
}
