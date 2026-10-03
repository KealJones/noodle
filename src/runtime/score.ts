// The score (runtime.md section 8): log-linear over named features. A feature's name is its
// template, then its key ("WordsUsed:Skipped:Unknown"). Weights are data: the seed gives each
// template a starting weight (seed/weights.ncon) that applies to all its features; learning sets
// weights per feature. Every choice point is recorded with its candidates and features.

import { isCall, positional } from "./expr.js";
import type { Store } from "./store.js";

export type Features = Map<string, number>;

export function addFeature(f: Features, name: string, value: number) {
  f.set(name, (f.get(name) ?? 0) + value);
}

export function mergeFeatures(...fs: Features[]): Features {
  const out: Features = new Map();
  for (const f of fs) for (const [k, v] of f) addFeature(out, k, v);
  return out;
}

export function scoreOf(f: Features, w: (name: string) => number): number {
  let s = 0;
  for (const [k, v] of f) s += w(k) * v;
  return s;
}

export class Weights {
  private template = new Map<string, number>();
  readonly learned = new Map<string, number>();

  constructor(store: Store) {
    for (const f of store.factsWithHead("Weight")) {
      const x = positional(f.claim as never)[0];
      if (x && x.kind === "number" && isCall(f.claim)) this.template.set(f.subject, x.value);
    }
    this.loadLearned(store);
  }

  get = (name: string): number => {
    const l = this.learned.get(name);
    if (l !== undefined) return l;
    return this.template.get(name) ?? this.template.get(name.split(":")[0]) ?? 0;
  };

  /** Learned weights as N-Con facts on Feature concepts, for keeping across sessions. */
  toNcon(): string {
    const lines = ['Pack(name="learned-weights", version="1", from=Correction())'];
    for (const [name, w] of [...this.learned].sort()) lines.push(`Fact(Feature(), Weight(${JSON.stringify(name)}, ${w}))`);
    return lines.join("\n\n") + "\n";
  }

  /** Reads weights written by toNcon back. */
  loadLearned(store: Store) {
    for (const f of store.facts("Feature", "Weight")) {
      const [name, w] = positional(f.claim as never);
      if (name?.kind !== "string" || w?.kind !== "number") continue;
      // A feature's starting weight from the seed is where it starts, not something learned.
      if (isCall(f.meta.from) && f.meta.from.head === "Seed") this.template.set(name.value, w.value);
      else this.learned.set(name.value, w.value);
    }
  }

  /**
   * The perceptron's capped update (runtime.md section 15): move toward good, away from bad. A
   * feature about one thing (a template with an instance, "Evidence:..." or "WordsUsed:...") moves
   * a whole step; a template feature, which every reading shares, moves a quarter, so one
   * correction cannot erase what the seed weighs everywhere. The features about one thing keep
   * stepping (a few times at most) until the corrected reading wins, since the user said so.
   */
  update(good: Features, bad: Features, rate = 1, cap = 1): Map<string, number | undefined> {
    const before = new Map<string, number | undefined>();
    const names = [...new Set([...good.keys(), ...bad.keys()])].filter((n) => (good.get(n) ?? 0) !== (bad.get(n) ?? 0));
    const step = (n: string, c: number) => {
      const d = ((good.get(n) ?? 0) - (bad.get(n) ?? 0)) * rate;
      if (!before.has(n)) before.set(n, this.learned.get(n));
      this.learned.set(n, this.get(n) + Math.max(-c, Math.min(c, d)));
    };
    for (const n of names) step(n, n.includes(":") ? cap : cap / 4);
    const own = names.filter((n) => n.includes(":"));
    for (let i = 0; own.length && i < 4 && scoreOf(good, this.get) <= scoreOf(bad, this.get); i++) for (const n of own) step(n, cap);
    return before;
  }

  /** A copy, so a change can be compared with the weights before it. */
  clone(): Weights {
    const w = Object.create(Weights.prototype) as Weights;
    Object.assign(w, { template: this.template, learned: new Map(this.learned) });
    w.get = (name: string) => {
      const l = w.learned.get(name);
      if (l !== undefined) return l;
      return this.template.get(name) ?? this.template.get(name.split(":")[0]) ?? 0;
    };
    return w;
  }

  /** Puts back the weights an update changed (the replay gate's veto, testing.md section 4). */
  revert(before: Map<string, number | undefined>) {
    for (const [n, w] of before) {
      if (w === undefined) this.learned.delete(n);
      else this.learned.set(n, w);
    }
  }
}

/** One choice point in the reasons log (runtime.md section 8.3). */
export interface ChoicePoint {
  what: string;
  candidates: { label: string; features: [string, number][]; score: number }[];
  winner: number;
}
