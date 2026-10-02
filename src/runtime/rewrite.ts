// Rewriting (runtime.md section 7): an expression is rewritten by the readings whose patterns
// match it, outermost first, then its arguments, until no reading applies. Every application with
// more than one candidate is a choice point; the alternatives are kept in a beam and scored. Opaque
// nodes are not rewritten. An expression no reading applies to stays as it is: unworked is a value.

import { type Call, type Expr, isCall, isVar, key, positional, role } from "./expr.js";
import { carry, instantiate, match, type Bindings } from "./match.js";
import { type Features, addFeature, mergeFeatures, scoreOf } from "./score.js";
import type { ReadingItem, Store } from "./store.js";

export type Mode = "Doing" | "Speaking" | "Supposing";

export interface Step {
  reading: number;
  owner: string;
  before: Expr;
  after: Expr;
}

export interface Derivation {
  expr: Expr;
  features: Features;
  steps: Step[];
  score: number;
}

export interface RewriteOptions {
  mode: Mode;
  beam: number;
  /** Rewrite steps on one path (runtime.md 7: a stated, tunable budget). */
  maxSteps: number;
}

/** Heads whose arguments are content, never rewritten (logical-form.md section 5). */
const OPAQUE = new Set(["Quote", "Mention", "Block", "Ref"]);

export class Rewriter {
  constructor(
    readonly store: Store,
    readonly weights: (f: string) => number,
    readonly opts: RewriteOptions = { mode: "Doing", beam: 6, maxSteps: 32 },
  ) {}

  /** Readings that may apply to e in this mode, with their matches. */
  candidates(e: Expr): { r: ReadingItem; b: Bindings; result: Expr }[] {
    if (!isCall(e)) return [];
    const out: { r: ReadingItem; b: Bindings; result: Expr }[] = [];
    for (const r of this.store.readingsFor(e.head)) {
      if (!r.becomes || (r.mode && r.mode !== this.opts.mode)) continue;
      // Lexical rules (patterns over chart categories) run in the chart, not here.
      if (r.owner === "Segment") continue;
      const m = match(r.pattern, e, this.store);
      if (!m) continue;
      const result = carry(instantiate(r.becomes, m.bindings), m.extra);
      if (key(result) === key(e)) continue;
      out.push({ r, b: m.bindings, result });
    }
    return out;
  }

  /** The value of a reading's wants as features (runtime.md 8.1: WantedKind, ShapeFit). */
  wantFeatures(r: ReadingItem, b: Bindings): Features {
    const f: Features = new Map();
    for (const w of r.wants) {
      if (!isCall(w)) continue;
      const [x, k] = positional(w).map((a) => (isVar(a) ? b.get(a.text) : a));
      if (w.head === "IsA" && isCall(x) && isCall(k)) {
        const d = this.store.kindDistance(x.head, k.head);
        addFeature(f, "WantedKind", d === undefined ? -4 : -d);
      }
    }
    return f;
  }

  normalize(e: Expr): Derivation[] {
    const out = this.norm(e, 0, new Set());
    return out.map((d) => ({ ...d, score: scoreOf(d.features, this.weights) })).sort((a, b) => b.score - a.score);
  }

  private norm(e: Expr, depth: number, seen: Set<string>): Omit<Derivation, "score">[] {
    if (!isCall(e) || OPAQUE.has(e.head) || depth > this.opts.maxSteps) return [{ expr: e, features: new Map(), steps: [] }];
    const k = key(e);
    if (seen.has(k)) return [{ expr: e, features: new Map(), steps: [] }];
    const seen2 = new Set(seen).add(k);
    const cands = this.candidates(e);
    if (cands.length) {
      const alts: Omit<Derivation, "score">[] = [];
      for (const { r, b, result } of cands) {
        const step: Step = { reading: r.meta.id, owner: r.owner, before: e, after: result };
        const own = this.wantFeatures(r, b);
        addFeature(own, `Evidence:${r.meta.id}`, 1);
        for (const d of this.norm(result, depth + 1, seen2))
          alts.push({ expr: d.expr, features: mergeFeatures(own, d.features), steps: [step, ...d.steps] });
      }
      return this.top(alts);
    }
    // No reading at the top: rewrite the arguments, then look at the top again.
    let combos: Omit<Derivation, "score">[] = [{ expr: e, features: new Map(), steps: [] }];
    e.args.forEach((a, i) => {
      const alts = this.norm(a.value, depth + 1, seen2);
      const next: Omit<Derivation, "score">[] = [];
      for (const cmb of combos)
        for (const alt of alts) {
          const call = cmb.expr as Call;
          const args = call.args.slice();
          args[i] = { ...args[i], value: alt.expr };
          next.push({ expr: { ...call, args }, features: mergeFeatures(cmb.features, alt.features), steps: [...cmb.steps, ...alt.steps] });
        }
      combos = this.top(next);
    });
    const out: Omit<Derivation, "score">[] = [];
    for (const cmb of combos) {
      if (key(cmb.expr) !== k && this.candidates(cmb.expr).length)
        for (const d of this.norm(cmb.expr, depth + 1, seen2)) out.push({ expr: d.expr, features: mergeFeatures(cmb.features, d.features), steps: [...cmb.steps, ...d.steps] });
      else out.push(cmb);
    }
    return this.top(out);
  }

  private top(alts: Omit<Derivation, "score">[]): Omit<Derivation, "score">[] {
    const seen = new Set<string>();
    return alts
      .map((a) => ({ a, s: scoreOf(a.features, this.weights) }))
      .sort((x, y) => y.s - x.s)
      .filter(({ a }) => {
        const k = key(a.expr);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, this.opts.beam)
      .map(({ a }) => a);
  }
}

export { role };
