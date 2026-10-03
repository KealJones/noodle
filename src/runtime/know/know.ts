// Know (design section 21; runtime.md section 14): the one door to knowledge from outside.
//   1. if the graph holds it and it is fresh, return it;
//   2. else ask the live sources that answer that kind of question, in order;
//   3. understand what came back (learn.ts: a page's opening heard into facts on what it is
//      about, an entity's claims kept as facts), and keep it as content too, with its source;
//   4. save it with provenance; return it.
// During Suppose, Know answers from the graph and the cache only: nothing leaves the machine.
// Offline, it never does: what the graph holds and what was kept are all it has.

import { createHash } from "node:crypto";
import { type Call, type Expr, c, isCall, isHead, n, positional, role, s } from "../expr.js";
import type { Store } from "../store.js";
import { type Learned, Learner, type Recalled, sourceOf, topicName } from "./learn.js";
import { type Found, type PageDoc, type SearchResult, page, pageDoc, webSearch, wikidata, wikidataClaims, wikipedia, wikipediaTopic, wiktionary } from "./sources.js";

export interface Knowledge {
  block: string;
  title: string;
  url: string;
  source: string;
}

/** How long an answer stays fresh, in days (a fact on a source, here its starting value). */
const FRESH_DAYS = 30;

export interface KnowOptions {
  /** Never go out: answer from the graph and what was kept. */
  offline?: boolean;
  /**
   * The last source, asked a question in its own words and answering in its own (ChatGPT,
   * through the program the config names: Run, held as sending outside). Absent, it is not asked.
   */
  chatgpt?: (question: string) => Promise<string | undefined>;
}

export class Know {
  readonly learner: Learner;
  /** What learning found, for the report (fact counts per page). */
  readonly learned: Learned[] = [];

  constructor(
    readonly store: Store,
    readonly now: () => Date,
    readonly opts: KnowOptions = {},
  ) {
    this.learner = new Learner(store);
  }

  /** An answer from the graph to a question's proposition (step 1), or none. */
  recall(p: Expr): Recalled | undefined {
    return this.learner.recall(p);
  }

  /** Understand what was found: its opening, and its entity's claims where the source names one. */
  private async understand(f: Found): Promise<void> {
    // A page understood once is not heard again.
    if (this.store.facts(topicName(f), "Said").length) return;
    const claims = f.entity && !this.opts.offline ? await wikidataClaims(f.entity).catch(() => []) : [];
    this.learned.push(this.learner.learn(f, claims));
    this.learner.forget();
  }

  /**
   * Learn about a thing a question names, by its words (step 2 and 3 for a thing): its page, its
   * claims. Once learned, it is not asked again; offline, nothing is.
   */
  async learnAbout(words: string): Promise<boolean> {
    if (this.opts.offline || this.cached("about", words)) return false;
    const found = await wikipediaTopic(words);
    if (!found || !this.about(found, words)) return false;
    this.keep("about", words, found);
    await this.understand(found);
    return true;
  }

  private keyOf(kind: string, q: string): string {
    return createHash("sha256").update(`${kind}|${q.trim().toLowerCase()}`).digest("hex").slice(0, 16);
  }

  /** What the graph already holds for this query, if fresh. */
  cached(kind: string, q: string): Knowledge | undefined {
    const k = this.keyOf(kind, q);
    for (const f of this.store.facts("Know", "Found").reverse()) {
      const claim = f.claim as Call;
      const [qk, block] = positional(claim);
      if (qk?.kind !== "string" || qk.value !== k || !isCall(block)) continue;
      const at = role(claim, "at");
      if (at?.kind === "string" && !this.opts.offline && (this.now().getTime() - Date.parse(at.value)) / 86400000 > FRESH_DAYS) continue;
      const id = positional(block)[0];
      const src = role(claim, "source");
      const title = role(claim, "title");
      const url = role(claim, "to");
      if (id?.kind !== "string") continue;
      return { block: id.value, title: title?.kind === "string" ? title.value : "", url: url?.kind === "string" ? url.value : "", source: isCall(src) ? src.head : "Web" };
    }
    return undefined;
  }

  private keep(kind: string, q: string, f: Found): Knowledge {
    const from = sourceOf(f);
    const block = this.store.addBlock(f.text, f.media ?? "text/plain", from);
    this.store.addFact(
      "Know",
      c("Found", s(this.keyOf(kind, q)), c("Block", s(block.id)), ["source", c(f.source)], ["title", s(f.title)], ["to", s(f.url)], ["at", s(this.now().toISOString())]),
      from,
    );
    return { block: block.id, title: f.title, url: f.url, source: f.source };
  }

  /**
   * An answer to a question. A question about a thing ("what is X", "who is X") is answered by the
   * thing's own page first; a question about a reason or a way ("why", "how") by a search for the
   * whole question; then the best matching entity's description, then the web. The question's own
   * words are the query (text passed to Know as a query is an index, not meaning: AGENTS.md rule 3).
   */
  async answer(question: string, topic?: string, about: "thing" | "reason" = "thing"): Promise<Knowledge | undefined> {
    const have = this.cached("answer", question);
    if (have || this.opts.offline) return have;
    const tries: (() => Promise<Found | undefined>)[] =
      about === "thing" && topic
        ? [() => wikipediaTopic(topic), () => wikipedia(question), () => wikidata(topic), () => this.webFound(question)]
        : [() => wikipedia(question), ...(topic ? [() => wikipediaTopic(topic)] : []), () => this.webFound(question)];
    for (const t of tries) {
      const found = await t();
      if (!found || !this.about(found, topic)) continue;
      const k = this.keep("answer", question, found);
      await this.understand(found).catch(() => undefined);
      return k;
    }
    // Before giving up, the last source: it answers the question itself, so what it says is about it.
    return this.ask(question, topic);
  }

  /**
   * ChatGPT's answer to a question (the last source, trust level 4): kept as content from it, and
   * understood into facts like any page, about what the question is about. What it says is a
   * proposal at most: it never grants or sets a rule (design section 20).
   */
  async ask(question: string, topic?: string): Promise<Knowledge | undefined> {
    const have = this.cached("ask", question);
    if (have || this.opts.offline || !this.opts.chatgpt) return have;
    const text = (await this.opts.chatgpt(question).catch(() => undefined))?.trim();
    if (!text) return undefined;
    const found: Found = { text, title: topic ?? question, url: "", source: "ChatGPT", media: "text/markdown" };
    const k = this.keep("ask", question, found);
    await this.understand(found).catch(() => undefined);
    return k;
  }

  /**
   * Whether what came back is about what was asked. Either every one of the question's own words
   * (its topic) is in the page's title or opening, or the page's title is made only of the
   * question's words and names at least half of them ("Fall of the Berlin Wall" for "what year did
   * the berlin wall fall"). A page whose title brings words of its own and that misses some of the
   * topic ("Tell Jemmeh" for "tell me a joke", "Happy path" for "a synonym for happy") is about
   * something else, and saying so honestly is better than saying it.
   */
  private about(f: Found, topic: string | undefined): boolean {
    if (!topic) return true;
    const split = (x: string) => x.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
    const words = split(topic);
    if (!words.length) return true;
    const stem = (w: string) => w.slice(0, Math.max(4, w.length - 2));
    const hay = `${f.title} ${f.text.slice(0, 400)}`.toLowerCase();
    if (words.every((w) => hay.includes(stem(w)))) return true;
    const title = split(f.title.replace(/\([^)]*\)/g, ""));
    const inTopic = (t: string) => words.some((w) => stem(w) === stem(t) || w.startsWith(stem(t)) || t.startsWith(stem(w)));
    const named = words.filter((w) => title.some((t) => stem(w) === stem(t) || w.startsWith(stem(t)) || t.startsWith(stem(w)))).length;
    return title.length > 0 && title.every(inTopic) && named * 2 >= words.length;
  }

  /**
   * What a page says of something specific (design section 21): the page read into structure,
   * its parts kept as facts on what it is about (Section(heading, level=, Paragraph(Block)...,
   * Item(Block)..., Row(...)..., Link(text, to=)..., Fields(Field(name)..., to=, method=)...)),
   * and the part whose heading names the most of the words asked about, where one does: a heading
   * word and an asked word that look up to the same concept ("Climate" for "climate"). Its words
   * are the answer, not the page's opening. Offline, only a page kept before is looked in.
   */
  async look(k: Knowledge, words: string[]): Promise<Knowledge | undefined> {
    if (!k.url || !words.length) return undefined;
    const topic = topicName({ title: k.title });
    const from: Expr = c(k.source, s(k.url));
    if (!this.store.facts(topic, "Section").length) {
      const doc = this.opts.offline ? undefined : await pageDoc(k.url).catch(() => undefined);
      if (!doc) return undefined;
      this.keepPage(topic, doc, from);
    }
    const concepts = (text: string) => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).flatMap((w) => this.store.lookup(w).map((h) => h.concept)));
    const asked = new Set(words.flatMap((w) => [...concepts(w)]));
    let best: { f: Call; n: number } | undefined;
    for (const f of this.store.facts(topic, "Section")) {
      const heading = positional(f.claim as Call)[0];
      if (heading?.kind !== "string") continue;
      const n = [...concepts(heading.value)].filter((x) => asked.has(x)).length;
      if (n && (!best || n > best.n)) best = { f: f.claim as Call, n };
    }
    if (!best) return undefined;
    const paras = positional(best.f)
      .filter((x) => isHead(x, "Paragraph") || isHead(x, "Item"))
      .map((x) => positional(x as Call)[0])
      .flatMap((b) => {
        const id = isCall(b) ? positional(b)[0] : undefined;
        const body = id?.kind === "string" ? this.store.block(id.value)?.body : undefined;
        return body ? [body] : [];
      });
    let text = "";
    for (const p of paras) {
      if (text && text.length + p.length > 900) break;
      text += (text ? "\n\n" : "") + p;
    }
    if (!text) return undefined;
    const heading = (positional(best.f)[0] as { value: string }).value;
    const anchor = role(best.f, "anchor");
    const block = this.store.addBlock(text, "text/plain", from);
    return { block: block.id, title: `${k.title}: ${heading}`, url: anchor?.kind === "string" ? `${k.url.split("#")[0]}#${anchor.value}` : k.url, source: k.source };
  }

  /** A page's parts, kept as facts on what it is about, each paragraph and item as a block. */
  private keepPage(topic: string, doc: PageDoc, from: Expr): void {
    const blockOf = (text: string) => c("Block", s(this.store.addBlock(text, "text/plain", from).id));
    for (const p of doc.parts) {
      const parts: Expr[] = [
        ...p.paragraphs.map((x) => c("Paragraph", blockOf(x))),
        ...p.items.map((x) => c("Item", blockOf(x))),
        ...p.rows.map((r) => c("Row", ...r.map((x) => s(x)))),
        ...p.links.slice(0, 50).map((l) => c("Link", s(l.text), ["to", s(l.to)])),
        ...p.forms.map((f) => c("Fields", ...f.fields.map((x) => c("Field", s(x))), ["to", s(f.to)], ["method", s(f.method)])),
      ];
      const roles: [string, Expr][] = [["level", n(p.level)]];
      if (p.anchor) roles.push(["anchor", s(p.anchor)]);
      this.store.addFact(topic, c("Section", s(p.heading), ...parts, ...roles), from);
    }
  }

  /** What a word means, from a dictionary. */
  async define(word: string): Promise<Knowledge | undefined> {
    const have = this.cached("define", word);
    if (have || this.opts.offline) return have;
    const found = await wiktionary(word);
    return found ? this.keep("define", word, found) : undefined;
  }

  /** A page by its URL. */
  async page(url: string): Promise<Knowledge | undefined> {
    const have = this.cached("page", url);
    if (have || this.opts.offline) return have;
    const found = await page(url);
    return found ? this.keep("page", url, found) : undefined;
  }

  /** A web search: its results, kept as one block. */
  async search(query: string): Promise<{ results: SearchResult[]; knowledge?: Knowledge }> {
    const results = this.opts.offline ? [] : await webSearch(query);
    if (!results.length) return { results };
    const text = results.map((r) => `${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
    return { results, knowledge: this.keep("search", query, { text, title: query, url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`, source: "Web" }) };
  }

  private async webFound(query: string): Promise<Found | undefined> {
    const results = await webSearch(query);
    const top = results.find((r) => r.snippet);
    return top ? { text: top.snippet, title: top.title, url: top.url, source: "Web" } : undefined;
  }
}
