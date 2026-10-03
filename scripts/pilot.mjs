// The pilot (PLAN.md phase 5; design section 29, stage 1; testing.md section 7), on the development
// side of the split only (scripts/devset.mjs; the holdout is never read), with the labels that
// exist. It writes docs/pilot.md: the ceiling, every baseline that can run (scripts/baseline.mjs),
// Noodle's arms that exist (scripts/acts.mjs over a fresh store per arm), the margin to the best
// baseline with a paired bootstrap by conversation, the n the go decision needs with every
// assumption stated, and how long the capture hook takes to reach it.
//   pnpm pilot [--reuse]
// --reuse keeps the arm and baseline runs in ~/.noodle/pilot/ when they were made by this runtime
// version (an arm takes about fifteen minutes).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { conversation, corpus, devLabels, jsonl, split, reviewedByKeal } from "./devset.mjs";
import { captures, namesCommand } from "./label.mjs";

const here = import.meta.dirname;
const VERSION = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version;
const PILOT = join(homedir(), ".noodle", "pilot");
const PACKS = process.env.NOODLE_PACKS ?? join(homedir(), ".noodle", "packs");
const TESTS = join(homedir(), ".napkin", "corpus", "tests");
const reuse = process.argv.includes("--reuse");
mkdirSync(PILOT, { recursive: true });

// ---- runs

function spawnOut(script, args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--max-old-space-size=8192", join(here, script), ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
}
async function run(script, args, env) {
  const { code, out } = await spawnOut(script, args, env);
  if (code !== 0) throw new Error(`${script} exited ${code}`);
  return JSON.parse(out);
}
/**
 * Noodle's acts on every development label. A prompt that takes the process down (out of memory)
 * is kept as an error, which counts as no act, and the run goes on after it: the crash is the
 * runtime's to fix, not the pilot's to hide.
 */
async function actsRows(env) {
  const n = devLabels({ maxWords: 150 }).length;
  const rows = [];
  while (rows.length < n) {
    const { code, out } = await spawnOut("acts.mjs", ["--jsonl", "--from", String(rows.length)], env);
    rows.push(...out.split("\n").filter(Boolean).map((l) => JSON.parse(l)));
    if (code !== 0 && rows.length < n) rows.push({ i: devLabels({ maxWords: 150 })[rows.length].i, error: `crashed (exit ${code})` });
  }
  return { rows };
}
async function cached(name, make) {
  const path = join(PILOT, `${name}.json`);
  if (reuse && existsSync(path)) {
    const c = JSON.parse(readFileSync(path, "utf8"));
    if (c.version === VERSION) return c.out;
  }
  const out = await make();
  writeFileSync(path, JSON.stringify({ version: VERSION, at: new Date().toISOString(), out }));
  return out;
}

// Design section 29's arms. Each runs in its own fresh store, so its weights are the seed's and
// nothing learned in chat is in it; what differs is the packs it is given.
const ARMS = [
  { name: "A", slug: "arm-a", what: "imports alone (WordNet, VerbNet, Wiktionary, definitions, word frequencies), seed weights", packs: (f) => !f.startsWith("tool-") },
  { name: "A+ zero-shot", slug: "arm-a-plus", what: "the same plus the documentation readings (git, gh and the other learned tools), seed weights", packs: () => true },
];
function armRun(arm) {
  return cached(arm.slug, () => {
    const dir = join(PILOT, arm.slug);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "packs"), { recursive: true });
    for (const f of readdirSync(PACKS).filter((x) => x.endsWith(".ncon") && arm.packs(x))) symlinkSync(join(PACKS, f), join(dir, "packs", f));
    return actsRows({ NOODLE_PACKS: join(dir, "packs"), NOODLE_STORE: join(dir, "store.db") });
  });
}
console.error("running the baselines and Noodle's arms (about fifteen minutes; --reuse keeps earlier runs)");
const [baseline, ...armOuts] = await Promise.all([cached("baselines", () => run("baseline.mjs", ["--json", "--items"])), ...ARMS.map(armRun)]);

// ---- items

const all = corpus();
const key = (a) => `${a.program ?? ""} ${a.sub ?? ""}`.trim();
const items = devLabels({ maxWords: 150 })
  .filter((l) => !l.tooLong)
  .map((l) => ({ i: l.i, cls: l.class, want: [...new Set((l.acts ?? []).map(key).filter(Boolean))], acts: l.acts ?? [], kw: namesCommand(l.text), conv: conversation(l.row), labeller: l.labeller }));
const actItems = items.filter((it) => it.cls === "acts");
const noneItems = items.filter((it) => it.cls === "none");

/** system name -> Map(i -> the acts it chose), for Noodle's arms and every baseline. */
const systems = new Map();
const errors = new Map();
ARMS.forEach((arm, k) => {
  const m = new Map();
  const err = [];
  // An error is an abstention: nothing chosen (asking or abstaining counts as wrong on act items).
  for (const r of armOuts[k].rows) if (!r.tooLong) m.set(r.i, r.error ? (err.push(r), []) : r.got);
  systems.set(`Noodle ${arm.name}`, m);
  errors.set(`Noodle ${arm.name}`, err);
});
for (const name of Object.keys(baseline.baselines)) systems.set(name, new Map(baseline.items.map((x) => [x.i, x.got[name]])));

const exact = (it, got = []) => (it.cls === "acts" ? it.want.length === got.length && it.want.every((w) => got.includes(w)) : got.length === 0);
const right = (sys, it) => exact(it, systems.get(sys).get(it.i));

// ---- statistics

/** Wilson 95 percent interval. */
function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
/** The standard normal quantile (Acklam's approximation). */
function zq(p) {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -zq(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Paired difference a minus b on the items, with a 95 percent bootstrap interval resampling conversations. */
function paired(a, b, its, resamples = 10000) {
  const byConv = new Map();
  for (const it of its) {
    const d = (right(a, it) ? 1 : 0) - (right(b, it) ? 1 : 0);
    const g = byConv.get(it.conv) ?? { sum: 0, n: 0 };
    g.sum += d;
    g.n += 1;
    byConv.set(it.conv, g);
  }
  const groups = [...byConv.values()];
  const disagree = its.filter((it) => right(a, it) !== right(b, it)).length;
  const diff = groups.reduce((s, g) => s + g.sum, 0) / its.length;
  const rand = rng(29);
  const ds = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < groups.length; k++) {
      const g = groups[Math.floor(rand() * groups.length)];
      sum += g.sum;
      n += g.n;
    }
    ds.push(sum / n);
  }
  ds.sort((x, y) => x - y);
  return { diff, lo: ds[Math.floor(0.025 * resamples)], hi: ds[Math.floor(0.975 * resamples)], disagree: disagree / its.length, convs: groups.length };
}
/** Paired n (Wald, normal approximation) to reject H0: delta <= null when the true difference is delta. */
function nPaired({ delta, nullAt, pdisc, alpha, power }) {
  const v = pdisc - delta * delta;
  if (delta <= nullAt || v <= 0) return Infinity;
  return Math.ceil(((zq(1 - alpha) + zq(power)) ** 2 * v) / (delta - nullAt) ** 2);
}
/** One-sample n to reject H0: p <= p0 when the true rate is p. */
function nFloor({ p, p0, alpha, power }) {
  if (p <= p0) return Infinity;
  return Math.ceil((zq(1 - alpha) * Math.sqrt(p0 * (1 - p0)) + zq(power) * Math.sqrt(p * (1 - p))) ** 2 / (p - p0) ** 2);
}

// ---- the ceiling

const nameIn = new Map(jsonl(join(TESTS, "noname-real.jsonl")).map((x) => [x.i, x.nameIn]));
const fixtures = new Map(jsonl(join(TESTS, "fixtures.jsonl")).map((x) => [x.i, x]));
const TYPED = new Set(["program", "sub", "flags", "files", "branch", "remote", "onto", "base", "message"]);
const needsTurns = actItems.filter((it) => nameIn.get(it.i) === "prior-turns");
const outside = actItems.filter((it) => it.acts.some((a) => a.outsideActSet));
const prOnly = actItems.filter((it) => it.acts.some((a) => a.program === "gh"));
const typed = actItems.filter((it) => it.acts.length && it.acts.every((a) => Object.keys(a).every((k) => TYPED.has(k)) && Object.keys(a).some((k) => !["program", "sub", "flags"].includes(k))));
const reconstructable = actItems.filter((it) => ["exact", "committed-state"].includes(fixtures.get(it.i)?.reconstructable));
const endStateCheckable = actItems.filter((it) => typed.includes(it) && reconstructable.includes(it) && !prOnly.includes(it));

// ---- results per system

const sysNames = [...systems.keys()];
const stats = (sys, its) => {
  const k = its.filter((it) => right(sys, it)).length;
  return { k, n: its.length, p: its.length ? k / its.length : 0, ci: wilson(k, its.length) };
};
const table = sysNames.map((s) => ({
  s,
  acts: stats(s, actItems),
  named: stats(s, actItems.filter((it) => it.kw)),
  noName: stats(s, actItems.filter((it) => !it.kw)),
  none: stats(s, noneItems),
}));
const TRAINED = ["knn", "classifier", "classifier+man", "classifier+man+wn"];
const best = (names) => names.map((s) => table.find((t) => t.s === s)).sort((a, b) => b.acts.p - a.acts.p)[0];
const bestBaseline = best(Object.keys(baseline.baselines));
const bestTrained = best(TRAINED);
const noodle = best(ARMS.map((a) => `Noodle ${a.name}`));
const vsName = paired(noodle.s, "name", actItems);
const vsBest = paired(noodle.s, bestBaseline.s, actItems);
const vsTrained = bestTrained.s === bestBaseline.s ? vsBest : paired(noodle.s, bestTrained.s, actItems);
const keal = actItems.filter(reviewedByKeal);
const vsBestKeal = paired(noodle.s, bestBaseline.s, keal);

// ---- power

const MARGIN = 0.1;
const ALPHA = 0.025; // one-sided, the 95 percent intervals of testing.md section 7
const TESTS3 = 3; // the floor, superiority over name match, non-inferiority to the best trained classifier
const HOLM = ALPHA / TESTS3; // the first Holm step; planning every test at it is the conservative case
const POWER = 0.8;
const JOINT = POWER ** (1 / TESTS3); // per-test power so that all three pass together with 0.8 (independence assumed)
// The pilot's disagreement rates come from a Noodle that almost never acts, so they understate how
// often two systems that both act disagree; the design's 20 percent is kept as a floor under them.
const DISAGREE = 0.2;
const pdName = Math.max(vsName.disagree, DISAGREE);
const pdTrained = Math.max(vsTrained.disagree, DISAGREE);
const plan = (alpha, power) => ({
  sup: nPaired({ delta: MARGIN, nullAt: 0, pdisc: pdName, alpha, power }),
  supAsWritten: nPaired({ delta: 2 * MARGIN, nullAt: MARGIN, pdisc: pdName, alpha, power }),
  ni: nPaired({ delta: 0, nullAt: -MARGIN, pdisc: pdTrained, alpha, power }),
  floor: nFloor({ p: 0.7, p0: 0.6, alpha, power }),
});
const designN = nPaired({ delta: MARGIN, nullAt: 0, pdisc: 0.2, alpha: ALPHA, power: POWER });
const designNHolm = nPaired({ delta: MARGIN, nullAt: 0, pdisc: 0.2, alpha: HOLM, power: POWER });
const planned = plan(HOLM, POWER);
const plannedJoint = plan(HOLM, JOINT);
const nNeeded = Math.max(planned.sup, planned.ni, planned.floor);
const nNeededJoint = Math.max(plannedJoint.sup, plannedJoint.ni, plannedJoint.floor);
const fromPilot = {
  sup: nPaired({ delta: vsName.diff, nullAt: MARGIN, pdisc: vsName.disagree, alpha: HOLM, power: POWER }),
  ni: nPaired({ delta: vsTrained.diff, nullAt: -MARGIN, pdisc: vsTrained.disagree, alpha: HOLM, power: POWER }),
  floor: nFloor({ p: noodle.acts.p, p0: 0.6, alpha: HOLM, power: POWER }),
};

// ---- the accrual rate

const WEEK = 7 * 864e5;
const sp = split();
const holdout = new Set(sp.holdout);
const devShare = 1 - sp.holdout.length / sp.prompts;
const human = (t) => t && !t.trimStart().startsWith("<heartbeat>");
const devRows = all.map((r, i) => ({ ...r, i })).filter((r) => !holdout.has(r.i) && human(r.text));
const span = (rows) => {
  const t = rows.map((r) => Date.parse(r.at)).filter(Number.isFinite);
  return (Math.max(...t) - Math.min(...t)) / WEEK;
};
const corpusWeeks = span(devRows);
const sinceAug = devRows.filter((r) => String(r.at) >= "2026-08-01");
const augWeeks = span(sinceAug);
// Qualifying: a request in the domain the gold can score (git or gh acts, none outside the act
// set), or a constraint on its own.
const qualifies = (l) => l.class === "constraint" || (l.class === "acts" && (l.acts ?? []).some((a) => a.program === "git" || a.program === "gh") && !(l.acts ?? []).some((a) => a.outsideActSet));
const labelled = devLabels({ classes: ["acts", "none", "constraint"] }).map((l) => ({ ...l, kw: namesCommand(l.text) }));
const kwLabelled = labelled.filter((l) => l.kw);
const nonSample = labelled.filter((l) => l.sample === "non" && !l.kw);
const pKw = kwLabelled.filter(qualifies).length / kwLabelled.length;
const pNon = nonSample.length ? nonSample.filter(qualifies).length / nonSample.length : 0;
const devKw = devRows.filter((r) => namesCommand(r.text));
const weekly = (kw, non, weeks) => ({ kw: kw / weeks, non: non / weeks, q: (kw * pKw + non * pNon) / weeks });
const corpusRate = weekly(devKw.length / devShare, (devRows.length - devKw.length) / devShare, corpusWeeks);
const augKw = sinceAug.filter((r) => namesCommand(r.text)).length;
const augRate = weekly(augKw / devShare, (sinceAug.length - augKw) / devShare, augWeeks);
const caps = captures().filter((c) => human(c.prompt));
const capDays = span(caps) * 7;
const capKw = caps.filter((c) => namesCommand(c.prompt)).length;
const capRate = weekly(capKw, caps.length - capKw, Math.max(capDays, 1) / 7);
const noodleCwd = caps.filter((c) => /\/noodle(\/|$)/.test(c.cwd ?? "")).length;
const FOUR_MONTHS = 17.4;
const weeksTo = (n, rate) => (Number.isFinite(n) && rate > 0 ? n / rate : Infinity);

// ---- the report

const pc = (x) => `${(100 * x).toFixed(1)}%`;
const ci = ([a, b]) => `${(100 * a).toFixed(1)} to ${(100 * b).toFixed(1)}`;
const cell = (x) => `${pc(x.p)} (${x.k}/${x.n}; ${ci(x.ci)})`;
const signed = (x) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}`;
const iv = (r) => `${signed(r.diff)} points (95% bootstrap ${signed(r.lo)} to ${signed(r.hi)}; ${pc(r.disagree)} of pairs disagree; ${r.convs} conversations)`;
const nn = (n) => (Number.isFinite(n) ? String(n) : "no n (the pilot's effect is on the wrong side of the bound)");
const wk = (w) => (Number.isFinite(w) ? `${w.toFixed(1)} weeks` : "never");
const today = new Date().toISOString().slice(0, 10);

const md = `# The pilot (PLAN.md phase 5; design section 29, stage 1)

Written by \`pnpm pilot\` (\`scripts/pilot.mjs\`) on ${today}, runtime ${VERSION}. Development side of
\`~/.noodle/experiment/split.json\` only (the holdout is never read); the labels that exist (the
exploratory labels in \`~/.napkin/corpus/tests/labels.jsonl\`, the later label where a prompt was
labelled twice; \`~/.noodle/experiment/gold.jsonl\` ${existsSync(join(homedir(), ".noodle", "experiment", "gold.jsonl")) ? `has ${jsonl(join(homedir(), ".noodle", "experiment", "gold.jsonl")).length} lines and is not yet in the pilot` : "does not exist yet: no captured prompt has been labelled"}). Prompts of at most 150 words, heartbeats
left out. Nothing here is the confirmatory set or decides go.

**n available: ${actItems.length} act items and ${noneItems.length} no-act items** (${items.length} labelled; PLAN.md asked for about 50).
${keal.length} of the act items carry a label Keal wrote or checked; the rest are model drafts
(\`claude-subagent\`, \`claude-assumed\`) he has not checked, so every number below inherits their error.

## What the pilot can and cannot measure

The deciding metric is **end state** (design section 29). It cannot be measured on these labels:
their arguments are prose ("PR 152 pending review comments"), not typed files, branches and refs.
${typed.length} of ${actItems.length} act items have typed arguments, ${reconstructable.length} have a fixture that can be rebuilt, and
**${endStateCheckable.length}** have both and are not pull requests. So everything here is on **act label accuracy**
(the exact set of acts, the stricter of the act metrics), which bounds end state from above: an
item cannot reach the right end state with the wrong acts.

## The ceiling

What a perfect reader could score on act labels, given what the scorer gives it (the prompt alone,
no prior turns, no fixture):

| | items | share of act items |
|---|---|---|
| act items | ${actItems.length} | 100% |
| the command is named only in the turns before (\`noname-real.jsonl\`: nameIn = prior-turns) | ${needsTurns.length} | ${pc(needsTurns.length / actItems.length)} |
| an act outside the experiment's act set (\`outsideActSet\`) | ${outside.length} | ${pc(outside.length / actItems.length)} |
| a pull-request act (scored on the act label only, design section 29) | ${prOnly.length} | ${pc(prOnly.length / actItems.length)} |
| requests without the command's name (the frozen list, \`namesCommand\`) | ${actItems.filter((it) => !it.kw).length} | ${pc(actItems.filter((it) => !it.kw).length / actItems.length)} |

- **Act label ceiling, prompt only: ${pc(1 - needsTurns.length / actItems.length)}.** Only the no-name items were marked for
  where the name is, so this is an upper bound; other items may lean on earlier turns too.
- **Act label ceiling within the act set: ${pc(1 - new Set([...needsTurns, ...outside]).size / actItems.length)}** (also dropping items with an act outside it).
- **End state ceiling on these labels: ${pc(endStateCheckable.length / actItems.length)}**: what is not typed or not rebuildable cannot be checked.
  End state needs the experiment's gold (testing.md section 5.1), which \`pnpm label\` writes.

## Every system, act items and no-act items

Exact act set on act items (95% Wilson interval), by stratum, and "no act" on the no-act items.
Baselines are as \`scripts/baseline.mjs\` defines them; trained ones by 5-fold cross-validation
with folds by conversation.

| | act items: exact | named | no name | no-act items: none |
|---|---|---|---|---|
${table.map((t) => `| ${t.s.startsWith("Noodle") ? `**${t.s}**` : t.s} | ${cell(t.acts)} | ${pc(t.named.p)} (${t.named.k}/${t.named.n}) | ${pc(t.noName.p)} (${t.noName.k}/${t.noName.n}) | ${pc(t.none.p)} (${t.none.k}/${t.none.n}) |`).join("\n")}

${ARMS.map((a) => `- **Noodle ${a.name}**: ${a.what}. ${(() => {
  const e = errors.get(`Noodle ${a.name}`);
  const crashed = e.filter((r) => r.error.startsWith("crashed"));
  return `${e.length} prompts errored (counted as no act)${crashed.length ? `, of which ${crashed.length} took the process down (out of memory; corpus ids ${crashed.map((r) => r.i).join(", ")}), a runtime bug to fix` : ""}.`;
})()}`).join("\n")}
- **Noodle A+ trained** (the arm go is decided on) **cannot be run yet.** The runtime's perceptron
  learns only from a user's correction in a session (\`Session.correct\` in \`src/runtime/turn.ts\`). What
  is missing is a trainer: for each exploratory label, hear the prompt, take the best reading whose
  acts equal the gold (the latent-variable step of runtime.md 15) and update toward it, by
  cross-validation folds so it is scored like the classifier. Until then A+ zero-shot stands in, and
  training can only add to it.
- **Not run**: the slot filler and the salience ranker (they need typed argument and referent gold,
  above), the language model ceiling and Napkin (scored elsewhere: \`pnpm versus\`).

## The margin

The best Noodle arm is **${noodle.s}** at ${pc(noodle.acts.p)}; the best baseline is **${bestBaseline.s}** at ${pc(bestBaseline.acts.p)};
the best trained classifier is **${bestTrained.s}**. Paired on the ${actItems.length} act items, 10,000 bootstrap
resamples of conversations (project directory and day):

- ${noodle.s} minus command-name match: ${iv(vsName)}
- ${noodle.s} minus ${bestBaseline.s} (the best baseline): ${iv(vsBest)}
${bestTrained.s === bestBaseline.s ? "" : `- ${noodle.s} minus ${bestTrained.s} (the best trained classifier): ${iv(vsTrained)}\n`}- the same against ${bestBaseline.s}, on the ${keal.length} items Keal labelled or checked: ${iv(vsBestKeal)}

## The n for the go decision

Go (design section 29), on end state for A+ trained on the confirmatory set, needs all of: (1) at
least the 60 percent floor; (2) better than command-name match with the slot filler by at least the
margin; (3) not worse than the best trained classifier with the slot filler by more than the
margin; corrected by Holm. Stop is the complement.

Assumptions, every one:

- margin ${MARGIN * 100} points, as the design's example; one-sided alpha ${ALPHA} per test (the 95 percent
  intervals of testing.md section 7), Holm over the ${TESTS3} tests planned at its first step,
  ${HOLM.toFixed(4)}, the conservative case; power ${POWER} per test, or ${JOINT.toFixed(3)} per test for 0.8 that all three pass
  (tests taken as independent);
- paired tests by the normal approximation, n = (z_alpha + z_power)^2 (p_disagree - delta^2) / (delta - bound)^2;
  the floor as a one-sample test of a proportion;
- the rate of disagreeing pairs is the pilot's on act labels (${pc(vsName.disagree)} against name match,
  ${pc(vsTrained.disagree)} against ${bestTrained.s}) but at least the design's ${pc(DISAGREE)}, so ${pc(pdName)} and ${pc(pdTrained)}: the
  pilot's Noodle almost never acts, which makes it agree with any system on most items by both
  being wrong; end state disagrees at least as often as act labels; the deciding run replaces this guess;
- clustering by conversation is ignored in n (the design effect is unknown until there are
  confirmatory conversations), so n is a floor;
- labels are taken as correct.

| | n |
|---|---|
| the design's example: a 10-point difference from zero, 20% disagreeing, alpha 0.025 | ${designN} |
| the same with Holm's first step | ${designNHolm} |
| (2) a true 10-point win over name match, tested against zero (the design's reading) | ${nn(planned.sup)} |
| (2) as written, "better by at least the margin": a true 20-point win tested against 10 | ${nn(planned.supAsWritten)} |
| (3) a true tie with ${bestTrained.s}, tested against minus 10 | ${nn(planned.ni)} |
| (1) a true 70% tested against the 60% floor | ${nn(planned.floor)} |
| **n needed (the largest of (1), (2) as the design reads it, (3)), power 0.8 per test** | **${nn(nNeeded)}** |
| the same with 0.8 that all three pass | ${nn(nNeededJoint)} |
| (2) with the pilot's own effect, ${signed(vsName.diff)} points | ${nn(fromPilot.sup)} |
| (3) with the pilot's own effect, ${signed(vsTrained.diff)} points | ${nn(fromPilot.ni)} |
| (1) with the pilot's own rate, ${pc(noodle.acts.p)} | ${nn(fromPilot.floor)} |

**With the effect the pilot measured, no n reaches go**: Noodle is below name match, more than the
margin below the best trained classifier, and far under the floor, so more items only make stop
more certain. The planned n is what the deciding run needs if Noodle first gets to where the design
assumed; it is the n used for the time below.

## The accrual rate and the time to n

Qualifying means a git or gh request with no act outside the act set, or a constraint on its own.
The share is estimated from the development labels: **${pc(pKw)}** of the ${kwLabelled.length} labelled prompts that contain a
frozen command name qualify, and **${pc(pNon)}** of the ${nonSample.length} randomly sampled prompts without one
(\`sample: "non"\`) do. Rates are on the development side scaled up by its share of prompts (${pc(devShare)}).
The share without a name rests on ${nonSample.filter(qualifies).length} of ${nonSample.length} items, so the prompts with a name alone give a floor:
${(corpusRate.kw * pKw).toFixed(1)}, ${(augRate.kw * pKw).toFixed(1)} and ${(capRate.kw * pKw).toFixed(1)} a week on the three rows below.

| source | weeks | prompts a week | with a command name | qualifying a week |
|---|---|---|---|---|
| the corpus, ${devRows.length ? String(devRows.map((r) => r.at).filter(Boolean).sort()[0]).slice(0, 10) : ""} on | ${corpusWeeks.toFixed(1)} | ${(corpusRate.kw + corpusRate.non).toFixed(1)} | ${corpusRate.kw.toFixed(1)} | **${corpusRate.q.toFixed(1)}** |
| the corpus, August on | ${augWeeks.toFixed(1)} | ${(augRate.kw + augRate.non).toFixed(1)} | ${augRate.kw.toFixed(1)} | **${augRate.q.toFixed(1)}** |
| the capture hook (${caps.length} prompts a person typed) | ${(capDays / 7).toFixed(1)} | ${(capRate.kw + capRate.non).toFixed(1)} | ${capRate.kw.toFixed(1)} | **${capRate.q.toFixed(1)}** |

The capture hook has run for ${capDays.toFixed(1)} days, ${pc(noodleCwd / Math.max(1, caps.length))} of it in the Noodle repository itself, so its rate is a snapshot, not a trend; the corpus rate is the
longer record of the same person's use.

| n | at the capture rate | at the corpus rate since August | at the design's 11 a week |
|---|---|---|---|
| ${nn(designN)} (design example) | ${wk(weeksTo(designN, capRate.q))} | ${wk(weeksTo(designN, augRate.q))} | ${wk(weeksTo(designN, 11))} |
| ${nn(nNeeded)} (needed, Holm) | ${wk(weeksTo(nNeeded, capRate.q))} | ${wk(weeksTo(nNeeded, augRate.q))} | ${wk(weeksTo(nNeeded, 11))} |
| ${nn(nNeededJoint)} (all three at 0.8) | ${wk(weeksTo(nNeededJoint, capRate.q))} | ${wk(weeksTo(nNeededJoint, augRate.q))} | ${wk(weeksTo(nNeededJoint, 11))} |

## The decision PLAN.md asks for

PLAN.md phase 5: "If n cannot be reached in about four months, the domain widens to files in
general now." Four months is about ${FOUR_MONTHS} weeks.

${(() => {
  const w = weeksTo(nNeeded, Math.min(capRate.q, augRate.q));
  const wBest = weeksTo(nNeeded, Math.max(capRate.q, augRate.q));
  if (wBest > FOUR_MONTHS) return `- **n = ${nNeeded} is not reached in four months at either measured rate (${wk(w)} to ${wk(wBest)}): by PLAN.md's rule the domain widens to files in general now, before the freeze.**`;
  if (w > FOUR_MONTHS) return `- **n = ${nNeeded} takes ${wk(wBest)} at the faster measured rate and ${wk(w)} at the slower: four months holds only at the faster one. By PLAN.md's rule, the conservative reading is to widen the domain to files in general now, before the freeze; the alternative is to watch the capture rate for a few weeks first, which costs nothing because the confirmatory set only starts at the freeze.**`;
  return `- **n = ${nNeeded} is reached in ${wk(wBest)} to ${wk(w)} at the measured rates (${wk(weeksTo(nNeeded, Math.min(capRate.kw, augRate.kw) * pKw))} counting only prompts with a name at the slower one): "about four months" holds and the domain does not need to widen for n.**`;
})()}
- Widening does not touch the other finding: on today's system the pilot's own effect gives no n at
  all. Go needs Noodle to get from ${pc(noodle.acts.p)} to above the floor and past the trained baselines first;
  freezing now would be scoring a known stop.
`;
writeFileSync(join(here, "..", "docs", "pilot.md"), md);
console.log(md);
