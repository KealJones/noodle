// The chart (runtime.md section 4): a lexicalized chart parser with six steps (Take, Modify, Join,
// Skip, Compose, Gap). Every rule is a fact on a word, a form or a category concept (ncon.md
// section 5); this file knows no word. Categories are compared by identity, kinds only scored.

import { type Call, type Expr, c, isCall, isHead, key, positional, role, roles } from "./expr.js";
import type { Candidate, Hearing } from "./hear.js";
import { instantiate, match } from "./match.js";
import type { Features } from "./score.js";
import { addFeature, mergeFeatures, scoreOf } from "./score.js";
import { type ReadingItem, type Store, readingKey } from "./store.js";

export interface TakesSpec {
  side: "Left" | "Right";
  category: string;
  role?: string;
  head?: string;
  optional: boolean;
}

export interface ModifiesSpec {
  side: "Left" | "Right";
  category: string;
  role?: string;
}

interface Pending {
  takes: TakesSpec;
  /** Argument indices from the edge's expression down to the call that receives the argument. */
  path: number[];
}

export interface Edge {
  id: number;
  start: number;
  end: number;
  category: string;
  expr: Expr;
  pending: Pending[];
  modifies: ModifiesSpec[];
  /** For an entry that Joins: the category it joins (Any for any). */
  joins?: string;
  /** For a join waiting for its left side: the right side's category. */
  joinRight?: Edge;
  /** Category(Any()) entries yield the category of their first argument. */
  anyCategory: boolean;
  wraps?: string;
  heads?: string;
  /** The entry's FillsGap category: its clause argument may contain a gap of that category. */
  acceptsGap?: string;
  /** An open gap inside this edge, of this category. */
  gap?: string;
  word?: string;
  formFeatures: string[];
  /** Made by a lexical rule; rules do not apply to it again. */
  byRule: boolean;
  features: Features;
  score: number;
  step: string;
  back: Edge[];
}

export interface Cover {
  edges: Edge[];
  skipped: number[];
  features: Features;
  score: number;
}

const CATEGORY_HEADS = new Set(["Noun", "Thing", "Act", "Clause", "Relation", "Property", "Manner", "Mark"]);

export interface ChartOptions {
  /** Edges kept per span and category (runtime.md 4.4). */
  k: number;
  /** Covers kept per segment. */
  covers: number;
  /** Longest run of tokens one Skip step may pass over. */
  maxSkip: number;
}

export const DEFAULT_CHART: ChartOptions = { k: 6, covers: 8, maxSkip: 2 };

export class Chart {
  private nextId = 1;
  private spans: Edge[][][];
  readonly segmentRules: ReadingItem[];
  private lexicalRules = new Map<string, ReadingItem[]>();
  private categoryEntries = new Map<string, ReturnType<typeof entriesOf>>();
  private hasGapWord: boolean;

  constructor(
    readonly store: Store,
    readonly hearing: Hearing,
    readonly from: number,
    readonly to: number,
    readonly weights: (f: string) => number,
    readonly opts: ChartOptions = DEFAULT_CHART,
  ) {
    const n = to - from;
    this.spans = Array.from({ length: n + 1 }, () => Array.from({ length: n + 1 }, () => [] as Edge[]));
    this.segmentRules = store.readingsOn("Segment").filter((r) => isCall(r.pattern) && CATEGORY_HEADS.has(r.pattern.head));
    this.hasGapWord = false;
  }

  private cell(s: number, e: number): Edge[] {
    return this.spans[s - this.from][e - this.from];
  }

  private rulesOn(owner: string): ReadingItem[] {
    let r = this.lexicalRules.get(owner);
    if (!r) {
      r = this.store.readingsOn(owner).filter((x) => isCall(x.pattern) && CATEGORY_HEADS.has(x.pattern.head));
      this.lexicalRules.set(owner, r);
    }
    return r;
  }

  private entries(concept: string) {
    let e = this.categoryEntries.get(concept);
    if (!e) {
      e = entriesOf(this.store, concept);
      this.categoryEntries.set(concept, e);
    }
    return e;
  }

  private make(p: Omit<Edge, "id" | "score" | "byRule" | "formFeatures" | "anyCategory" | "modifies" | "pending"> & Partial<Edge>): Edge {
    const edge: Edge = { pending: [], modifies: [], anyCategory: false, formFeatures: [], byRule: false, ...p, id: this.nextId++, score: 0 };
    edge.score = scoreOf(edge.features, this.weights);
    return edge;
  }

  // -------------------------------------------------------------------------------------------
  // Word edges

  private wordEdges(cand: Candidate): Edge[] {
    const out: Edge[] = [];
    const features: Features = new Map();
    // A word nothing knows, taken as a literal, covers its token without being a word understood.
    if (cand.source !== "Unknown") addFeature(features, "WordsUsed", cand.end - cand.start);
    // Where the candidate came from: the word as said (1), a correction a distance away (minus the
    // distance), or nothing known (0) (runtime.md 3.3 and 8.1).
    // A candidate covering several tokens (a URL, a multi-word name) counts for each of them.
    addFeature(features, `CandidateSource:${cand.source}`, cand.source === "Unknown" ? 0 : cand.distance ? -cand.distance : cand.end - cand.start);
    if (cand.kind) addFeature(features, `ShapeFit:${cand.kind}`, 1);
    if (cand.concept) {
      const { entries, joins } = this.entries(cand.concept);
      for (const en of entries) {
        if (en.fillsGap) this.hasGapWord = true;
        out.push(
          this.make({
            start: cand.start,
            end: cand.end,
            category: en.category,
            anyCategory: en.category === "Any",
            expr: c(cand.concept),
            pending: en.takes.map((t) => ({ takes: t, path: [] })),
            modifies: en.modifies,
            wraps: en.wraps,
            heads: en.heads,
            acceptsGap: en.fillsGap,
            word: cand.concept,
            formFeatures: cand.features,
            features: new Map(features),
            step: "word",
            back: [],
          }),
        );
      }
      for (const j of joins)
        out.push(this.make({ start: cand.start, end: cand.end, category: "join", expr: c(cand.concept), joins: j, word: cand.concept, formFeatures: cand.features, features: new Map(features), step: "word", back: [] }));
      // Tone words may be skipped at no cost (runtime.md 4.6).
    }
    if (cand.literal !== undefined && !out.length) {
      out.push(this.make({ start: cand.start, end: cand.end, category: "Thing", expr: cand.literal, word: cand.kind, features, step: "literal", back: [] }));
      // A name in the surroundings can follow a determiner, as a noun does: "the readme".
      if (cand.source === "InPlay")
        out.push(this.make({ start: cand.start, end: cand.end, category: "Noun", expr: cand.literal, word: cand.kind, features: new Map(features), step: "literal", back: [] }));
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Steps

  /** Complete: no argument it must still take, and its wrapper (if any) applied. */
  private complete(e: Edge): boolean {
    return e.category !== "join" && !e.wraps && !e.heads && e.pending.every((p) => p.takes.optional);
  }

  private ready(e: Edge): boolean {
    return e.category !== "join" && e.pending.every((p) => p.takes.optional);
  }

  /** Take: a head with a pending argument on a side combines with an adjacent complete edge. */
  private take(head: Edge, arg: Edge, side: "Left" | "Right"): Edge | undefined {
    const p = head.pending[0];
    if (!p || p.takes.side !== side || !this.complete(arg)) return undefined;
    if (p.takes.category !== "Any" && p.takes.category !== arg.category) return undefined;
    if (arg.category === "Mark" && p.takes.category !== "Mark") return undefined;
    if (p.takes.head && !(isCall(arg.expr) && (arg.word === p.takes.head || arg.expr.head === p.takes.head))) return undefined;
    // A gap may only be taken by an entry whose FillsGap says it can, and that entry's last argument
    // (the clause the displaced phrase came from) must have it.
    if (arg.gap && head.acceptsGap !== arg.gap) return undefined;
    if (head.acceptsGap && head.pending.length === 1 && arg.gap !== head.acceptsGap) return undefined;
    if (head.gap && arg.gap) return undefined;
    const isMark = p.takes.category === "Mark";
    const expr = isMark ? head.expr : addArg(head.expr, p.path, p.takes.role, arg.expr);
    const category = head.anyCategory && !isMark ? arg.category : head.category;
    return this.make({
      ...head,
      start: Math.min(head.start, arg.start),
      end: Math.max(head.end, arg.end),
      category,
      anyCategory: head.anyCategory && isMark,
      expr,
      pending: head.pending.slice(1),
      gap: head.gap ?? (arg.gap && head.acceptsGap === arg.gap ? undefined : arg.gap),
      features: mergeFeatures(head.features, arg.features),
      byRule: false,
      step: "take",
      back: [head, arg],
    });
  }

  /** Modify: a complete modifier attaches to an adjacent complete edge of its category. */
  private modify(mod: Edge, target: Edge, side: "Left" | "Right"): Edge[] {
    const out: Edge[] = [];
    if (!this.complete(mod) || !this.complete(target) || !isCall(target.expr)) return out;
    for (const m of mod.modifies) {
      if (m.side !== side || (m.category !== "Any" && m.category !== target.category)) continue;
      out.push(
        this.make({
          ...target,
          start: Math.min(mod.start, target.start),
          end: Math.max(mod.end, target.end),
          expr: { ...target.expr, args: [...target.expr.args, { name: lowerFirst(m.role ?? "Modifier"), value: mod.expr }] },
          gap: target.gap ?? mod.gap,
          features: mergeFeatures(target.features, mod.features),
          byRule: false,
          step: "modify",
          back: [mod, target],
        }),
      );
    }
    return out;
  }

  /** Join, first half: the joining word takes its right side. */
  private joinRight(j: Edge, right: Edge): Edge | undefined {
    if (j.category !== "join" || j.joinRight || !this.complete(right)) return undefined;
    if (j.joins !== "Any" && j.joins !== right.category) return undefined;
    if (right.category === "Mark") return undefined;
    return this.make({ ...j, end: right.end, joinRight: right, features: mergeFeatures(j.features, right.features), step: "joinright", back: [j, right] });
  }

  /** Join, second half: two adjacent spans of the same category become Head(left, right). */
  private joinLeft(left: Edge, jr: Edge): Edge | undefined {
    const right = jr.joinRight;
    if (!right || !this.complete(left) || left.category !== right.category) return undefined;
    const head = (jr.expr as Call).head;
    const leftArgs = isHead(left.expr, head) && left.step === "join" ? positional(left.expr) : [left.expr];
    return this.make({
      start: left.start,
      end: jr.end,
      category: left.category,
      expr: c(head, ...leftArgs, right.expr),
      word: head,
      gap: left.gap ?? right.gap,
      features: mergeFeatures(left.features, jr.features),
      step: "join",
      back: [left, jr],
    });
  }

  /** Compose: a head's nearest argument is filled by an edge that still lacks its own (CCG B>). */
  private compose(head: Edge, arg: Edge): Edge | undefined {
    const p = head.pending[0];
    const q = arg.pending[0];
    if (!p || !q || p.takes.side !== "Right" || q.takes.side !== "Right") return undefined;
    if (this.complete(arg) || (p.takes.category !== arg.category && p.takes.category !== "Any")) return undefined;
    if (head.pending.length + arg.pending.length > 3) return undefined;
    const at = argCount(head.expr, p.path);
    const expr = addArg(head.expr, p.path, p.takes.role, arg.expr);
    const inner = arg.pending.map((x) => ({ takes: x.takes, path: [...p.path, at, ...x.path] }));
    return this.make({
      ...head,
      end: arg.end,
      expr,
      pending: [...inner, ...head.pending.slice(1)],
      acceptsGap: arg.acceptsGap ?? head.acceptsGap,
      features: mergeFeatures(head.features, arg.features),
      byRule: false,
      step: "compose",
      back: [head, arg],
    });
  }

  /** Gap: a pending argument is marked filled by Gap(), to be filled by a displaced phrase. */
  private gapVariant(e: Edge): Edge | undefined {
    const p = e.pending[0];
    if (!p || e.gap || !this.hasGapWord) return undefined;
    return this.make({
      ...e,
      expr: addArg(e.expr, p.path, p.takes.role, c("Gap")),
      pending: e.pending.slice(1),
      gap: p.takes.category,
      byRule: false,
      step: "gap",
      back: [e],
    });
  }

  private noise(token: number): boolean {
    const cs = this.hearing.candidates[token];
    return cs.every((x) => x.source === "Unknown") || cs.some((x) => x.concept && this.store.facts(x.concept, "Tone").length > 0);
  }

  /** Skip: a token is left out, at its cost (runtime.md 4.2 step 4). */
  private skip(e: Edge, token: number, side: "Left" | "Right"): Edge {
    const features = new Map(e.features);
    const toneOnly = this.hearing.candidates[token].some((x) => x.concept && this.store.facts(x.concept, "Tone").length);
    const source = this.hearing.candidates[token][0]?.source ?? "Unknown";
    if (!toneOnly) addFeature(features, `WordsUsed:Skipped:${source}`, -1);
    return this.make({ ...e, start: side === "Left" ? token : e.start, end: side === "Right" ? token + 1 : e.end, features, step: "skip", back: [e] });
  }

  // -------------------------------------------------------------------------------------------
  // Unary: what a complete edge becomes on its own

  private closure(e: Edge): Edge[] {
    const out: Edge[] = [];
    if (e.pending.length) {
      const g = this.gapVariant(e);
      if (g) out.push(g);
    }
    if (!this.ready(e)) return out;
    // An entry's wrapper or head replacement applies once its arguments are in.
    if (e.wraps || e.heads) {
      const expr = e.heads && isCall(e.expr) ? { ...e.expr, head: e.heads } : e.wraps ? c(e.wraps, e.expr) : e.expr;
      out.push(this.make({ ...e, expr, wraps: undefined, heads: undefined, step: "wrap", back: [e] }));
      return out;
    }
    // A category concept's own entries (predication: an Act takes its subject on the left).
    for (const en of this.entries(e.category).entries) {
      if (!isCall(e.expr)) continue;
      out.push(
        this.make({
          ...e,
          category: en.category,
          pending: en.takes.map((t) => ({ takes: t, path: [] })),
          modifies: en.modifies,
          wraps: en.wraps,
          heads: en.heads,
          acceptsGap: en.fillsGap ?? e.acceptsGap,
          anyCategory: false,
          step: "entry",
          back: [e],
        }),
      );
    }
    if (!e.byRule) out.push(...this.applyRules(e, [e.category, ...e.formFeatures, ...(e.word ? [e.word] : [])].flatMap((o) => this.rulesOn(o))));
    return out;
  }

  /** Lexical rules: readings whose pattern is a category head over the edge's expression. */
  private applyRules(e: Edge, rules: ReadingItem[]): Edge[] {
    const out: Edge[] = [];
    for (const r of rules) {
      const pat = r.pattern as Call;
      if (pat.head !== e.category || !r.becomes || !isCall(r.becomes)) continue;
      const inner = positional(pat)[0];
      const m = inner && match(inner, e.expr, this.store);
      if (!m) continue;
      const result = instantiate(r.becomes, m.bindings) as Call;
      if (!CATEGORY_HEADS.has(result.head)) continue;
      const features = new Map(e.features);
      addFeature(features, `Rule:${readingKey(r)}`, 1);
      out.push(this.make({ ...e, category: result.head, expr: positional(result)[0], pending: [], modifies: [], byRule: true, features, step: `rule ${r.meta.id}`, back: [e] }));
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Building

  private sigs = new Map<string, Map<string, Edge>>();

  /**
   * Adds an edge to its span unless an equal edge scores as well, and keeps at most k edges per
   * category and pending state as they arrive (runtime.md 4.4), so a span never grows past what
   * pruning would keep.
   */
  private add(s: number, e: number, edge: Edge, agenda: Edge[]) {
    const cellKey = `${s}:${e}`;
    let sigs = this.sigs.get(cellKey);
    if (!sigs) this.sigs.set(cellKey, (sigs = new Map()));
    const sig = signature(edge);
    const same = sigs.get(sig);
    if (same && same.score >= edge.score) return;
    const cell = this.cell(s, e);
    const g = group(edge);
    const rivals = cell.filter((x) => group(x) === g);
    if (!same && rivals.length >= this.opts.k) {
      const worst = rivals.reduce((a, b2) => (b2.score < a.score ? b2 : a));
      if (worst.score >= edge.score) return;
      cell.splice(cell.indexOf(worst), 1);
      sigs.delete(signature(worst));
    }
    if (same) cell.splice(cell.indexOf(same), 1);
    cell.push(edge);
    sigs.set(sig, edge);
    agenda.push(edge);
  }

  private prune(_s: number, _e: number) {}

  build(): this {
    const { from, to } = this;
    for (let len = 1; len <= to - from; len++) {
      for (let s = from; s + len <= to; s++) {
        const e = s + len;
        const agenda: Edge[] = [];
        for (const cand of this.hearing.candidates[s]) if (cand.end === e) for (const w of this.wordEdges(cand)) this.add(s, e, w, agenda);
        for (let m = s + 1; m < e; m++) {
          for (const a of this.cell(s, m))
            for (const b2 of this.cell(m, e)) for (const x of this.combine(a, b2)) this.add(s, e, x, agenda);
        }
        // Skip inside an edge: an edge passes over an adjacent token that is noise to it (a word it
        // has no candidate for, or a tone word), so the words around it still combine. Skipping a
        // known word happens between the edges of a cover instead, at the same cost; doing it here
        // too multiplies the chart without adding a reading the cover cannot reach.
        if (len > 1) {
          if (this.noise(e - 1)) for (const x of this.cell(s, e - 1)) this.add(s, e, this.skip(x, e - 1, "Right"), agenda);
          if (this.noise(s)) for (const x of this.cell(s + 1, e)) this.add(s, e, this.skip(x, s, "Left"), agenda);
        }
        // Unary closure, bounded.
        for (let guard = 0; agenda.length && guard < 400; guard++) {
          const x = agenda.shift()!;
          for (const y of this.closure(x)) this.add(s, e, y, agenda);
        }
        this.prune(s, e);
      }
    }
    return this;
  }

  private combine(a: Edge, b2: Edge): Edge[] {
    const out: Edge[] = [];
    const push = (x: Edge | undefined) => x && out.push(x);
    push(this.take(a, b2, "Right"));
    push(this.take(b2, a, "Left"));
    out.push(...this.modify(a, b2, "Right"));
    out.push(...this.modify(b2, a, "Left"));
    push(this.joinRight(a, b2));
    push(this.joinLeft(a, b2));
    push(this.compose(a, b2));
    return out;
  }

  /** What an edge of a cover may be as a whole segment or fragment: itself, and its moods. */
  variants(e: Edge): Edge[] {
    return [e, ...this.applyRules({ ...e, byRule: false }, this.segmentRules)];
  }

  /** Every edge spanning [s, e). */
  edges(s = this.from, e = this.to): Edge[] {
    return this.cell(s, e);
  }

  /**
   * The top covers (runtime.md 4.7): sequences of complete edges spanning the segment, with
   * skips. A cover piece may be a segment rule's variant of an edge (moods, fragments).
   */
  covers(): Cover[] {
    const { from, to } = this;
    const best: Cover[][] = Array.from({ length: to - from + 1 }, () => []);
    best[0] = [{ edges: [], skipped: [], features: new Map(), score: 0 }];
    const tops = new Map<string, Edge[]>();
    const topsOf = (s: number, e: number) => {
      const k = `${s}:${e}`;
      let t = tops.get(k);
      if (!t) {
        // Mood and fragment variants (segment rules) are chosen per edge, after the cover
        // (Chart.variants), so they do not multiply the covers.
        t = this.cell(s, e).filter((x) => this.complete(x) && x.category !== "Mark" && !x.gap);
        tops.set(k, t);
      }
      return t;
    };
    for (let i = 1; i <= to - from; i++) {
      const options: Cover[] = [];
      // Skip token i-1.
      for (const cv of best[i - 1]) {
        const features = new Map(cv.features);
        const toneOnly = this.hearing.candidates[from + i - 1].some((x) => x.concept && this.store.facts(x.concept, "Tone").length);
        if (!toneOnly) addFeature(features, `WordsUsed:Skipped:${this.hearing.candidates[from + i - 1][0]?.source ?? "Unknown"}`, -1);
        options.push({ edges: cv.edges, skipped: [...cv.skipped, from + i - 1], features, score: scoreOf(features, this.weights) });
      }
      for (let j = 0; j < i; j++)
        for (const top of topsOf(from + j, from + i))
          for (const cv of best[j]) {
            const features = mergeFeatures(cv.features, top.features);
            // A partial parse is allowed; each extra fragment costs half a word used together.
            if (cv.edges.length) addFeature(features, "WordsUsed:Fragments", -0.5);
            options.push({ edges: [...cv.edges, top], skipped: cv.skipped, features, score: scoreOf(features, this.weights) });
          }
      const seen = new Set<string>();
      best[i] = options
        .sort((x, y) => y.score - x.score)
        .filter((cv) => {
          const sig = cv.edges.map((e) => key(e.expr)).join(" | ");
          if (seen.has(sig)) return false;
          seen.add(sig);
          return true;
        })
        .slice(0, this.opts.covers);
    }
    return best[to - from];
  }
}

// ---------------------------------------------------------------------------------------------

/** The chart entries of a concept: its Category facts (each with nested Takes...) and Joins facts. */
export function entriesOf(store: Store, concept: string) {
  const entries: { category: string; takes: TakesSpec[]; modifies: ModifiesSpec[]; wraps?: string; heads?: string; fillsGap?: string }[] = [];
  for (const f of store.facts(concept, "Category")) {
    const claim = f.claim as Call;
    const [cat, ...subs] = positional(claim);
    if (!isCall(cat)) continue;
    const takes: TakesSpec[] = [];
    const modifies: ModifiesSpec[] = [];
    let fillsGap: string | undefined;
    for (const sub of subs) {
      if (!isCall(sub)) continue;
      const side = (headOf(role(sub, "side")) ?? "Right") as "Left" | "Right";
      const category = headOf(role(sub, "category")) ?? "Any";
      if (sub.head === "Takes")
        takes.push({ side, category, role: headOf(role(sub, "role")), head: headOf(role(sub, "head")), optional: boolOf(role(sub, "optional")) });
      else if (sub.head === "Modifies") modifies.push({ side, category, role: headOf(role(sub, "role")) });
      else if (sub.head === "FillsGap") fillsGap = category;
    }
    entries.push({ category: cat.head, takes, modifies, wraps: headOf(role(claim, "wraps")), heads: headOf(role(claim, "heads")), fillsGap });
  }
  const joins = store.facts(concept, "Joins").map((f) => headOf(role(f.claim, "category")) ?? "Any");
  return { entries, joins };
}

const headOf = (e: Expr | undefined) => (isCall(e) ? e.head : undefined);
const boolOf = (e: Expr | undefined) => e?.kind === "boolean" && e.value;
const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);

function argCount(e: Expr, path: number[]): number {
  let x = e;
  for (const i of path) x = (x as Call).args[i].value;
  return (x as Call).args.length;
}

function addArg(e: Expr, path: number[], roleName: string | undefined, value: Expr): Expr {
  if (!isCall(e)) return e;
  if (!path.length) return { ...e, args: [...e.args, roleName ? { name: lowerFirst(roleName), value } : { value }] };
  const [i, ...rest] = path;
  const args = e.args.slice();
  args[i] = { ...args[i], value: addArg(args[i].value, rest, roleName, value) };
  return { ...e, args };
}

function group(x: Edge): string {
  return `${x.category}|${x.pending.length}|${x.gap ?? ""}|${x.joinRight ? "j" : ""}|${x.wraps ?? ""}${x.heads ?? ""}`;
}

const signatures = new WeakMap<Edge, string>();

function signature(e: Edge): string {
  const have = signatures.get(e);
  if (have) return have;
  const sig = computeSignature(e);
  signatures.set(e, sig);
  return sig;
}

function computeSignature(e: Edge): string {
  return [e.category, key(e.expr), e.pending.map((p) => `${p.takes.side}${p.takes.category}${p.takes.role ?? ""}@${p.path.join(".")}`).join(","), e.gap ?? "", e.joinRight ? key(e.joinRight.expr) : "", e.wraps ?? "", e.heads ?? "", e.modifies.length, e.byRule].join("|");
}

export { roles };
