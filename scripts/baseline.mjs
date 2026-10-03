// The act baselines (design section 29; PLAN.md phase 5; testing.md section 7), on the same labels
// and the same development side of the split as scripts/acts.mjs (never the holdout in
// ~/.noodle/experiment/split.json), with the same knowledge Noodle has where a baseline can use it
// (the commands learned from the man pages, the WordNet pack).
//   node scripts/baseline.mjs [--json [--items]]
//
// - name: every learned command whose name appears in the prompt as words, in order.
// - bm25: BM25 from the prompt to each command's man page; the top command, or nothing under a
//   threshold (cross-validated); "always top" takes the top command whatever its score. `bm25+wn`
//   expands the prompt and the pages by WordNet synonyms and hypernyms.
// - knn: the label set of the nearest labelled prompt (TF-IDF cosine).
// - classifier: one-vs-rest logistic regression on the prompt's words; `+man` adds each command's
//   man-page similarity as features; `+man+wn` also expands by WordNet.
// Trained baselines and thresholds are scored by 5-fold cross-validation, folds by conversation (the
// split's key: project directory and day), so no prompt is scored by a model that saw it or its
// conversation.
//
// The models are in scripts/baselines/lib/models.mjs, shared with the decide baselines
// (scripts/baselines/*.mjs), which add the slot filler (scripts/baselines/lib/slots.mjs). Not run
// here: the slot filler and the salience ranker need typed argument and referent gold (files,
// branches, refs against a fixture), which the exploratory labels do not have (their targets are
// prose); they run on the experiment's gold (testing.md section 5.1).
import { join } from "node:path";
import { devLabels, fold } from "./devset.mjs";
import { Bm25, commandsOf, featurizer, knn, logistic, nameMatch as matchNames, pagesOf, tokens, wordnetOf } from "./baselines/lib/models.mjs";

const dist = join(import.meta.dirname, "..", "dist");
const { packedStore } = await import(join(dist, "assistant", "index.js"));

const labels = devLabels({ maxWords: 150 }).filter((l) => !l.tooLong);
const key = (a) => `${a.program ?? ""} ${a.sub ?? ""}`.trim();
const items = labels.map((l) => ({
  i: l.i,
  cls: l.class,
  text: l.text,
  want: [...new Set((l.acts ?? []).map(key).filter(Boolean))],
  namesCommand: l.namesCommand,
  fold: fold(l.row),
}));

// The learned commands (every reading from a tool's documentation that becomes Run), their man
// pages, and WordNet expansion, from the same store Noodle uses (scripts/baselines/lib/models.mjs).
const store = packedStore();
const commands = commandsOf(store);
const expand = wordnetOf(store);

// ---- baselines; each returns, per item, the ordered act keys it predicts

const nameMatch = (it) => matchNames(it.text, commands);

const pages = pagesOf(commands);
const pagesFound = pages.filter((p) => p.text.split(/\s+/).length > 20).length;

/** Picks the threshold over training scores that maximizes accuracy (top act right, or nothing on none). */
function threshold(scored) {
  const cands = [...new Set(scored.map((x) => x.s))].sort((a, b) => a - b);
  let best = { t: Infinity, acc: -1 };
  for (const t of [0, ...cands, Infinity]) {
    const acc = scored.filter((x) => (x.s >= t && t !== Infinity ? x.cls === "acts" && x.want.includes(x.top) : x.cls === "none")).length;
    if (acc > best.acc) best = { t, acc };
  }
  return best.t;
}

function bm25Baseline(wn, always = false) {
  const prep = (t) => (wn ? expand(tokens(t)) : tokens(t));
  const index = new Bm25(pages.map((p) => ({ id: p.id, toks: prep(p.text) })));
  const scored = items.map((it) => {
    const r = index.rank(prep(it.text));
    return { ...it, top: r[0]?.id, s: r[0]?.s ?? 0, top3: r.slice(0, 3).map((x) => x.id) };
  });
  return items.map((it, k) => {
    const t = always ? 0 : threshold(scored.filter((x) => x.fold !== it.fold));
    const x = scored[k];
    return { got: x.s > 0 && x.s >= t ? [x.top] : [], top3: x.top3 };
  });
}

function knnBaseline() {
  return items.map((it) => ({ got: knn(items.filter((x) => x.fold !== it.fold))(it.text) }));
}

/** One-vs-rest logistic regression on the words (models.mjs logistic), by fold. */
function classifierBaseline({ man = false, wn = false }) {
  const feat = featurizer({ pages, man, expand: wn ? expand : undefined });
  const feats = items.map((it) => feat(it.text));
  const wants = items.map((it) => it.want);
  const out = new Array(items.length);
  for (let f = 0; f < 5; f++) {
    const predict = logistic(feats, wants, items.map((x, k) => k).filter((k) => items[k].fold !== f), f * 31);
    for (let k = 0; k < items.length; k++) if (items[k].fold === f) out[k] = { got: predict(feats[k]) };
  }
  return out;
}

// ---- scoring, as scripts/acts.mjs scores Noodle

function score(preds) {
  const rows = items.map((it, k) => {
    const got = preds[k].got;
    return { cls: it.cls, namesCommand: it.namesCommand, exact: it.want.length === got.length && it.want.every((w) => got.includes(w)), first: it.want.length > 0 && got[0] === it.want[0], any: got.some((g) => it.want.includes(g)), top3: preds[k].top3?.some((g) => it.want.includes(g)), acted: got.length > 0 };
  });
  const acts = rows.filter((r) => r.cls === "acts");
  const none = rows.filter((r) => r.cls === "none");
  const noName = acts.filter((r) => r.namesCommand === false);
  const pct = (xs, f) => ({ n: xs.filter(f).length, of: xs.length });
  return {
    actsExact: pct(acts, (r) => r.exact),
    actsFirst: pct(acts, (r) => r.first),
    actsAny: pct(acts, (r) => r.any),
    noneCorrect: pct(none, (r) => !r.acted),
    falseActs: pct(none, (r) => r.acted),
    noNameFirst: pct(noName, (r) => r.first),
    ...(preds[0].top3 ? { actsTop3: pct(acts, (r) => r.top3) } : {}),
  };
}

const preds = {
  name: items.map((it) => ({ got: nameMatch(it) })),
  bm25: bm25Baseline(false),
  "bm25 (always top)": bm25Baseline(false, true),
  "bm25+wn": bm25Baseline(true),
  "bm25+wn (always top)": bm25Baseline(true, true),
  knn: knnBaseline(),
  classifier: classifierBaseline({}),
  "classifier+man": classifierBaseline({ man: true }),
  "classifier+man+wn": classifierBaseline({ man: true, wn: true }),
};
const report = {
  labelled: items.length,
  manPages: `${pagesFound}/${pages.length}`,
  baselines: Object.fromEntries(Object.entries(preds).map(([name, p]) => [name, score(p)])),
  // Per item, what each baseline chose (for the pilot's paired comparisons): ids, never prompts.
  ...(process.argv.includes("--items") ? { items: items.map((it, k) => ({ i: it.i, got: Object.fromEntries(Object.entries(preds).map(([name, p]) => [name, p[k].got])) })) } : {}),
};
const fmt = ({ n, of }) => `${of ? ((100 * n) / of).toFixed(1) : "0.0"}% (${n}/${of})`;
if (process.argv.includes("--json")) console.log(JSON.stringify(report));
else {
  console.log(`labelled ${report.labelled}, man pages found ${report.manPages}`);
  for (const [name, r] of Object.entries(report.baselines)) {
    console.log(`\n${name}`);
    for (const [k, v] of Object.entries(r)) console.log(`  ${k.padEnd(12)} ${fmt(v)}`);
  }
}
