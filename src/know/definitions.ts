// Understanding definitions (design section 6; PLAN.md phase 4, stage 0). An imported sense keeps
// its definition as a content block (Said(Block)); here the definition is heard with Noodle's own
// pipeline (hearing, the chart, rewriting) and becomes an Expand reading on the sense: the sense,
// said of something, becomes what the definition says of it. The definition's own words are
// resolved to senses, recursively and to a bounded depth, until everything in it is in the seed (a
// core meaning, a function word, a structural concept) or it fails. One that does not bottom out
// is kept Pending, with the words it is stuck on.
//
// A definition is said of something it does not name ("make visible" is said of what is shown),
// so its chart is built with open arguments: the argument the definition leaves open becomes the
// variable the sense's object fills. Which reading of a definition wins goes through the score
// (the chart's, then rewriting's), and which sense of a word in it is meant goes by the sense's
// rank (SenseFrequency) among the senses that bottom out; nothing here knows any word.

import { type Call, type Expr, c, isCall, isVar, key, positional, rewrite as mapExpr, s, v } from "../runtime/expr.js";
import { Chart, DEFAULT_CHART, type Edge, entriesOf } from "../runtime/chart.js";
import { hear } from "../runtime/hear.js";
import { PRIMITIVES } from "../runtime/primitives/index.js";
import { Rewriter } from "../runtime/rewrite.js";
import { Weights } from "../runtime/score.js";
import type { ReadingItem, Store } from "../runtime/store.js";
import { format } from "../ncon/index.js";
import { STRUCTURAL_NAMES } from "../structural.js";

/** Parts of speech to the chart categories their definitions are heard as. */
const CATEGORIES: Record<string, string[]> = {
  PartOfSpeechVerb: ["Act"],
  PartOfSpeechAdjective: ["Property"],
  PartOfSpeechAdverb: ["Manner"],
  PartOfSpeechNoun: ["Noun", "Thing"],
};
/** A word's chart category, as used in a definition, to the part of speech of the sense meant. */
const POS_OF: Record<string, string> = { Act: "PartOfSpeechVerb", Property: "PartOfSpeechAdjective", Manner: "PartOfSpeechAdverb", Noun: "PartOfSpeechNoun", Thing: "PartOfSpeechNoun" };

export interface Definition {
  sense: string;
  pos?: string;
  /** The part of the definition understood. */
  gloss: string;
  status: "Active" | "Pending";
  /** What the sense becomes: the definition, its words replaced by the senses meant. */
  becomes?: Expr;
  /** The patterns of the sense's reading (the object's roles, or none). */
  patterns: Expr[];
  /** How it bottomed out: through its definition, or (a noun) through its kinds. */
  via?: "Definition" | "Kind";
  /** Concepts it is stuck on. */
  unknown: string[];
  why?: "Unparsed" | "Depth" | "Unknown" | "NoDefinition";
  /** Expansion steps below it to the seed (0 when it is made of the seed directly). */
  depth: number;
}

export interface UnderstandOptions {
  /** Expansion steps a definition may take to bottom out (design section 6: bounded). */
  maxDepth: number;
  /** Whole readings of a definition tried, best first. */
  edges: number;
  /** Senses of a word tried, best first. */
  senses: number;
}

export const DEFAULT_UNDERSTAND: UnderstandOptions = { maxDepth: 3, edges: 3, senses: 2 };

interface Alt {
  expr: Expr;
  /** The definition's words, with the category each was heard as. */
  words: Map<string, string>;
}

interface Heard {
  sense: string;
  gloss?: string;
  pos?: string;
  /** Whole readings of the definition, best first. */
  alts: Alt[];
  /** Words of the definition nothing knows. */
  unheard: string[];
}

export class Understander {
  private heard = new Map<string, Heard>();
  private done = new Map<string, Definition>();
  private weights: Weights;
  private rewriter: Rewriter;
  private seedCache = new Map<string, boolean>();
  private sensesCache = new Map<string, string[]>();
  /** Definitions heard, and the time it took, for the report. */
  stats = { heard: 0, ms: 0 };

  constructor(
    readonly store: Store,
    readonly opts: UnderstandOptions = DEFAULT_UNDERSTAND,
  ) {
    this.weights = new Weights(store);
    // Rewriting a definition reduces it toward core meanings and stops there: readings that act
    // (a primitive, a command) are for requests, and readings already learned from definitions
    // are what is being worked out.
    this.rewriter = new Rewriter(store, this.weights.get, { mode: "Doing", beam: 3, maxSteps: 8, allow: (r) => this.reduces(r) });
  }

  private reduces(r: ReadingItem): boolean {
    if (PRIMITIVES.has(r.owner) || r.effects.length || this.isSense(r.owner)) return false;
    return !r.becomes || ![...walkCalls(r.becomes)].some((x) => PRIMITIVES.has(x.head));
  }

  isSense(concept: string): boolean {
    return this.store.facts(concept, "SenseOf").length > 0;
  }

  /** In the seed: structural, or with a fact the seed gives it (a core meaning, a function word). */
  inSeed(concept: string): boolean {
    let x = this.seedCache.get(concept);
    if (x === undefined) {
      x = STRUCTURAL_NAMES.has(concept) || this.store.facts(concept).some((f) => isCall(f.meta.from) && f.meta.from.head === "Seed");
      this.seedCache.set(concept, x);
    }
    return x;
  }

  /** A word's senses of a part of speech, most frequent first, as many as are tried. */
  sensesOf(word: string, pos: string | undefined): string[] {
    const k = `${word}|${pos ?? ""}`;
    let out = this.sensesCache.get(k);
    if (!out) {
      out = this.rewriter
        .senses(word)
        .filter((sn) => !pos || this.posOf(sn.sense) === pos)
        .slice(0, this.opts.senses)
        .map((sn) => sn.sense);
      this.sensesCache.set(k, out);
    }
    return out;
  }

  /** Hear a sense's definition once: its whole readings, as heard and as rewriting reduces them. */
  hearSense(sense: string): Heard {
    const have = this.heard.get(sense);
    if (have) return have;
    const pos = this.posOf(sense);
    const gloss = this.glossOf(sense);
    const out: Heard = { sense, gloss, pos, alts: [], unheard: [] };
    this.heard.set(sense, out);
    if (!gloss) return out;
    const t0 = performance.now();
    const cats = CATEGORIES[pos ?? ""] ?? ["Act"];
    // The whole definition; failing that, its head before the first comma (what follows a comma in
    // a WordNet definition is usually a qualification: "cause to have, in the abstract sense").
    let { edges, unheard } = this.wholeReadings(gloss, cats);
    out.unheard = unheard;
    const head = gloss.split(",")[0].trim();
    if (!edges.length && head !== gloss) {
      ({ edges } = this.wholeReadings(head, cats));
      if (edges.length) out.gloss = head;
    }
    const tried = new Set<string>();
    for (const e of edges) {
      const words = wordCategories(e);
      const template = mapExpr(e.expr, (x) => (isCall(x) && x.head === "Gap" && !x.args.length ? v("x") : undefined));
      // A definition that is a choice ("remove or make invisible") is each of its alternatives.
      const parts = isCall(template) && template.head === "Or" ? positional(template).filter(isCall) : [template];
      // As rewriting reduces it, best first (leaving it as heard is one of rewriting's alternatives).
      for (const part of parts)
        for (const expr of [...this.rewriter.normalize(part).slice(0, 3).map((d) => d.expr), part]) {
          if (tried.has(key(expr))) continue;
          tried.add(key(expr));
          out.alts.push({ expr, words });
        }
    }
    this.stats.heard++;
    this.stats.ms += performance.now() - t0;
    return out;
  }

  /** The chart's readings of a text that span all of it as one phrase of these categories, best first. */
  private wholeReadings(text: string, cats: string[]): { edges: Edge[]; unheard: string[] } {
    const h = hear(this.store, text, { names: [] });
    const chart = new Chart(this.store, h, 0, h.tokens.length, this.weights.get, { ...DEFAULT_CHART, open: true }).build();
    const seen = new Set<string>();
    const unheard = h.tokens.filter((_, i) => h.candidates[i].every((x) => x.source === "Unknown")).map((t) => t.text);
    const edges = chart
      .edges()
      .filter((e) => cats.includes(e.category) && !e.wraps && !e.heads && e.pending.every((p) => p.takes.optional) && (!e.gap || e.gap === "Thing"))
      .sort((a, b) => b.score - a.score)
      .filter((e) => {
        const k = key(e.expr);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, this.opts.edges);
    return { edges, unheard };
  }

  /** The senses a definition's words could mean (what has to be understood before it can be). */
  private dependencies(alt: Alt): string[] {
    const out: string[] = [];
    for (const x of walkCalls(alt.expr)) {
      if (this.inSeed(x.head)) continue;
      if (this.isSense(x.head)) out.push(x.head);
      else out.push(...this.sensesOf(x.head, POS_OF[alt.words.get(x.head) ?? ""]));
    }
    return out;
  }

  /**
   * Understand these senses (design section 6). Their definitions are heard, and the definitions
   * of the senses their words could mean, to the depth bound; then, level by level, a sense
   * bottoms out when one of its definition's readings is made of the seed and of senses that
   * bottomed out at an earlier level. A cycle never bottoms out on its own: it is grounded only
   * where one of its members reduces some other way.
   */
  understandAll(targets: string[], onProgress?: (n: number) => void): Definition[] {
    let frontier = [...new Set(targets)];
    const all = new Set(frontier);
    for (let d = 0; d <= this.opts.maxDepth && frontier.length; d++) {
      const next: string[] = [];
      for (const sn of frontier) {
        if (this.done.has(sn)) continue;
        const heard = this.hearSense(sn);
        onProgress?.(this.stats.heard);
        if (d === this.opts.maxDepth) continue;
        for (const alt of heard.alts)
          for (const dep of this.dependencies(alt))
            if (!all.has(dep)) {
              all.add(dep);
              next.push(dep);
            }
      }
      frontier = next;
    }
    // Level 0: definitions made of the seed alone, and nouns grounded by their kinds. Level d: made
    // of the seed and of senses of lower levels. Within a level nothing depends on the level itself.
    const level = new Map<string, number>();
    const chosen = new Map<string, Expr>();
    for (const sn of all) {
      const prior = this.done.get(sn);
      if (prior?.status === "Active") level.set(sn, prior.depth);
    }
    for (let d = 0; d <= this.opts.maxDepth; d++) {
      const now: [string, Expr | undefined][] = [];
      for (const sn of all) {
        if (level.has(sn)) continue;
        const heard = this.hearSense(sn);
        let got: Expr | undefined;
        for (const alt of heard.alts) {
          got = this.resolve(alt, level);
          if (got) break;
        }
        if (got || (d === 0 && heard.pos === "PartOfSpeechNoun" && this.groundedKind(sn))) now.push([sn, got]);
      }
      for (const [sn, expr] of now) {
        level.set(sn, d);
        if (expr) chosen.set(sn, expr);
      }
      if (!now.length) break;
    }
    const out: Definition[] = [];
    for (const sn of all) {
      const prior = this.done.get(sn);
      if (prior) {
        out.push(prior);
        continue;
      }
      const heard = this.hearSense(sn);
      const gloss = heard.gloss ?? "";
      let def: Definition;
      const lv = level.get(sn);
      if (lv !== undefined) {
        const expr = chosen.get(sn);
        def = expr
          ? { sense: sn, gloss, status: "Active", becomes: expr, patterns: this.patterns(sn, hasObject(expr)), via: "Definition", unknown: [], depth: lv }
          : { sense: sn, gloss, status: "Active", patterns: [], via: "Kind", unknown: [], depth: 0 };
      } else if (!heard.gloss) def = { sense: sn, gloss, status: "Pending", patterns: [], unknown: [], why: "NoDefinition", depth: 0 };
      else if (!heard.alts.length) def = { sense: sn, gloss, status: "Pending", patterns: [], unknown: heard.unheard.map((w) => JSON.stringify(w)), why: "Unparsed", depth: 0 };
      else {
        // Stuck: the reading with the fewest words that did not bottom out, and those words.
        let best: { expr: Expr; unknown: string[] } | undefined;
        for (const alt of heard.alts) {
          const unknown = [...new Set(this.stuckOn(alt, level))];
          if (!best || unknown.length < best.unknown.length) best = { expr: this.resolveLoose(alt, level), unknown };
        }
        // Stuck only because the depth bound stopped it hearing what its words mean.
        const unheard = heard.alts.some((a) => this.dependencies(a).some((x) => !this.heard.has(x)));
        def = { sense: sn, gloss, status: "Pending", becomes: best!.expr, patterns: this.patterns(sn, hasObject(best!.expr)), unknown: best!.unknown, why: unheard ? "Depth" : "Unknown", depth: 0 };
      }
      // A sense stopped by the depth bound may bottom out when understood as a target itself.
      def.pos = heard.pos;
      if (def.why !== "Depth") this.done.set(sn, def);
      out.push(def);
    }
    return out;
  }

  /** One sense, with what it needs. */
  understand(sense: string): Definition {
    return this.done.get(sense) ?? this.understandAll([sense]).find((d) => d.sense === sense)!;
  }

  /** The concept a word or sense in a definition resolves to, if one has bottomed out. */
  private meant(head: string, alt: Alt, level: Map<string, number>): string | undefined {
    if (this.isSense(head)) return level.has(head) ? head : undefined;
    return this.sensesOf(head, POS_OF[alt.words.get(head) ?? ""]).find((sn) => level.has(sn));
  }

  /** A reading of a definition with every word resolved to a sense that has bottomed out, or none. */
  private resolve(alt: Alt, level: Map<string, number>): Expr | undefined {
    let failed = false;
    const expr = mapExpr(alt.expr, (x) => {
      if (failed || x.kind === "string") {
        failed = true;
        return x;
      }
      if (!isCall(x) || this.inSeed(x.head)) return undefined;
      const head = this.meant(x.head, alt, level);
      if (!head) {
        failed = true;
        return x;
      }
      return { ...x, head, args: x.args.map((a) => ({ ...a, value: this.resolve({ expr: a.value, words: alt.words }, level) ?? ((failed = true), a.value) })) };
    });
    return failed ? undefined : expr;
  }

  /** The same, keeping words that did not resolve as they are (for a Pending reading). */
  private resolveLoose(alt: Alt, level: Map<string, number>): Expr {
    return mapExpr(alt.expr, (x) => {
      if (!isCall(x) || this.inSeed(x.head)) return undefined;
      const head = this.meant(x.head, alt, level) ?? x.head;
      return { ...x, head, args: x.args.map((a) => ({ ...a, value: this.resolveLoose({ expr: a.value, words: alt.words }, level) })) };
    });
  }

  /** The words in a reading that did not resolve. */
  private stuckOn(alt: Alt, level: Map<string, number>): string[] {
    const out: string[] = [];
    for (const x of walkAll(alt.expr)) {
      if (x.kind === "string") out.push(JSON.stringify(x.value));
      if (isCall(x) && !this.inSeed(x.head) && !this.meant(x.head, alt, level)) out.push(x.head);
    }
    return out;
  }

  /** A noun sense grounded by its kinds: one of them is a sense of a word the seed has. */
  groundedKind(sense: string): boolean {
    for (const k of this.store.kinds(sense).keys())
      for (const f of this.store.facts(k, "SenseOf")) {
        const w = positional(f.claim as Call)[0];
        if (isCall(w) && this.inSeed(w.head) && !STRUCTURAL_NAMES.has(w.head)) return true;
      }
    return false;
  }

  /**
   * The patterns a sense's reading matches: the sense said of its object, in each role its words'
   * chart entries give a single object; or the sense alone, whatever it is said of carried over.
   */
  private patterns(sense: string, open: boolean): Expr[] {
    if (!open) return [c(sense)];
    const roles = new Set<string>();
    for (const f of this.store.facts(sense, "SenseOf")) {
      const w = positional(f.claim as Call)[0];
      if (!isCall(w)) continue;
      for (const en of entriesOf(this.store, w.head).entries) {
        const objects = en.takes.filter((t) => t.side === "Right" && t.category === "Thing" && !t.head);
        if (en.category === "Act" && objects.length === 1 && objects[0].role) roles.add(objects[0].role);
      }
    }
    if (!roles.size) roles.add("Theme");
    return [...roles].map((r) => c(sense, [r[0].toLowerCase() + r.slice(1), v("x")]));
  }

  posOf(sense: string): string | undefined {
    const p = this.store.facts(sense, "PartOfSpeech").map((f) => positional(f.claim as Call)[0])[0];
    return isCall(p) ? p.head : undefined;
  }

  /** The definition's first part (WordNet separates alternatives with ";"), asides left out. */
  glossOf(sense: string): string | undefined {
    const said = this.store.facts(sense, "Said").map((f) => positional(f.claim as Call)[0])[0];
    const id = isCall(said) && said.head === "Block" ? positional(said)[0] : undefined;
    const body = id?.kind === "string" ? this.store.block(id.value)?.body : undefined;
    if (!body) return undefined;
    const first = body.split(";")[0].replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    return first || undefined;
  }
}

const hasObject = (e: Expr) => [...walkVars(e)].includes("$x");

/** Each word in an edge's derivation, with the category it was heard as. */
function wordCategories(e: Edge, out = new Map<string, string>()): Map<string, string> {
  if (e.step === "word" && e.word && !out.has(e.word)) out.set(e.word, e.category);
  for (const b of e.back) wordCategories(b, out);
  return out;
}

function* walkAll(e: Expr): Generator<Expr> {
  yield e;
  if (isCall(e)) for (const a of e.args) yield* walkAll(a.value);
}

function* walkCalls(e: Expr): Generator<Call> {
  for (const x of walkAll(e)) if (isCall(x)) yield x;
}

function* walkVars(e: Expr): Generator<string> {
  for (const x of walkAll(e)) if (isVar(x)) yield x.text;
}

/** The definitions as a pack: Expand readings on the senses, Pending where they did not bottom out. */
export function definitionsPack(store: Store, defs: Definition[], version: string): string {
  const forms: Expr[] = [c("Pack", ["name", s("definitions")], ["version", s(version)], ["from", c("Derived", c("WordNet", s("oewn")), c("Seed", s("core")))])];
  for (const d of defs) {
    if (d.via === "Kind") continue;
    // Only acts are expanded when a request is understood (runtime.md 7): a noun or a property in
    // a definition is a kind it names, checked here to bottom out but not rewritten later, since a
    // request's word heard as an act must not become what its noun sense means.
    const acts = d.pos === "PartOfSpeechVerb";
    const wn = store.facts(d.sense).find((f) => isCall(f.meta.from) && f.meta.from.head === "WordNet")?.meta.from ?? c("WordNet", s(d.sense));
    const from = c("Derived", wn, c("Seed", s("core")));
    const status: [string, Expr][] = d.status === "Pending" ? [["status", c("Pending")]] : [];
    if (d.becomes && acts) for (const p of d.patterns) forms.push(c("Reading", ["on", c(d.sense)], ["pattern", p], ["becomes", d.becomes], ["from", from], ...status));
    if (d.status === "Pending") forms.push(c("Fact", c(d.sense), c("NoReading", ...d.unknown.filter((u) => /^[A-Z]/.test(u)).map((u) => c(u))), ["from", from], ["status", c("Pending")]));
  }
  return format({ forms: forms as Call[] });
}

export interface Coverage {
  pos: string;
  lemmas: number;
  /** First senses that bottomed out through their definitions. */
  reduced: number;
  /** First senses (nouns) grounded only through their kinds. */
  kinds: number;
  /** First senses whose definition was not heard as one whole reading. */
  unparsed: number;
  /** Stopped by the depth bound. */
  depth: number;
}

/**
 * The first sense of each part of speech of each of these lemmas (most frequent first), for the
 * coverage measure of design section 6. A lemma counts where the store has it as a word with senses.
 */
export function firstSenses(u: Understander, lemmas: string[], parts: string[]): { lemma: string; pos: string; sense: string }[] {
  const out: { lemma: string; pos: string; sense: string }[] = [];
  const seen = new Set<string>();
  for (const lemma of lemmas) {
    const word = u.store.lookup(lemma).find((h) => h.text === lemma && !h.features.length && u.store.facts(h.concept, "Sense").length);
    if (!word) continue;
    for (const pos of parts) {
      const sense = u.sensesOf(word.concept, pos)[0];
      if (!sense || seen.has(sense)) continue;
      seen.add(sense);
      out.push({ lemma, pos, sense });
    }
  }
  return out;
}

export function coverage(targets: { pos: string; sense: string }[], defs: Map<string, Definition>): Coverage[] {
  const by = new Map<string, Coverage>();
  for (const t of targets) {
    const cv = by.get(t.pos) ?? { pos: t.pos, lemmas: 0, reduced: 0, kinds: 0, unparsed: 0, depth: 0 };
    by.set(t.pos, cv);
    cv.lemmas++;
    const d = defs.get(t.sense);
    if (d?.status === "Active" && d.via === "Definition") cv.reduced++;
    else if (d?.status === "Active") cv.kinds++;
    else if (d?.why === "Unparsed") cv.unparsed++;
    else if (d?.why === "Depth") cv.depth++;
  }
  return [...by.values()];
}
