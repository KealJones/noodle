// The scored match (runtime.md section 6.2): unification with slack, for matching a request's
// reduction against another text's reduction (a documentation description, a definition). Two
// reductions built separately rarely come out identical, so nodes are aligned top-down: the roots
// align; a pattern node's role children align to the request's children with the same role, or,
// failing that, to an unaligned child at a cost; heads may differ at a cost that grows with their
// kind distance. The features say how much of each side the alignment explains.

import { type Call, type Expr, isCall, isHead, isVar, key, positional, role, roles, walk } from "./expr.js";
import { type Bindings, canonical } from "./match.js";
import type { ReadingItem, Store } from "./store.js";

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
  /** What the request gave the pattern's variables. */
  bindings: Bindings;
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
  bindings: Bindings;
}

/**
 * How much a node says: what the features count it as. Unweighted, every node is one; matched
 * against what acts the store describes, a node weighs what its concept tells them apart by (its
 * inverse document frequency there), so two reductions that share only scaffolding every
 * description has ("cause to become") do not match on it.
 */
export type Weigh = (e: Expr) => number;

/** What may fill a pattern's variable. */
export type Fills = (e: Expr) => boolean;

/** A value said (a name, a number), what a command line's argument can be. */
export const isValue: Fills = (e) => e.kind === "string" || e.kind === "number";

/**
 * What a reduction's referents were before they were taken at their kind (gist, below): a slot
 * said as one of its kind is filled by the referent itself ("this folder" for a task's
 * directory), and what it points at is found when the act runs.
 */
const referents = new WeakMap<Expr, Expr>();

/** What a command line's slot takes: a value said, or a referent, found when the act runs. */
export const isArgument: Fills = (e) => isValue(e) || isHead(e, "Ref");

function nodes(e: Expr, w: Weigh): number {
  return isCall(e) ? w(e) + e.args.reduce((n, a) => n + nodes(a.value, w), 0) : isVar(e) ? 0 : w(e);
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

function align(store: Store, w: Weigh, fills: Fills, p: Expr, r: Expr): Aligned | undefined {
  // A pattern variable is an argument slot: anything fills it, or where only a value may (a
  // command line's slot), a value said.
  if (isVar(p)) return !fills(r) ? undefined : { covered: 0, matched: markAll(r), distance: 0, filled: 1, bindings: new Map([[p.text, r]]) };
  // A slot said as one of its kind (a task's Directory($path)) takes a referent of that kind.
  const ref = referents.get(r);
  if (ref && isCall(p) && isCall(r) && p.args.length === 1 && isVar(p.args[0].value) && fills(ref)) {
    const d = headDistance(store, p.head, r.head);
    if (d !== undefined) return { covered: w(p) / (1 + d), matched: markAll(r), distance: d, filled: 1, bindings: new Map([[(p.args[0].value as { text: string }).text, ref]]) };
  }
  if (!isCall(p) || !isCall(r)) return p.kind === r.kind && key(p) === key(r) ? { covered: w(p), matched: new Set([r]), distance: 0, filled: 0, bindings: new Map() } : undefined;
  const d = headDistance(store, p.head, r.head);
  if (d === undefined) return undefined;
  const out: Aligned = { covered: w(p) / (1 + d), matched: new Set([r]), distance: d, filled: 0, bindings: new Map() };
  const used = new Set<number>();
  const rArgs = r.args;
  const take = (i: number, a: Aligned, weight: number) => {
    used.add(i);
    out.covered += a.covered * weight;
    for (const m of a.matched) out.matched.add(m);
    out.distance += a.distance;
    out.filled += a.filled;
    for (const [k, v] of a.bindings) if (!out.bindings.has(k)) out.bindings.set(k, v);
  };
  // Roles first, by name; then positional arguments in order; then whatever is left, off role.
  for (const pa of roles(p)) {
    const i = rArgs.findIndex((ra, j) => !used.has(j) && ra.name === pa.name);
    const a = i >= 0 ? align(store, w, fills, pa.value, rArgs[i].value) : undefined;
    if (a) take(i, a, 1);
    else {
      const alt = bestUnused(store, w, fills, pa.value, rArgs, used);
      if (alt) take(alt.i, alt.a, OFF_ROLE);
    }
  }
  const pPos = positional(p);
  let j = 0;
  for (const pv of pPos) {
    while (j < rArgs.length && (used.has(j) || rArgs[j].name !== undefined)) j++;
    const a = j < rArgs.length ? align(store, w, fills, pv, rArgs[j].value) : undefined;
    if (a) take(j++, a, 1);
    else {
      const alt = bestUnused(store, w, fills, pv, rArgs, used);
      if (alt) take(alt.i, alt.a, OFF_ROLE);
    }
  }
  return out;
}

function bestUnused(store: Store, w: Weigh, fills: Fills, p: Expr, rArgs: { name?: string; value: Expr }[], used: Set<number>): { i: number; a: Aligned } | undefined {
  let best: { i: number; a: Aligned } | undefined;
  rArgs.forEach((ra, i) => {
    if (used.has(i)) return;
    const a = align(store, w, fills, p, ra.value);
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
 * roots cannot align. The score is the pattern covered, minus the request left unexplained. Both
 * are taken at their gist first (below).
 */
export function softMatch(store: Store, pattern0: Expr, request0: Expr, w: Weigh = () => 1, fills: Fills = () => true): SoftMatch | undefined {
  const pattern = gist(pattern0);
  const request = gist(request0);
  // The roots align; failing that, either root may align below the other's (a request that wraps
  // the act in "I want", a description that wraps it in "cause"), and what is above stays
  // unexplained, which the features count.
  let a = align(store, w, fills, pattern, request);
  if (!a) {
    let best: Aligned | undefined;
    const consider = (x: Aligned | undefined) => {
      if (x && (!best || x.covered > best.covered)) best = x;
    };
    const ps = [pattern, ...descendants(pattern)];
    const rs = [request, ...descendants(request)];
    for (const ps1 of ps) for (const rs1 of rs) if (ps1 !== pattern || rs1 !== request) consider(align(store, w, fills, ps1, rs1));
    a = best;
  }
  if (!a) return undefined;
  const pn = nodes(pattern, w) || 1;
  const rn = nodes(request, w) || 1;
  let matchedNodes = 0;
  for (const m of a.matched) matchedNodes += isCall(m) || m.kind !== "variable" ? w(m) : 0;
  const features: MatchFeatures = {
    patternCovered: Math.min(1, a.covered / pn),
    requestUnmatched: Math.max(0, 1 - matchedNodes / rn),
    kindDistance: a.distance,
    rolesFilled: a.filled,
    rolesWanted: vars(pattern),
  };
  return { score: features.patternCovered - features.requestUnmatched, features, bindings: a.bindings };
}

/**
 * What a reduction says, for matching it against another: who does a directive's act is the
 * addressee whoever's words they are, so the agent is not content; a referent is its kind (what it
 * points at is found later); and the words it was said with are how it was said, not what.
 */
export function gist(e: Expr): Expr {
  if (!isCall(e)) return e;
  if (e.head === "Ref") {
    const k = role(e, "kind");
    if (k) {
      const g = gist(k);
      if (isCall(g)) referents.set(g, e);
      return g;
    }
  }
  // How many of a kind ("some pull requests", "every branch") is not what kind it is.
  if ((e.head === "Some" || e.head === "Every") && e.args.length === 1 && isCall(e.args[0].value)) return gist(e.args[0].value);
  return { ...e, args: e.args.filter((a) => a.name !== "agent" && a.name !== "said").map((a) => ({ ...a, value: gist(a.value) })) };
}

/**
 * The scored match's features as the score's (runtime.md 8.1: the Match template), one weight
 * each. Each is a cost, so an exact match costs nothing and a reading matched exactly (which has
 * none of them) is not outscored by a scored match of the same act.
 */
export function matchFeatures(m: SoftMatch): Map<string, number> {
  return new Map([
    // Being matched with slack at all: an exact reading of the same request is the better evidence.
    ["Match:Scored", -1],
    ["Match:Uncovered", m.features.patternCovered - 1],
    ["Match:Unexplained", -m.features.requestUnmatched],
    ["Match:Distance", -m.features.kindDistance],
  ]);
}

/**
 * An act something says it does: a documented command's summary understood (Describes on its
 * sense) with the reading that runs it, or a reading the user taught, whose pattern is a request's
 * meaning and whose result is an act.
 */
export interface Described {
  pattern: Expr;
  becomes: Expr;
  reading: ReadingItem;
  heads: Set<string>;
  /** Whether the reading's variables are slots a request may leave open (a task's own reading). */
  slots?: boolean;
}

interface DescribedIndex {
  generation: number;
  all: Described[];
  byHead: Map<string, Described[]>;
  /** What a node says among these descriptions (Weigh, above). */
  weigh: Weigh;
}

const indexes = new WeakMap<Store, DescribedIndex>();

/** The concepts a reduction is about: its heads, at their gist, without the structural ones. */
export function contentHeads(store: Store, e: Expr, structural: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const x of walk(gist(e))) if (isCall(x) && !structural.has(x.head)) out.add(canonical(store, x.head));
  return out;
}

/**
 * The acts the store says something does, indexed by the concepts of what they say, so a request
 * is matched only against those that share a concept with it. Worked out again only when the
 * store has changed. `acts` says whether an expression is an act (a primitive call is in it).
 */
export function describedActs(store: Store, structural: ReadonlySet<string>, acts: (e: Expr) => boolean): DescribedIndex {
  const have = indexes.get(store);
  if (have && have.generation === store.generation) return have;
  const all: Described[] = [];
  for (const f of store.factsWithHead("Describes")) {
    const [sense, what] = positional(f.claim as Call);
    if (!isCall(sense) || !what) continue;
    // The reading that runs the command, from the same page as the sense: of those, the one that
    // names nothing but the command (no tool name, no argument).
    const page = key(f.meta.from);
    let best: ReadingItem | undefined;
    for (const sf of store.facts(sense.head, "SenseOf")) {
      const w = positional(sf.claim as Call)[0];
      if (!isCall(w)) continue;
      for (const r of store.readingsOn(w.head)) {
        if (key(r.meta.from) !== page || !r.becomes || !acts(r.becomes) || [...walk(r.becomes)].some(isVar)) continue;
        const shorter = !best || key(r.becomes).length < key(best.becomes!).length || (key(r.becomes) === key(best.becomes!) && key(r.pattern).length < key(best.pattern).length);
        if (shorter) best = r;
      }
    }
    // A task described on its own concept (a tldr example) is run by its own reading, whose
    // variables are its slots: what the description names in their place fills them.
    const own = best ? undefined : store.readingsOn(sense.head).find((r) => key(r.meta.from) === page && !!r.becomes && acts(r.becomes));
    if (best ?? own) all.push({ pattern: what, becomes: (best ?? own)!.becomes!, reading: (best ?? own)!, heads: contentHeads(store, what, structural), slots: !!own });
  }
  // What the user taught: a request's meaning that comes to an act.
  for (const r of store.readingsAdded())
    if (isHead(r.meta.from, "User") && r.becomes && acts(r.becomes)) all.push({ pattern: r.pattern, becomes: r.becomes, reading: r, heads: contentHeads(store, r.pattern, structural) });
  const byHead = new Map<string, Described[]>();
  for (const d of all) for (const h of d.heads) byHead.set(h, [...(byHead.get(h) ?? []), d]);
  // A concept weighs what it tells things apart by: the log of how few of the graph's readings
  // name it (its inverse document frequency there), so the scaffolding of change that every
  // reduction has ("cause to become") weighs little. Structure (a primitive, a connective) weighs
  // nothing; a value said (a number, a name) weighs as much as the rarest concept: a match that
  // leaves it out drops what the user said.
  const { readings, df } = store.headCounts();
  const weigh: Weigh = (e) => {
    if (isVar(e)) return 0;
    if (!isCall(e)) return Math.log(readings + 1);
    if (structural.has(e.head)) return 0;
    return Math.log((readings + 1) / ((df.get(e.head) ?? 0) + 1));
  };
  const out = { generation: store.generation, all, byHead, weigh };
  indexes.set(store, out);
  return out;
}
