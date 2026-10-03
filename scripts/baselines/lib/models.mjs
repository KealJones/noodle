// The act baselines' models (design section 29; testing.md section 7), shared by scripts/baseline.mjs
// (the pilot's cross-validated numbers) and the decide baselines in scripts/baselines/ (trained on
// the development labels, predicting confirmatory items). Each predicts act labels ("git push",
// "gh pr-view", "read"); the slot filler (slots.mjs) gives them arguments.
import { execFileSync } from "node:child_process";
import { isCall, positional } from "../../../dist/runtime/expr.js";

export const tokens = (t) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
export const actOf = (a) => `${a.program} ${a.sub}`;

/** The learned commands: every reading from a tool's documentation that becomes Run. */
export function commandsOf(store) {
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
  return commands;
}

/** A word's WordNet synonyms and direct hypernyms, as single words, from the store's WordNet pack. */
export function wordnetOf(store) {
  const cache = new Map();
  const wordnet = (w) => {
    let out = cache.get(w);
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
    cache.set(w, out);
    return out;
  };
  return (toks) => [...toks, ...[...new Set(toks)].flatMap((w) => [...wordnet(w)])];
}

export function manPage(program, sub) {
  try {
    const raw = execFileSync("man", ["-P", "cat", `${program}-${sub}`], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 << 20 });
    return raw.replace(/.\x08/g, "");
  } catch {
    return "";
  }
}

/** Each command's page: its name and its man page. */
export const pagesOf = (commands) => [...commands.values()].map((act) => ({ id: actOf(act), text: `${act.program} ${act.sub.replace(/-/g, " ")} ${manPage(act.program, act.sub)}` }));

/** Command-name match: every learned command whose name appears in the prompt as words, in order. */
export function nameMatch(text, commands) {
  const toks = text.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
  const got = [];
  for (let i = 0; i < toks.length; i++)
    for (const [name, act] of commands) if (name.split(" ").every((p, k) => toks[i + k] === p)) got.push(actOf(act));
  return [...new Set(got)];
}

export class Bm25 {
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

export class Tfidf {
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
export const cosine = (a, b) => {
  let s = 0;
  for (const [w, x] of a.size < b.size ? a : b) s += x * ((a.size < b.size ? b : a).get(w) ?? 0);
  return s;
};

/** Nearest neighbour: the label set of the most similar training prompt (TF-IDF cosine). */
export function knn(train) {
  const tf = new Tfidf(train.map((x) => tokens(x.text)));
  const vecs = train.map((x) => tf.vec(tokens(x.text)));
  return (text) => {
    const q = tf.vec(tokens(text));
    let best;
    vecs.forEach((v, k) => {
      const s = cosine(q, v);
      if (!best || s > best.s) best = { s, k };
    });
    return best ? train[best.k].want : [];
  };
}

/** A featurizer for the word classifier: the prompt's words, with `man` each page's similarity, with `expand` WordNet. */
export function featurizer({ pages = [], man = false, expand } = {}) {
  const prep = (t) => (expand ? expand(tokens(t)) : tokens(t));
  const pageTf = man ? new Tfidf(pages.map((p) => prep(p.text))) : undefined;
  const pageVecs = man ? pages.map((p) => ({ id: p.id, v: pageTf.vec(prep(p.text)) })) : [];
  return (text) => {
    const f = new Map();
    for (const w of new Set(prep(text))) f.set(`w:${w}`, 1);
    if (man) {
      const q = pageTf.vec(prep(text));
      for (const p of pageVecs) {
        const s = cosine(q, p.v);
        if (s > 0) f.set(`m:${p.id}`, s * 5);
      }
    }
    f.set("bias", 1);
    return f;
  };
}

export function shuffled(xs, seed) {
  const a = [...xs];
  let s = seed + 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * One-vs-rest logistic regression, sparse features, plain SGD with L2, 15 epochs. `feats[k]` and
 * `wants[k]` for every k in `train`; returns a predictor over a feature map (labels at p >= 0.5,
 * most probable first).
 */
export function logistic(feats, wants, train, seed = 0) {
  const classes = [...new Set(train.flatMap((k) => wants[k]))];
  const models = classes.map((cl) => {
    const w = new Map();
    for (let epoch = 0; epoch < 15; epoch++) {
      const rate = 0.5 / (1 + epoch);
      for (const k of shuffled(train, epoch + seed)) {
        const y = wants[k].includes(cl) ? 1 : 0;
        let z = 0;
        for (const [name, x] of feats[k]) z += (w.get(name) ?? 0) * x;
        const g = 1 / (1 + Math.exp(-z)) - y;
        for (const [name, x] of feats[k]) w.set(name, (w.get(name) ?? 0) * (1 - rate * 1e-4) - rate * g * x);
      }
    }
    return { cl, w };
  });
  return (f) =>
    models
      .map(({ cl, w }) => {
        let z = 0;
        for (const [name, x] of f) z += (w.get(name) ?? 0) * x;
        return { cl, p: 1 / (1 + Math.exp(-z)) };
      })
      .filter((x) => x.p >= 0.5)
      .sort((a, b) => b.p - a.p)
      .map((x) => x.cl);
}
