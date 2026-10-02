// Canonicalization (logical-form.md section 8): when two logical forms are the same. Both are
// canonicalized, then compared as data. Roles compare regardless of order (key() sorts them),
// sameness resolves to one representative, sets are sets, time Now is the default, a double
// negation of a proposition is the proposition, opaque nodes are compared whole, and a message's
// constraints are a set while its directives keep their order.

import { type Call, type Expr, isCall, isHead, key, positional } from "./expr.js";
import { canonical as sameAs } from "./match.js";
import type { Store } from "./store.js";

const OPAQUE = new Set(["Quote", "Mention", "Block"]);

/** An act: a primitive call, or a concept with an entry of category Act (logical-form.md 3.1). */
function isAct(store: Store, e: Expr, primitives: ReadonlySet<string>): boolean {
  if (!isCall(e)) return false;
  if (primitives.has(e.head) || e.head === "Then" || e.head === "Sequence") return true;
  return store.facts(e.head, "Category").some((f) => isCall(f.claim) && isHead(positional(f.claim)[0], "Act"));
}

export function canonicalize(store: Store, e: Expr, primitives: ReadonlySet<string> = new Set(), underRule = false): Expr {
  if (!isCall(e) || OPAQUE.has(e.head)) return e;
  const head = sameAs(store, e.head);
  const rule = underRule || head === "Constraint";
  let args = e.args
    // Time is an index, and Now its default (rule 7).
    .filter((a) => !(a.name === "time" && isHead(a.value, "Now") && a.value.args.length === 0))
    .map((a) => ({ ...a, value: canonicalize(store, a.value, primitives, rule) }));
  // Not(Not(p)) is p for propositions only; under a rule a Not is never simplified (rule 8).
  if (head === "Not" && !rule && args.length === 1 && isHead(args[0].value, "Not") && args[0].value.args.length === 1) return args[0].value.args[0].value;
  // And and Or over things and propositions are sets; And over acts is ordered (rule 6).
  if (head === "And" || head === "Or") {
    const pos = args.filter((a) => a.name === undefined);
    const ordered = head === "And" && pos.some((a) => isAct(store, a.value, primitives));
    if (!ordered) {
      const seen = new Set<string>();
      const set = pos.filter((a) => (seen.has(key(a.value)) ? false : (seen.add(key(a.value)), true))).sort((a, b) => key(a.value).localeCompare(key(b.value)));
      args = [...set, ...args.filter((a) => a.name !== undefined)];
    }
  }
  return { ...e, head, args } as Call;
}

/** A message's logical forms: each canonicalized, its constraints a set, its directives in order (rule 10). */
export function canonicalizeMessage(store: Store, lfs: readonly Expr[], primitives: ReadonlySet<string> = new Set()): Expr[] {
  const all = lfs.map((x) => canonicalize(store, x, primitives));
  const constraints = [...new Map(all.filter((x) => isHead(x, "Constraint")).map((x) => [key(x), x])).values()].sort((a, b) => key(a).localeCompare(key(b)));
  return [...constraints, ...all.filter((x) => !isHead(x, "Constraint"))];
}

/** Two messages mean the same when their canonical forms are equal. */
export function sameMeaning(store: Store, a: readonly Expr[], b: readonly Expr[], primitives: ReadonlySet<string> = new Set()): boolean {
  const ca = canonicalizeMessage(store, a, primitives).map(key);
  const cb = canonicalizeMessage(store, b, primitives).map(key);
  return ca.length === cb.length && ca.every((x, i) => x === cb[i]);
}

/**
 * Two expressions that say the same thing: equal, or equal but for words that name the same thing
 * (a word with no sense chosen, and another, that share a sense: "eggs" and "egg"), or for a bare
 * plural read as every or some of its kind.
 */
export function alike(store: Store, a: Expr, b: Expr): boolean {
  if (key(a) === key(b)) return true;
  if (!isCall(a) || !isCall(b)) return false;
  // A bare plural read as every member or some of a kind ("eggs") is that kind, said either way.
  const kindOf = (x: Call) => ((x.head === "Every" || x.head === "Some") && x.args.length === 1 && x.args[0].name === undefined ? x.args[0].value : x);
  if (kindOf(a) !== a || kindOf(b) !== b) return alike(store, kindOf(a), kindOf(b));
  if (!a.args.length && !b.args.length) {
    const senses = new Set(store.facts(a.head, "Sense").map((f) => key(f.claim)));
    return store.facts(b.head, "Sense").some((f) => senses.has(key(f.claim)));
  }
  if (a.head !== b.head || a.args.length !== b.args.length) return false;
  return a.args.every((x, i) => x.name === b.args[i].name && alike(store, x.value, b.args[i].value));
}
