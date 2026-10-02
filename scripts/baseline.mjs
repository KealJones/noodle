// The act baselines (design section 29; PLAN.md phase 5; testing.md section 7), on the same labels
// and the same development side of the split as scripts/acts.mjs (never the holdout in
// ~/.noodle/experiment/split.json), with the same knowledge Noodle has where a baseline can use it
// (the commands learned from the man pages, the WordNet pack).
//   node scripts/baseline.mjs [--json]
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
// Not run here: the slot filler and the salience ranker need typed argument and referent gold
// (files, branches, refs against a fixture), which the exploratory labels do not have (their
// targets are prose); they run on the experiment's gold (testing.md section 5.1) once it exists.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  (l) => typeof l.i === "number" && !holdout.has(l.i) && l.verdict !== "drop" && (l.class === "acts" || l.class === "none") && all[l.i]?.text && all[l.i].text.split(/\s+/).length <= 150 && !all[l.i].text.trimStart().startsWith("<heartbeat>"),
);
const key = (a) => `${a.program ?? ""} ${a.sub ?? ""}`.trim();
const items = labels.map((l) => ({
  i: l.i,
  cls: l.class,
  text: all[l.i].text,
  want: [...new Set((l.acts ?? []).map(key).filter(Boolean))],
  namesCommand: l.namesCommand,
  fold: createHash("sha256").update(`${all[l.i].where ?? ""}|${String(all[l.i].at ?? "").slice(0, 10)}`).digest().readUInt32BE(0) % 5,
}));

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
const actOf = (a) => `${a.program} ${a.sub}`;

// ---- text

const tokens = (t) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
const wnCache = new Map();
/** A word's WordNet synonyms and direct hypernyms, as single words. */
function wordnet(w) {
  let out = wnCache.get(w);
  if (out) return out;
  out = new Set();
  const lemmas = (concept) => store.facts(concept, "Lemma").map((f) => positional(f.claim)[0]?.value).filter((x) => typeof x === "string" && !/\s/.test(x));
  for (const hit of store.lookup(w))
    for (const sf of store.facts(hit.concept, "Sense")) {
      const sense = positional(sf.claim)[0]?.head;
      if (!sense) continue;
      const synsets = [sense, ...store.facts(sense, "IsA").map((f) => positional(f.claim)[0]?.head).filter(Boolean)];
      for (const sy of synsets)
        for (const m of store.facts(sy, "SenseOf")) for (const l of lemmas(positional(m.claim)[0]?.head)) if (l.toLowerCase() !== w) out.add(l.toLowerCase());
    }
  wnCache.set(w, out);
  return out;
}
const expand = (toks) => [...toks, ...[...new Set(toks)].flatMap((w) => [...wordnet(w)])];

function manPage(program, sub) {
  try {
    const raw = execFileSync("man", ["-P", "cat", `${program}-${sub}`], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 << 20 });
    return raw.replace(/.\x08/g, "");
  } catch {
    return "";
  }
}

class Bm25 {
  constructor(docs, k1 = 1.2, b = 0.75) {
    this.docs = docs.map((d) => {
      const tf = new Map();
      for (const w of d.toks) tf.set(w, (tf.get(w) ?? 0) + 1);
      return { id: d.id, tf, len: d.toks.length };
    });
    this.avg = this.docs.reduce((n, d) => n + d.len, 0) / Math.max(1, this.docs.length);
    this.df = new Map();
    for (const d of this.docs) for (const w of d.tf.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1);
    Object.assign(this, { k1, b });
  }
  idf(w) {
    const n = this.df.get(w) ?? 0;
    return Math.log(1 + (this.docs.length - n + 0.5) / (n + 0.5));
  }
  rank(q) {
    const qs = [...new Set(q)];
    return this.docs
      .map((d) => {
        let s = 0;
        for (const w of qs) {
          const f = d.tf.get(w);
          if (f) s += (this.idf(w) * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / this.avg));
        }
        return { id: d.id, s };
      })
      .sort((a, z) => z.s - a.s);
  }
}

class Tfidf {
  constructor(docs) {
    this.df = new Map();
    for (const d of docs) for (const w of new Set(d)) this.df.set(w, (this.df.get(w) ?? 0) + 1);
    this.n = docs.length;
  }
  vec(toks) {
    const tf = new Map();
    for (const w of toks) tf.set(w, (tf.get(w) ?? 0) + 1);
    const v = new Map();
    let norm = 0;
    for (const [w, f] of tf) {
      const x = (1 + Math.log(f)) * Math.log((this.n + 1) / ((this.df.get(w) ?? 0) + 1));
      if (x > 0) v.set(w, x), (norm += x * x);
    }
    norm = Math.sqrt(norm) || 1;
    for (const [w, x] of v) v.set(w, x / norm);
    return v;
  }
}
const cosine = (a, b) => {
  let s = 0;
  for (const [w, x] of a.size < b.size ? a : b) s += x * ((a.size < b.size ? b : a).get(w) ?? 0);
  return s;
};

// ---- baselines; each returns, per item, the ordered act keys it predicts

function nameMatch(it) {
  const toks = it.text.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
  const got = [];
  for (let i = 0; i < toks.length; i++)
    for (const [name, act] of commands) if (name.split(" ").every((p, k) => toks[i + k] === p)) got.push(actOf(act));
  return [...new Set(got)];
}

const pages = [...commands.values()].map((act) => ({ id: actOf(act), text: `${act.program} ${act.sub.replace(/-/g, " ")} ${manPage(act.program, act.sub)}` }));
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
  return items.map((it) => {
    const train = items.filter((x) => x.fold !== it.fold);
    const tf = new Tfidf(train.map((x) => tokens(x.text)));
    const q = tf.vec(tokens(it.text));
    let best;
    for (const x of train) {
      const s = cosine(q, tf.vec(tokens(x.text)));
      if (!best || s > best.s) best = { s, x };
    }
    return { got: best ? best.x.want : [] };
  });
}

/** One-vs-rest logistic regression, sparse features, plain SGD with L2. */
function classifierBaseline({ man = false, wn = false }) {
  const prep = (t) => (wn ? expand(tokens(t)) : tokens(t));
  const pageTf = man ? new Tfidf(pages.map((p) => prep(p.text))) : undefined;
  const pageVecs = man ? pages.map((p) => ({ id: p.id, v: pageTf.vec(prep(p.text)) })) : [];
  const feats = items.map((it) => {
    const f = new Map();
    for (const w of new Set(prep(it.text))) f.set(`w:${w}`, 1);
    if (man) {
      const q = pageTf.vec(prep(it.text));
      for (const p of pageVecs) {
        const s = cosine(q, p.v);
        if (s > 0) f.set(`m:${p.id}`, s * 5);
      }
    }
    f.set("bias", 1);
    return f;
  });
  const out = new Array(items.length);
  for (let fold = 0; fold < 5; fold++) {
    const train = items.map((x, k) => k).filter((k) => items[k].fold !== fold);
    const classes = [...new Set(train.flatMap((k) => items[k].want))];
    const models = classes.map((cl) => {
      const w = new Map();
      for (let epoch = 0; epoch < 15; epoch++) {
        const rate = 0.5 / (1 + epoch);
        for (const k of shuffled(train, epoch + fold * 31)) {
          const y = items[k].want.includes(cl) ? 1 : 0;
          let z = 0;
          for (const [name, x] of feats[k]) z += (w.get(name) ?? 0) * x;
          const g = 1 / (1 + Math.exp(-z)) - y;
          for (const [name, x] of feats[k]) w.set(name, (w.get(name) ?? 0) * (1 - rate * 1e-4) - rate * g * x);
        }
      }
      return { cl, w };
    });
    for (let k = 0; k < items.length; k++) {
      if (items[k].fold !== fold) continue;
      const probs = models.map(({ cl, w }) => {
        let z = 0;
        for (const [name, x] of feats[k]) z += (w.get(name) ?? 0) * x;
        return { cl, p: 1 / (1 + Math.exp(-z)) };
      });
      out[k] = { got: probs.filter((x) => x.p >= 0.5).sort((a, b) => b.p - a.p).map((x) => x.cl) };
    }
  }
  return out;
}
function shuffled(xs, seed) {
  const a = [...xs];
  let s = seed + 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

const report = {
  labelled: items.length,
  manPages: `${pagesFound}/${pages.length}`,
  baselines: {
    name: score(items.map((it) => ({ got: nameMatch(it) }))),
    bm25: score(bm25Baseline(false)),
    "bm25 (always top)": score(bm25Baseline(false, true)),
    "bm25+wn": score(bm25Baseline(true)),
    "bm25+wn (always top)": score(bm25Baseline(true, true)),
    knn: score(knnBaseline()),
    classifier: score(classifierBaseline({})),
    "classifier+man": score(classifierBaseline({ man: true })),
    "classifier+man+wn": score(classifierBaseline({ man: true, wn: true })),
  },
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
