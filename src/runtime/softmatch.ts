// The scored match (runtime.md section 6.2): unification with slack, for matching a request's
// reduction against another text's reduction (a documentation description, a definition). Two
// reductions built separately rarely come out identical, so nodes are aligned top-down: the roots
// align; a pattern node's role children align to the request's children with the same role, or,
// failing that, to an unaligned child at a cost; heads may differ at a cost that grows with their
// kind distance. The features say how much of each side the alignment explains.

import { type Expr, isCall, isVar, key, positional, roles } from "./expr.js";
import { canonical } from "./match.js";
import type { Store } from "./store.js";

export interface MatchFeatures {
  /** Share of the pattern's nodes the alignment covers (its core content explained). */
  patternCovered: number;
  /** Share of the request's nodes nothing in the pattern explains. */
  requestUnmatched: number;
  /** Sum of kind distances over aligned heads. */
  kindDistance: number;
  /** Pattern variables (a template's arguments) the request fills. */
  rolesFilled: number;
  rolesWanted: number;
}

export interface SoftMatch {
  score: number;
  features: MatchFeatures;
}

/** A role child aligned to a request child with another role costs this much of a node. */
const OFF_ROLE = 0.5;
/** Kind distance beyond which two heads do not align. */
const MAX_DISTANCE = 4;

interface Aligned {
  covered: number;
  matched: Set<Expr>;
  distance: number;
  filled: number;
}

function nodes(e: Expr): number {
  return isCall(e) ? 1 + e.args.reduce((n, a) => n + nodes(a.value), 0) : isVar(e) ? 0 : 1;
}

function vars(e: Expr): number {
  return isVar(e) ? 1 : isCall(e) ? e.args.reduce((n, a) => n + vars(a.value), 0) : 0;
}

function headDistance(store: Store, a: string, b: string): number | undefined {
  if (a === b) return 0;
  const ca = canonical(store, a);
  const cb = canonical(store, b);
  if (ca === cb) return 0;
  const d = store.kindDistance(ca, cb);
  return d !== undefined && d <= MAX_DISTANCE ? d : undefined;
}

function align(store: Store, p: Expr, r: Expr): Aligned | undefined {
  // A pattern variable is an argument slot: anything fills it.
  if (isVar(p)) return { covered: 0, matched: markAll(r), distance: 0, filled: 1 };
  if (!isCall(p) || !isCall(r)) return p.kind === r.kind && key(p) === key(r) ? { covered: 1, matched: new Set([r]), distance: 0, filled: 0 } : undefined;
  const d = headDistance(store, p.head, r.head);
  if (d === undefined) return undefined;
  const out: Aligned = { covered: 1 / (1 + d), matched: new Set([r]), distance: d, filled: 0 };
  const used = new Set<number>();
  const rArgs = r.args;
  const take = (i: number, a: Aligned, weight: number) => {
    used.add(i);
    out.covered += a.covered * weight;
    for (const m of a.matched) out.matched.add(m);
    out.distance += a.distance;
    out.filled += a.filled;
  };
  // Roles first, by name; then positional arguments in order; then whatever is left, off role.
  for (const pa of roles(p)) {
    const i = rArgs.findIndex((ra, j) => !used.has(j) && ra.name === pa.name);
    const a = i >= 0 ? align(store, pa.value, rArgs[i].value) : undefined;
    if (a) take(i, a, 1);
    else {
      const alt = bestUnused(store, pa.value, rArgs, used);
      if (alt) take(alt.i, alt.a, OFF_ROLE);
    }
  }
  const pPos = positional(p);
  let j = 0;
  for (const pv of pPos) {
    while (j < rArgs.length && (used.has(j) || rArgs[j].name !== undefined)) j++;
    const a = j < rArgs.length ? align(store, pv, rArgs[j].value) : undefined;
    if (a) take(j++, a, 1);
    else {
      const alt = bestUnused(store, pv, rArgs, used);
      if (alt) take(alt.i, alt.a, OFF_ROLE);
    }
  }
  return out;
}

function bestUnused(store: Store, p: Expr, rArgs: { name?: string; value: Expr }[], used: Set<number>): { i: number; a: Aligned } | undefined {
  let best: { i: number; a: Aligned } | undefined;
  rArgs.forEach((ra, i) => {
    if (used.has(i)) return;
    const a = align(store, p, ra.value);
    if (a && (!best || a.covered > best.a.covered)) best = { i, a };
  });
  return best;
}

function descendants(e: Expr): Expr[] {
  if (!isCall(e)) return [];
  return e.args.flatMap((a) => (isCall(a.value) ? [a.value, ...descendants(a.value)] : []));
}

function markAll(e: Expr): Set<Expr> {
  const out = new Set<Expr>([e]);
  if (isCall(e)) for (const a of e.args) for (const m of markAll(a.value)) out.add(m);
  return out;
}

/**
 * Align a pattern (a documentation reading's reduction) to a request's reduction. Undefined when the
 * roots cannot align. The score is the pattern covered, minus the request left unexplained.
 */
export function softMatch(store: Store, pattern: Expr, request: Expr): SoftMatch | undefined {
  // The roots align; failing that, either root may align below the other's (a request that wraps
  // the act in "I want", a description that wraps it in "cause"), and what is above stays
  // unexplained, which the features count.
  let a = align(store, pattern, request);
  if (!a) {
    let best: Aligned | undefined;
    const consider = (x: Aligned | undefined) => {
      if (x && (!best || x.covered > best.covered)) best = x;
    };
    const ps = [pattern, ...descendants(pattern)];
    const rs = [request, ...descendants(request)];
    for (const ps1 of ps) for (const rs1 of rs) if (ps1 !== pattern || rs1 !== request) consider(align(store, ps1, rs1));
    a = best;
  }
  if (!a) return undefined;
  const pn = Math.max(1, nodes(pattern));
  const rn = Math.max(1, nodes(request));
  let matchedNodes = 0;
  for (const m of a.matched) matchedNodes += isCall(m) || m.kind !== "variable" ? 1 : 0;
  const features: MatchFeatures = {
    patternCovered: Math.min(1, a.covered / pn),
    requestUnmatched: Math.max(0, 1 - matchedNodes / rn),
    kindDistance: a.distance,
    rolesFilled: a.filled,
    rolesWanted: vars(pattern),
  };
  return { score: features.patternCovered - features.requestUnmatched, features };
}
