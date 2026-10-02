// Rewriting (runtime.md section 7): an expression is rewritten by the readings whose patterns
// match it, outermost first, then its arguments, until no reading applies. Every application with
// more than one candidate is a choice point; the alternatives are kept in a beam and scored. Opaque
// nodes are not rewritten. An expression no reading applies to stays as it is: unworked is a value.

import { type Call, type Expr, isCall, isVar, key, positional, role } from "./expr.js";
import { carry, instantiate, match, type Bindings } from "./match.js";
import { type Features, addFeature, mergeFeatures, scoreOf } from "./score.js";
import { type ReadingItem, type Store, readingKey } from "./store.js";
import { STRUCTURAL_NAMES } from "../structural.js";

export type Mode = "Doing" | "Speaking" | "Supposing";

export interface Step {
  reading: number;
  owner: string;
  before: Expr;
  after: Expr;
  /** The reading's source (its trust is looked up from it, runtime.md 13) and its stable key. */
  from: Expr;
  key: string;
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

  /** Alternatives already worked out for an expression, within one normalize call. */
  private memo = new Map<string, Omit<Derivation, "score">[]>();

  normalize(e: Expr): Derivation[] {
    this.memo = new Map();
    const out = this.norm(e, 0, new Set());
    return out
      .map((d) => {
        const features = mergeFeatures(d.features, new Map([["Unworked", -this.unread(d.expr)]]));
        return { ...d, features, score: scoreOf(features, this.weights) };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Expressions left that have readings of their own, none of which applied: a word that should
   * have been read and was not ("yet" left inside a rule). Unworked, by the definition of section
   * 7; structural heads and opaque nodes do not count.
   */
  unread(e: Expr): number {
    if (!isCall(e) || OPAQUE.has(e.head)) return 0;
    const own = !STRUCTURAL_NAMES.has(e.head) && this.store.readingsOn(e.head).some((r) => !r.mode && r.owner !== "Segment") ? 1 : 0;
    return own + e.args.reduce((n, a) => n + this.unread(a.value), 0);
  }

  private norm(e: Expr, depth: number, seen: Set<string>): Omit<Derivation, "score">[] {
    if (!isCall(e) || OPAQUE.has(e.head) || depth > this.opts.maxSteps) return [{ expr: e, features: new Map(), steps: [] }];
    const k = key(e);
    if (seen.has(k)) return [{ expr: e, features: new Map(), steps: [] }];
    // The same expression reached again (through another alternative) has the same alternatives:
    // work them out once, or the beam's branching is worked out again at every level.
    const have = this.memo.get(k);
    if (have) return have;
    const out = this.normFresh(e, k, depth, seen);
    this.memo.set(k, out);
    return out;
  }

  private normFresh(e: Call, k: string, depth: number, seen: Set<string>): Omit<Derivation, "score">[] {
    const seen2 = new Set(seen).add(k);
    const cands = this.candidates(e);
    const alts: Omit<Derivation, "score">[] = [];
    for (const { r, b, result } of cands) {
      const step: Step = { reading: r.meta.id, owner: r.owner, before: e, after: result, from: r.meta.from, key: readingKey(r) };
      const own = this.wantFeatures(r, b);
      addFeature(own, `Evidence:${readingKey(r)}`, 1);
      for (const d of this.norm(result, depth + 1, seen2)) alts.push({ expr: d.expr, features: mergeFeatures(own, d.features), steps: [step, ...d.steps] });
    }
    // Leaving this node as it is, and reading its arguments, is an alternative too: a reading
    // that applies here is a choice, not an obligation (an inner "is in" may be part of an outer
    // "cause to be in" rather than a question of its own).
    alts.push(...this.args(e, k, depth, seen2));
    return this.top(alts);
  }

  private args(e: Call, k: string, depth: number, seen2: Set<string>): Omit<Derivation, "score">[] {
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
    // The beam ranks by what the alternative would score as a finished derivation, unread
    // expressions included, so a fully read alternative is not cut on a tie.
    return alts
      .map((a) => ({ a, s: scoreOf(a.features, this.weights) + this.weights("Unworked") * -this.unread(a.expr) }))
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
