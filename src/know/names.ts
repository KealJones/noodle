// Naming imported concepts (ncon.md section 2.1). A word concept is its capitalized lemma, encoded:
// letters and digits kept, each other character dropped and the next letter capitalized ("e-mail"
// is EMail, "don't" is Dont). A lemma that encodes to nothing usable is named opaquely (ncon.md
// open question 1). Lookup is always by lemma, never by name.
//
// An imported lemma the seed already has a concept for is that concept (seed/README.md, decision
// 1: a core meaning is its exponent's word). A lemma whose name is a structural concept the seed
// does not give that lemma (a primitive like Run, a fact head like Form) gets the next free name,
// so the word "run" is not the primitive: the primitive is reached through readings.

import { isCall, positional } from "../runtime/expr.js";
import type { Store } from "../runtime/store.js";
import { STRUCTURAL_NAMES } from "../structural.js";

export function encodeLemma(lemma: string): string | undefined {
  let out = "";
  let up = true;
  for (const ch of lemma.normalize("NFKD").replace(/\p{M}/gu, "")) {
    if (ch === "'" || ch === "\u2019") continue;
    if (/[\p{L}\p{N}]/u.test(ch)) {
      out += up ? ch.toUpperCase() : ch;
      up = false;
    } else up = true;
  }
  return /^[A-Z][A-Za-z0-9]*$/.test(out) ? out : undefined;
}

export class Names {
  /** name -> the key it was given for */
  private owner = new Map<string, string>();
  /** key -> name */
  private byKey = new Map<string, string>();
  private opaque = 0;

  constructor(private readonly store?: Store) {}

  /** The concept for a word's lemma. */
  word(lemma: string): string {
    const k = `lemma:${lemma}`;
    const have = this.byKey.get(k);
    if (have) return have;
    const seeded = this.store
      ?.lookup(lemma)
      .find((h) => this.store!.facts(h.concept, "Lemma").some((f) => isCall(f.claim) && positional(f.claim)[0]?.kind === "string" && (positional(f.claim)[0] as { value: string }).value === lemma));
    if (seeded) return this.claim(k, seeded.concept);
    return this.fresh(k, encodeLemma(lemma));
  }

  /** A name for something that is not a word (a sense, a frame), from its key. */
  other(keyText: string, wanted: string | undefined): string {
    const k = `key:${keyText}`;
    return this.byKey.get(k) ?? this.fresh(k, wanted);
  }

  private claim(k: string, name: string): string {
    this.owner.set(name, k);
    this.byKey.set(k, name);
    return name;
  }

  private fresh(k: string, wanted: string | undefined): string {
    const base = wanted ?? `Word_${++this.opaque}`;
    let n = base;
    const free = (x: string) => (!this.owner.has(x) || this.owner.get(x) === k) && !STRUCTURAL_NAMES.has(x);
    for (let i = 2; !free(n); i++) n = `${base}_${i}`;
    return this.claim(k, n);
  }

  isTaken(name: string): boolean {
    return this.owner.has(name);
  }
}
