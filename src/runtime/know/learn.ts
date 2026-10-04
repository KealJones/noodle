// Know, step 3 (design section 21): what came back is understood, not only kept. A page's opening
// is heard by Noodle's own pipeline (hearing, the chart, rewriting by the seed's own readings) and
// what it says of the page's subject becomes facts on a concept for that subject, with the page as
// their source; Wikidata's claims, already structure, become facts directly, each property's
// label heard like any word. A later question that names the subject is answered from the facts
// (recall), without going out.
//
// Nothing here knows a word: which words a title or a sentence has, and what they do, is the
// store's; which reading of a sentence is taken is the chart's score; what is a function word is
// the seed's provenance.

import { type Call, type Expr, c, isCall, isHead, key, n, positional, rewrite as mapExpr, role, s, walk } from "../expr.js";
import { Chart, DEFAULT_CHART } from "../chart.js";
import { hear } from "../hear.js";
import { PRIMITIVES } from "../primitives/index.js";
import { Rewriter } from "../rewrite.js";
import { Weights } from "../score.js";
import type { FactItem, ReadingItem, Store } from "../store.js";
import { STRUCTURAL_NAMES } from "../../structural.js";
import type { Claim, Found } from "./sources.js";

export interface Learned {
  /** The concept the page is about. */
  topic: string;
  /** Facts kept: from the opening, and from claims. */
  facts: FactItem[];
  /** Parts of the opening heard that said nothing of the subject, and claims whose label was not one phrase. */
  dropped: { opening: number; claims: number };
}

/** A recalled answer: what to say, and where it came from. */
export interface Recalled {
  answer: Expr;
  from: Expr;
  /**
   * How it answers: a fact of the relation asked about, what the topic's page said of it, or the
   * page itself as it was kept (words looked up before, not understood).
   */
  via: "Relation" | "Description" | "Page";
}

const FUNCTION_WORDS = key(c("Seed", s("function-words")));

export class Learner {
  private weights: Weights;
  private rewriter: Rewriter;
  private labels = new Map<string, Expr | undefined>();

  constructor(readonly store: Store) {
    this.weights = new Weights(store);
    // An opening is reduced by the seed's own readings ("is a" to Be, "a" to Some) and stops
    // there: readings that act are for requests, as when a definition is understood.
    this.rewriter = new Rewriter(store, this.weights.get, { mode: "Doing", beam: 3, maxSteps: 16, allow: (r) => this.reduces(r) });
  }

  private reduces(r: ReadingItem): boolean {
    if (PRIMITIVES.has(r.owner) || r.effects.length || !isCall(r.meta.from) || r.meta.from.head !== "Seed") return false;
    return !r.becomes || ![...walk(r.becomes)].some((x) => isCall(x) && PRIMITIVES.has(x.head));
  }

  private functionWord(concept: string): boolean {
    return this.store.facts(concept).some((f) => key(f.meta.from) === FUNCTION_WORDS);
  }

  /**
   * What a heard thing is, its determiners aside: a referent is its kind, and a function word
   * wrapping one thing ("the", "a") is that thing. Literals compare without case.
   */
  core(x: Expr): Expr {
    if (x.kind === "string") return s(x.value.toLowerCase());
    if (!isCall(x)) return x;
    if (x.head === "Ref") return this.core(role(x, "kind") ?? role(x, "said") ?? x);
    const pos = positional(x);
    if (pos.length === 1 && x.args.length === 1 && this.functionWord(x.head)) return this.core(pos[0]);
    return x;
  }

  /** The best reading of a text: the chart's best cover, each piece as the seed's readings reduce it. */
  private heard(text: string, open = false): { exprs: Expr[]; skipped: number } {
    return this.readings(text, open)[0] ?? { exprs: [], skipped: 0 };
  }

  /**
   * The readings of a text that tie with the best (by the chart's score), each piece with its
   * category, as the seed's readings reduce it. A reading that ties with the best is kept beside
   * it: nothing says which was meant (as for a definition's readings).
   */
  private readings(text: string, open = false): { exprs: Expr[]; categories: string[]; skipped: number }[] {
    // A page is edited text: its words are heard as written, never as a misspelling of another
    // ("largest" is not "largess"); a word nothing knows stays itself.
    const h = hear(this.store, text, { names: [] });
    if (!h.tokens.length) return [];
    h.candidates = h.candidates.map((cs) => cs.filter((x) => x.source !== "SpellDistance"));
    const chart = new Chart(this.store, h, 0, h.tokens.length, this.weights.get, { ...DEFAULT_CHART, open }).build();
    const covers = chart.covers();
    const best = covers[0]?.score;
    return covers
      .filter((cv) => cv.score >= best - 1e-9)
      .slice(0, 3)
      .map((cv) => ({
        exprs: cv.edges.map((e) => this.rewriter.normalize(e.expr)[0]?.expr ?? e.expr),
        categories: cv.edges.map((e) => e.category),
        skipped: cv.skipped.length,
      }));
  }

  /**
   * The concept a page is about, named from its title. A title that is one word nothing knows
   * ("France") makes that word the topic's own; the title as heard is kept (Heard), so a question
   * that names the topic in the same words reaches it; and the topic is said by its title.
   */
  topic(f: Found): string {
    const name = topicName(f);
    const from = sourceOf(f);
    if (this.store.facts(name).length) return name;
    const h = hear(this.store, f.title, { names: [] });
    const known = (i: number) => h.candidates[i].some((x) => x.source === "Exact" || x.source === "Inflected" || x.source === "Stretched");
    this.store.addFact(name, c("Category", c("Thing")), from);
    if (h.tokens.length === 1 && !known(0) && /^\p{L}+$/u.test(h.tokens[0].text)) this.store.addFact(name, c("Lemma", s(h.tokens[0].text.toLowerCase())), from);
    const { exprs } = this.heard(f.title);
    const heard = exprs.length === 1 ? this.core(exprs[0]) : undefined;
    if (heard && !isHead(heard, name)) this.store.addFact(name, c("Heard", heard), from);
    this.store.addReading({ owner: name, pattern: c(name), becomes: s(f.title), mode: "Speaking", wants: [], needs: [], effects: [], checks: [], direction: "Expand" }, from);
    return name;
  }

  /** Whether an expression is the topic: the topic itself, or heard as its title is. */
  private isTopic(x: Expr, topic: string): boolean {
    if (isCall(x) && x.head === topic) return true;
    const k = key(this.core(x));
    return this.store.facts(topic, "Heard").some((h) => key(positional(h.claim as Call)[0]) === k);
  }

  /** The opening sentence of a page's text, asides in brackets left out. */
  private opening(text: string): string {
    const plain = text.replace(/\s*\([^()]*\)/g, "").replace(/\s+/g, " ").trim();
    return plain.split(/(?<=[.!?])\s+(?=\p{Lu})/u)[0] ?? plain;
  }

  /**
   * What a sentence claims, heard as a page's opening is: each clause of its best readings, once.
   * Nothing is kept; the caller says what it is about and how sure it is (the tutor's because).
   */
  claims(text: string): Expr[] {
    const out = new Map<string, Expr>();
    for (const r of this.readings(this.opening(text))) r.exprs.forEach((e, i) => r.categories[i] === "Clause" && out.set(key(e), e));
    return [...out.values()];
  }

  /**
   * What a text says of kinds of things (a manual's description, a tutor's because): each
   * sentence heard as a page's opening is, asides kept (a bracketed list after a noun is heard as
   * the seed's brackets are), each clause of its best readings, a conjunction or disjunction of
   * clauses taken clause by clause. A clause whose subject is a kind said of any one ("an open
   * file", "a socket") says something of that kind: a fact on the kind's concept, the subject left
   * out (as PartOf and IsA are on what they are said of). The seed's readings say what such a
   * clause is ("an X is a Y": IsA; "an X may be a Y": a Y is a kind of X; "part of": PartOf).
   * A statement from a sentence only part of which was heard (words skipped, or pieces beside the
   * clause) is partial: kept Pending, a proposal, until it proves out.
   */
  statements(text: string, maxWords = Infinity): Statement[] {
    const out = new Map<string, Statement>();
    // A sentence's full stop says nothing of what it says (as a summary's does not).
    for (const sentence of sentences(text)) {
      if (sentence.split(" ").length > maxWords) continue;
      for (const r of this.readings(sentence.replace(/[.!?](?=[)\]"']?$)/, ""))) {
        const partial = r.skipped > 0 || r.exprs.length > 1;
        r.exprs.forEach((e, i) => {
          if (r.categories[i] !== "Clause") return;
          for (const clause of clausesOf(e)) {
            const st = this.stated(clause, partial);
            const k = st && `${st.subject} ${key(st.claim)}`;
            if (st && (!out.has(k!) || (out.get(k!)!.partial && !partial))) out.set(k!, st);
          }
        });
      }
    }
    return [...out.values()];
  }

  /** A clause said of a kind (its first part "some X"): a statement on X, without it. */
  private stated(clause: Expr, partial: boolean): Statement | undefined {
    if (!isCall(clause)) return undefined;
    const pos = positional(clause);
    const first = pos[0];
    if (!isHead(first, "Some") || pos.length < 2) return undefined;
    const kind = this.core(positional(first as Call)[0] ?? first);
    if (!isCall(kind) || STRUCTURAL_NAMES.has(kind.head) || PRIMITIVES.has(kind.head) || this.functionWord(kind.head)) return undefined;
    let dropped = false;
    const claim: Call = { ...clause, args: clause.args.filter((a) => (a.value === first && !dropped ? !(dropped = true) : true)) };
    // What a concept is said to be of itself ("a regular file is an open file", on File) says nothing of the concept.
    if (claim.args.length === 1 && isHead(this.core(positional(claim)[0]), kind.head)) return undefined;
    return { subject: kind.head, claim, partial };
  }

  /** Understand what was found, and the claims on its entity: facts on its topic. */
  learn(f: Found, claims: Claim[] = []): Learned {
    const topic = this.topic(f);
    const from = sourceOf(f);
    const out: Learned = { topic, facts: [], dropped: { opening: 0, claims: 0 } };
    const block = this.store.addBlock(f.text, "text/plain", from);
    this.store.addFact(topic, c("Said", c("Block", s(block.id))), from);
    const have = new Set(this.store.facts(topic).map((x) => key(x.claim)));
    const keep = (claim: Expr, src: Expr) => {
      if (have.has(key(claim))) return;
      have.add(key(claim));
      out.facts.push(this.store.addFact(topic, claim, src));
    };
    // The opening: each clause of its best readings that names the subject is a fact about it. A
    // piece that is only a thing (a referent heard on its own) claims nothing.
    for (const r of this.readings(this.opening(f.text)))
      r.exprs.forEach((e, i) => {
        let named = false;
        const fact = mapExpr(e, (x) => (this.isTopic(x, topic) ? ((named = true), c(topic)) : undefined));
        if (named && r.categories[i] === "Clause") keep(fact, from);
        else out.dropped.opening++;
      });
    // Claims: the property, heard as one phrase, said of the topic and the value. A label heard
    // with an argument left open ("instance of", "located in") has the value there; otherwise the
    // property relates the topic to the value.
    const cfrom = f.entity ? c("Wikidata", s(`https://www.wikidata.org/wiki/${f.entity}`)) : from;
    for (const cl of claims) {
      const rel = this.label(cl.property);
      if (!rel || !isCall(rel)) {
        out.dropped.claims++;
        continue;
      }
      const value = typeof cl.value === "number" ? (cl.unit ? s(`${format(cl.value)} ${cl.unit}`) : n(cl.value)) : s(cl.value);
      let filled = false;
      const inGap = mapExpr(rel, (x) => (isCall(x) && x.head === "Gap" && !x.args.length ? ((filled = true), value) : undefined)) as Call;
      keep(filled ? { ...inGap, args: [{ value: c(topic) }, ...inGap.args] } : { ...rel, args: [{ value: c(topic) }, { value }, ...rel.args] }, cfrom);
    }
    return out;
  }

  /**
   * A property's label as one phrase the store knows, or nothing: heard whole, or with one
   * argument left open (the value's place), whichever the chart scores higher.
   */
  private label(text: string): Expr | undefined {
    if (this.labels.has(text)) return this.labels.get(text);
    const gaps = (e: Expr) => [...walk(e)].filter((x) => isCall(x) && x.head === "Gap" && !x.args.length).length;
    const whole = this.readings(text, true).find((r) => r.exprs.length === 1 && !r.skipped && gaps(r.exprs[0]) <= 1);
    const e = whole ? this.core(whole.exprs[0]) : undefined;
    const out = isCall(e) && !STRUCTURAL_NAMES.has(e.head) ? e : undefined;
    this.labels.set(text, out);
    return out;
  }

  /**
   * An answer from the graph to a question's proposition: the first topic it names, and what is
   * known of it. The question's other content words are the relation asked about: a fact whose
   * head is one of them, or a kind of one, answers it. A question with no word of its own beside
   * the topic ("what is a mitochondrion") is answered by what the topic's own page said of it.
   */
  recall(p: Expr): Recalled | undefined {
    const found = this.find(p, []);
    if (!found) return undefined;
    const { topic, path } = found;
    // The relation asked about: the words the topic is said in at the nearest level that has
    // any, the word it is said of and the words beside it there ("the boiling point of water":
    // point, boiling). The seed's own words ("who" is someone, "when" a time, "of") say what the
    // answer is, not what it is of. A topic that only qualifies another thing ("berlin" in "the
    // berlin wall") is asked about only as that thing.
    const relations = new Set<string>();
    for (let i = path.length - 2; i >= 0 && !relations.size; i--) {
      const up = path[i] as Call;
      if (this.content(up.head)) relations.add(up.head);
      for (const a of up.args)
        if (a.value !== path[i + 1]) for (const x of walk(a.value)) if (isCall(x) && this.content(x.head)) relations.add(x.head);
    }
    const facts = this.store.facts(topic).filter((f) => !isHead(f.claim, "Heard") && [...walk(f.claim)].some((x) => isCall(x) && x.head === topic));
    if (relations.size) {
      for (const head of relations)
        for (const f of facts) {
          const claim = f.claim as Call;
          if (!this.relates(head, claim.head)) continue;
          // A claim relating the topic to a value is answered by the value ("who wrote hamlet":
          // William Shakespeare; "the capital of france": Paris), where the question says what
          // the claim's own words qualify it by (a rural population is not the population). A
          // clause the page said answers by itself, where it can be said whole.
          const [first, value] = positional(claim);
          if (value !== undefined && isCall(first) && first.head === topic) {
            const qualifiers = claim.args.filter((a) => a.name !== undefined).flatMap((a) => [...walk(a.value)]);
            if (qualifiers.every((x) => !isCall(x) || !this.content(x.head) || relations.has(x.head))) return { answer: value, from: f.meta.from, via: "Relation" };
          } else if (this.sayable(claim)) return { answer: claim, from: f.meta.from, via: "Relation" };
        }
      return undefined;
    }
    // What the topic's own page said of it, where it can be said whole ("photosynthesis is" a
    // system nothing has words for is kept, not said); failing that, the page itself, as kept.
    const said = this.store.facts(topic, "Said")[0];
    if (!said) return undefined;
    const own = facts.find((f) => key(f.meta.from) === key(said.meta.from) && this.sayable(f.claim));
    return own ? { answer: own.claim, from: own.meta.from, via: "Description" } : { answer: positional(said.claim as Call)[0], from: said.meta.from, via: "Page" };
  }

  /**
   * Whether the realizations say all of an expression: every call either says only its
   * positional parts, or has a Speaking reading of its own that says its roles.
   */
  private sayable(e: Expr): boolean {
    return [...walk(e)].every((x) => !isCall(x) || x.args.every((a) => a.name === undefined) || this.store.readingsFor(x.head).some((r) => r.mode === "Speaking"));
  }

  /**
   * Whether a word of the question names the relation a fact has: the same word, or a word one of
   * whose senses is a kind of a sense of the question's (WordNet: to author is to compose, a sense
   * of "write"). Not the other way: what made a thing is not who wrote it.
   */
  private relates(asked: string, has: string): boolean {
    if (asked === has) return true;
    const senses = (w: string) => new Set(this.store.facts(w, "Sense").map((f) => positional(f.claim as Call)[0]).filter(isCall).map((x) => x.head));
    const kinds = (sn: string) => this.store.facts(sn, "IsA").map((f) => positional(f.claim as Call)[0]).filter(isCall).map((x) => x.head);
    const a = senses(asked);
    const b = senses(has);
    const under = (xs: Set<string>, ys: Set<string>) => [...xs].some((x) => kinds(x).some((k) => ys.has(k)));
    return under(b, a);
  }

  /** A concept that is a word of the question's own: not structural, and not the seed's. */
  private content(concept: string): boolean {
    return !STRUCTURAL_NAMES.has(concept) && !PRIMITIVES.has(concept) && !this.store.facts(concept).some((f) => isCall(f.meta.from) && f.meta.from.head === "Seed");
  }

  /** The first topic an expression names, outermost first, and the path down to it. */
  private find(x: Expr, path: Expr[]): { topic: string; path: Expr[] } | undefined {
    const here = [...path, x];
    const t = this.topicOf(x);
    if (t) return { topic: t, path: here };
    if (isCall(x)) for (const a of x.args) {
      const r = this.find(a.value, here);
      if (r) return r;
    }
    return undefined;
  }

  private topics?: { topic: string; heard: string }[];

  private topicOf(x: Expr): string | undefined {
    if (isCall(x) && x.head.endsWith("#Topic") && this.store.facts(x.head, "Heard").length + this.store.facts(x.head, "Lemma").length) return x.head;
    if (isCall(x) && x.head === "Gap") return undefined;
    this.topics ??= this.store.factsWithHead("Heard").map((f) => ({ topic: f.subject, heard: key(positional(f.claim as Call)[0]) }));
    const k = key(this.core(x));
    return this.topics.find((t) => t.heard === k)?.topic;
  }

  /** Topics learned since the list was read are found too. */
  forget(): void {
    this.topics = undefined;
  }
}

/** Something a text says of a kind of thing: a claim on its concept. */
export interface Statement {
  subject: string;
  claim: Call;
  /** Heard from only part of its sentence. */
  partial: boolean;
}

/** A text's sentences: a full stop (or ! or ?), a closing bracket or quote after it, then a capital or an opening bracket. */
export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?][)\]"']?)\s+(?=[\p{Lu}(])/u)
    .filter(Boolean);
}

/** A clause's parts that are clauses on their own: a conjunction or disjunction of them, each. */
function clausesOf(e: Expr): Expr[] {
  return isCall(e) && (e.head === "And" || e.head === "Or") && e.args.every((a) => a.name === undefined) ? e.args.flatMap((a) => clausesOf(a.value)) : [e];
}

/** Where what was found came from: the source, and its address where it has one. */
export function sourceOf(f: Found): Expr {
  return f.url ? c(f.source, s(f.url)) : c(f.source);
}

/** The concept a page is about, named from its title. */
export function topicName(f: Pick<Found, "title">): string {
  return `${encode(f.title) ?? "Page"}#Topic`;
}

/** A concept name from a title: letters and digits kept, each word capitalized. */
function encode(title: string): string | undefined {
  const out = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
  return /^[A-Z][A-Za-z0-9]*$/.test(out) ? out : undefined;
}

function format(x: number): string {
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
}
