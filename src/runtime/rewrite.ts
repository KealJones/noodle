// Rewriting (runtime.md section 7): an expression is rewritten by the readings whose patterns
// match it, outermost first, then its arguments, until no reading applies. Every application with
// more than one candidate is a choice point; the alternatives are kept in a beam and scored. Opaque
// nodes are not rewritten. An expression no reading applies to stays as it is: unworked is a value.

import { type Call, type Expr, c, isCall, isHead, isVar, key, positional, role, walk } from "./expr.js";
import { carry, instantiate, match, type Bindings } from "./match.js";
import { type Features, addFeature, mergeFeatures, scoreOf } from "./score.js";
import { type ReadingItem, type Store, readingKey } from "./store.js";
import { contentHeads, type Described, describedActs, isValue, matchFeatures, softMatch } from "./softmatch.js";
import { STRUCTURAL, STRUCTURAL_NAMES } from "../structural.js";

export type Mode = "Doing" | "Speaking" | "Supposing";

export interface Step {
  reading: number;
  owner: string;
  before: Expr;
  after: Expr;
  /** The reading's source (its trust is looked up from it, runtime.md 13) and its stable key. */
  from: Expr;
  key: string;
  /** The effects the reading declares, a claim that narrows its primitive's (ncon.md section 4). */
  effects: Expr[];
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
  /**
   * Which readings may apply, where not all may: understanding a definition reduces it to core
   * meanings and stops there, so readings that act are left for when a request is evaluated.
   */
  allow?: (r: ReadingItem) => boolean;
  /**
   * Whether a directive's act is also matched, by the scored match (runtime.md 6.2), against every
   * act the store says something does (a documented command's summary, a reading the user taught),
   * the best few above the threshold becoming candidates. Off where a text is being understood
   * (a definition, a summary), on for a request.
   */
  soft?: boolean;
}

/** The best few scored matches that become candidates (runtime.md 7). */
const SOFT_CANDIDATES = 4;
const PRIMITIVE_HEADS: ReadonlySet<string> = new Set(STRUCTURAL.primitives.names);
/** An expression that does something: a primitive call is in it. */
const isAct = (e: Expr) => [...walk(e)].some((x) => isCall(x) && PRIMITIVE_HEADS.has(x.head));

/**
 * Trust is whether a derivation rests on what the user said they mean, not how often: a reading
 * the user taught, applied again inside its own meaning ("kill it" in "... and kill it"), earns
 * nothing more.
 */
function trusted(f: Features): Features {
  if ((f.get("Trust:1") ?? 0) > 1) f.set("Trust:1", 1);
  return f;
}

interface Candidate {
  r: ReadingItem;
  b: Bindings;
  result: Expr;
  features?: Features;
  /** For a scored match, the step is from the act matched to the act it came to, inside the directive. */
  step?: { before: Expr; after: Expr };
}

/** Heads whose arguments are content, never rewritten (logical-form.md section 5). */
// What the user teaches (Rewrite) is kept as it was heard: its meaning is read each time it is
// used, where it is used, not once, through guesses, when it is taught.
const OPAQUE = new Set(["Quote", "Mention", "Block", "Ref", "Rewrite"]);

export class Rewriter {
  constructor(
    readonly store: Store,
    readonly weights: (f: string) => number,
    readonly opts: RewriteOptions = { mode: "Doing", beam: 6, maxSteps: 32 },
  ) {}

  /** Readings that may apply to e in this mode, with their matches. */
  candidates(e: Expr): Candidate[] {
    if (!isCall(e)) return [];
    const out: Candidate[] = [];
    const consider = (r: ReadingItem, target: Call, features?: Features) => {
      if (!this.usable(r)) return;
      const m = match(r.pattern, target, this.store);
      if (!m) return;
      const made = instantiate(r.becomes!, m.bindings);
      const result = carry(made, m.extra);
      if (key(result) === key(e)) return;
      // Roles of the expression the pattern did not name are carried over, and counted (runtime.md
      // 6.1): of two readings of the same expression, the one that accounts for more of what was
      // said fits better ("the git status" is git's status, not any status with "git" left over).
      // Roles of what the pattern only passes through, deeper down, are not this reading's to read.
      const pattern = r.pattern as Call;
      // A pattern over anything with some roles passes the rest through, unread here.
      const unmatched = pattern.head === "WithRoles" ? 0 : target.args.filter((a) => a.name !== undefined && !pattern.args.some((p) => p.name === a.name)).length;
      const f: Features = new Map(features ?? []);
      if (unmatched) addFeature(f, "Unmatched", -unmatched);
      // What was said in a role the result fills with something of its own is lost: unworked
      // (runtime.md 6.1), so a reading that keeps every argument beats one that replaces one.
      const dropped = isCall(made) ? m.extra.filter((x) => made.args.some((a) => a.name === x.name && key(a.value) !== key(x.value))).length : 0;
      // So is what the pattern took in a variable its result does not use (a frame whose meaning
      // leaves out its theme: "take milk" as only "cause to be together").
      // (A variable the reading's wants look at is used: it is what the want is about.)
      const used = new Set([r.becomes!, ...r.wants].flatMap((x) => [...walk(x)]).filter(isVar).map((x) => x.text));
      const unused = [...m.bindings].filter(([name, x]) => name !== "_" && !used.has(name) && !isVar(x) && !(isCall(x) && STRUCTURAL_NAMES.has(x.head))).length;
      if (dropped + unused) addFeature(f, "Unworked:Dropped", -(dropped + unused));
      out.push({ r, b: m.bindings, result, features: f.size ? f : undefined });
    };
    for (const r of this.store.readingsFor(e.head)) consider(r, e);
    // A pattern WithRoles($a, role=x) is over anything with those roles, whatever its head (ncon.md 5.1).
    for (const r of this.store.readingsFor("WithRoles")) consider(r, e);
    // Senses (runtime.md 7): a word's senses with readings of their own are candidates for the
    // word, the sense replacing it, scored by how likely the word is to have that sense: the log
    // of its share among the word's senses of the same part of speech, a share falling with its
    // rank in the order the source gives them (1/(rank+1), normalized). A word with one sense has
    // it for certain; otherwise the sense is a guess, which a reading of the word itself does
    // not have to make.
    for (const { sense, prior } of this.expandable(e.head))
      for (const r of this.store.readingsOn(sense))
        if (isCall(r.pattern) && r.pattern.head === sense) consider(r, { ...e, head: sense }, new Map([["SenseFrequency", prior]]));
    if (this.opts.soft && e.head === "Directive") out.push(...this.soft(e));
    return out;
  }

  private softMemo = new Map<string, { result: Expr; d: Described; f: Features }[]>();

  /**
   * A directive's act matched against what the store says acts do (runtime.md 6.2 and 7): each
   * match is scored by its features, and the best few above the threshold (a fact on Match, in
   * the seed's weights) are candidates, the act replaced by the one matched. A plan (And, Then)
   * is matched step by step, each step replaced on its own: one description never stands for
   * several steps. A request that is already a command is not matched again.
   */
  private soft(e: Call): Candidate[] {
    const x = positional(e)[0];
    if (!isCall(x)) return [];
    const directive = (act: Expr): Expr => ({ ...e, args: [{ value: act }, ...e.args.slice(1)] });
    if (x.head !== "And" && x.head !== "Then")
      return this.softFor(x).map((y) => ({ r: y.d.reading, b: new Map(), result: directive(y.result), features: y.f, step: { before: x, after: y.result } }));
    const out: Candidate[] = [];
    x.args.forEach((a, i) => {
      if (a.name !== undefined) return;
      for (const y of this.softFor(a.value).slice(0, 2)) {
        const args = x.args.slice();
        args[i] = { value: y.result };
        out.push({ r: y.d.reading, b: new Map(), result: directive({ ...x, args }), features: y.f, step: { before: a.value, after: y.result } });
      }
    });
    return out;
  }

  /** The best few scored matches of one act, above the threshold. */
  private softFor(x: Expr): { result: Expr; d: Described; f: Features }[] {
    if (!isCall(x) || x.head === "Run") return [];
    const k = key(x);
    const have = this.softMemo.get(k);
    if (have) return have;
    const index = describedActs(this.store, STRUCTURAL_NAMES, isAct);
    const heads = contentHeads(this.store, x, STRUCTURAL_NAMES);
    // An act alone ("delete") does not say which of the things that do it is meant: its exact
    // readings may, a scored match does not.
    if (heads.size < 2) {
      this.softMemo.set(k, []);
      return [];
    }
    const pool = new Set<Described>();
    for (const h of heads) for (const d of index.byHead.get(h) ?? []) pool.add(d);
    const threshold = this.threshold();
    const scored: { d: Described; f: Features; s: number; result: Expr }[] = [];
    for (const d of pool) {
      const m = softMatch(this.store, d.pattern, x, index.weigh, d.slots ? isValue : undefined);
      if (!m) continue;
      // What the reading wants of what fills it counts as it does for an exact match.
      const f = mergeFeatures(matchFeatures(m), this.wantFeatures(d.reading, m.bindings));
      const s = scoreOf(f, this.weights);
      if (s < threshold) continue;
      // A slot the request did not fill is not guessed, and a match that leaves one open does not
      // stand for the request: what it needs was not said (design section 23).
      const result = instantiate(d.becomes, m.bindings);
      if ([...walk(result)].some(isVar)) continue;
      scored.push({ d, f, s, result });
    }
    const seen = new Set<string>();
    const out = scored
      .sort((a, b2) => b2.s - a.s)
      .filter((y) => !seen.has(key(y.result)) && !!seen.add(key(y.result)))
      .slice(0, SOFT_CANDIDATES);
    this.softMemo.set(k, out);
    return out;
  }


  /** A source's trust level, from the trust table (TrustLevel facts on source concepts). */
  private trust(from: Expr): number | undefined {
    if (!isCall(from)) return undefined;
    const n = this.store.facts(from.head, "TrustLevel").map((f) => positional(f.claim as Call)[0])[0];
    return n?.kind === "number" ? n.value : undefined;
  }

  /** The scored match's threshold: a fact on the Match template (the seed's weights). */
  private threshold(): number {
    const t = this.store.facts("Match", "Threshold").map((f) => positional(f.claim as Call)[0])[0];
    return t?.kind === "number" ? t.value : -Infinity;
  }

  private usable(r: ReadingItem): boolean {
    if (!r.becomes || (r.mode && r.mode !== this.opts.mode)) return false;
    // A definition that has not bottomed out is kept, not used (design section 6).
    if (r.meta.status === "Pending") return false;
    // Lexical rules (patterns over chart categories) run in the chart, not here.
    if (r.owner === "Segment") return false;
    return !this.opts.allow || this.opts.allow(r);
  }

  private senseCache = new Map<string, { sense: string; rank: number; prior: number }[]>();

  /**
   * A word's senses, each with its rank among the word's senses of its part of speech and its
   * prior: the log of its share of them, a share falling as 1/(rank+1).
   */
  senses(word: string): { sense: string; rank: number; prior: number }[] {
    let out = this.senseCache.get(word);
    if (!out) {
      const found: { sense: string; rank: number; pos: string }[] = [];
      const seen = new Map<string, number>();
      for (const f of this.store.facts(word, "Sense")) {
        const x = positional(f.claim as Call)[0];
        if (!isCall(x)) continue;
        const pos = this.store.facts(x.head, "PartOfSpeech").map((p) => key(p.claim)).join();
        const rank = seen.get(pos) ?? 0;
        seen.set(pos, rank + 1);
        found.push({ sense: x.head, rank, pos });
      }
      let h = 0;
      const harmonic = [0];
      for (let i = 1; i <= Math.max(0, ...seen.values()); i++) harmonic.push((h += 1 / i));
      out = found.map(({ sense, rank, pos }) => ({ sense, rank, prior: -Math.log((rank + 1) * harmonic[seen.get(pos)!]) }));
      this.senseCache.set(word, out);
    }
    return out;
  }

  /**
   * The senses a word may be replaced by in rewriting. A word the seed gives meaning to (a core
   * meaning, a function word) is where definitions bottom out, so it is not expanded again through
   * its imported senses (design section 6); otherwise "happen" would be defined by "come to pass",
   * and that by "happen", without end.
   */
  private expandable(word: string): { sense: string; rank: number; prior: number }[] {
    return this.store.facts(word).some((f) => isCall(f.meta.from) && f.meta.from.head === "Seed") ? [] : this.senses(word);
  }

  /** The value of a reading's wants as features (runtime.md 8.1: WantedKind, ShapeFit). */
  wantFeatures(r: ReadingItem, b: Bindings): Features {
    const f: Features = new Map();
    for (const w of r.wants) {
      if (!isCall(w)) continue;
      const [x0, k] = positional(w).map((a) => (isVar(a) ? b.get(a.text) : a));
      // A referent that only points ("it"), in a plan, points at what the step before printed
      // (Output, worked out when it has run): a want for that is met by it.
      if (isHead(x0, "Ref") && !role(x0, "kind") && !role(x0, "of") && isHead(k, "Output")) continue;
      // A referent is of the kind it was said as (logical-form.md section 4).
      // A number said as digits is of the kind its shape is (the seed's Numeral, a number).
      const x = isHead(x0, "Ref") && isCall(role(x0, "kind")) ? role(x0, "kind") : x0?.kind === "number" ? c("Numeral") : x0;
      if (w.head === "IsA" && isCall(x) && isCall(k)) {
        // Something that is a K meets a want for a K, however narrow a K it is (a shopping list is
        // a list). Otherwise, the distance between the two kinds; beyond four steps (kinds meeting
        // only near the top of WordNet), as unrelated as none.
        const d = this.store.kinds(x.head).has(k.head) ? 0 : this.store.kindDistance(x.head, k.head);
        addFeature(f, "WantedKind", -Math.min(d ?? 4, 4));
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
    const own = !STRUCTURAL_NAMES.has(e.head) && this.store.readingsOn(e.head).some((r) => !r.mode && r.owner !== "Segment" && r.meta.status !== "Pending") ? 1 : 0;
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
    for (const { r, b, result, features, step: inner } of cands) {
      const step: Step = { reading: r.meta.id, owner: r.owner, before: inner?.before ?? e, after: inner?.after ?? result, from: r.meta.from, key: readingKey(r), effects: r.effects };
      const own = features ? mergeFeatures(this.wantFeatures(r, b), features) : this.wantFeatures(r, b);
      addFeature(own, `Evidence:${readingKey(r)}`, 1);
      // Trust (runtime.md 8.1): a reading the user gave (level 1) is what they said they mean. Only
      // that level is a feature here: the seed's readings are everywhere, and documentation's are
      // weighed by their evidence, so a correction moves them one by one, never all at once.
      if (this.trust(r.meta.from) === 1) addFeature(own, "Trust:1", 1);
      for (const d of this.norm(result, depth + 1, seen2)) alts.push({ expr: d.expr, features: trusted(mergeFeatures(own, d.features)), steps: [step, ...d.steps] });
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
          next.push({ expr: { ...call, args }, features: trusted(mergeFeatures(cmb.features, alt.features)), steps: [...cmb.steps, ...alt.steps] });
        }
      combos = this.top(next);
    });
    const out: Omit<Derivation, "score">[] = [];
    for (const cmb of combos) {
      if (key(cmb.expr) !== k && this.candidates(cmb.expr).length)
        for (const d of this.norm(cmb.expr, depth + 1, seen2)) out.push({ expr: d.expr, features: trusted(mergeFeatures(cmb.features, d.features)), steps: [...cmb.steps, ...d.steps] });
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
