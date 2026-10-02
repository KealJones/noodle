// Know (design section 21; runtime.md section 14): the one door to knowledge from outside.
//   1. if the graph holds it and it is fresh, return it;
//   2. else ask the live sources that answer that kind of question, in order;
//   3. keep what came back as content, with its source (understanding it into structure, down to
//      the seed, is the next step: phase 4);
//   4. save it with provenance; return it.
// During Suppose, Know answers from the graph and the cache only: nothing leaves the machine.

import { createHash } from "node:crypto";
import { type Call, type Expr, c, isCall, positional, role, s } from "../expr.js";
import type { Store } from "../store.js";
import { type Found, type SearchResult, page, webSearch, wikidata, wikipedia, wikipediaTopic, wiktionary } from "./sources.js";

export interface Knowledge {
  block: string;
  title: string;
  url: string;
  source: string;
}

/** How long an answer stays fresh, in days (a fact on a source, here its starting value). */
const FRESH_DAYS = 30;

export class Know {
  constructor(
    readonly store: Store,
    readonly now: () => Date,
  ) {}

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
      if (at?.kind === "string" && (this.now().getTime() - Date.parse(at.value)) / 86400000 > FRESH_DAYS) continue;
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
    const from: Expr = c(f.source, s(f.url));
    const block = this.store.addBlock(f.text, "text/plain", from);
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
    if (have) return have;
    const tries: (() => Promise<Found | undefined>)[] =
      about === "thing" && topic
        ? [() => wikipediaTopic(topic), () => wikipedia(question), () => wikidata(topic), () => this.webFound(question)]
        : [() => wikipedia(question), ...(topic ? [() => wikipediaTopic(topic)] : []), () => this.webFound(question)];
    for (const t of tries) {
      const found = await t();
      if (found) return this.keep("answer", question, found);
    }
    return undefined;
  }

  /** What a word means, from a dictionary. */
  async define(word: string): Promise<Knowledge | undefined> {
    const have = this.cached("define", word);
    if (have) return have;
    const found = await wiktionary(word);
    return found ? this.keep("define", word, found) : undefined;
  }

  /** A page by its URL. */
  async page(url: string): Promise<Knowledge | undefined> {
    const have = this.cached("page", url);
    if (have) return have;
    const found = await page(url);
    return found ? this.keep("page", url, found) : undefined;
  }

  /** A web search: its results, kept as one block. */
  async search(query: string): Promise<{ results: SearchResult[]; knowledge?: Knowledge }> {
    const results = await webSearch(query);
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
