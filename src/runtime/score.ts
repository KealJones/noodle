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
  }

  get = (name: string): number => {
    const l = this.learned.get(name);
    if (l !== undefined) return l;
    return this.template.get(name.split(":")[0]) ?? 0;
  };

  /** The perceptron's capped update (runtime.md section 15): move toward good, away from bad. */
  update(good: Features, bad: Features, rate = 1, cap = 1) {
    const names = new Set([...good.keys(), ...bad.keys()]);
    for (const n of names) {
      const d = ((good.get(n) ?? 0) - (bad.get(n) ?? 0)) * rate;
      if (!d) continue;
      const step = Math.max(-cap, Math.min(cap, d));
      this.learned.set(n, this.get(n) + step);
    }
  }
}

/** One choice point in the reasons log (runtime.md section 8.3). */
export interface ChoicePoint {
  what: string;
  candidates: { label: string; features: [string, number][]; score: number }[];
  winner: number;
}
