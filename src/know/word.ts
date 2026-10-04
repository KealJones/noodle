// One word, learned when a prompt needs it (tasks/handoff.md, "learn the missing pieces at prompt
// time"): what a dictionary says of a word nobody imported, kept as facts on the word's concept
// with its source, so the next prompt that uses it hears it without asking again. A word looked
// up and not found is remembered too, so it is not asked for again.
//
// Nothing here fetches: Know does (src/runtime/know/know.ts); this turns what it brought back into
// facts, the same way the bulk importers do for whole dictionaries.

import { type Expr, c, s } from "../runtime/expr.js";
import type { Store } from "../runtime/store.js";
import { categoriesFor } from "./wordnet.js";
import { feature } from "./wiktionary.js";
import { Names } from "./names.js";

/** A dictionary's entry for one word: each part of speech with its forms and senses. */
export interface WordEntry {
  word: string;
  /** Where it came from, for its source (a page or a per-word file). */
  url: string;
  parts: { pos: string; glosses: string[]; forms: { form: string; tags: string[] }[] }[];
}

/**
 * The seed's concept for a dictionary's part of speech: found by its name as a word ("noun",
 * "proper noun"), the way the seed's PartOfSpeech concepts are named; the dictionary's own short
 * codes ("adj") are its abbreviations of those names.
 */
function partOfSpeech(store: Store, pos: string): string | undefined {
  const name = ({ adj: "adjective", adv: "adverb", name: "proper noun" } as Record<string, string>)[pos] ?? pos;
  return store.lookup(name.toLowerCase()).find((h) => h.concept.startsWith("PartOfSpeech"))?.concept;
}

/** Keeps one word's entry in the store, from the dictionary; returns how many facts it added. */
export function learnWord(store: Store, entry: WordEntry, from: Expr = c("Wiktionary", s(entry.url))): number {
  const names = new Names(store);
  const word = names.word(entry.word);
  let n = 0;
  const fact = (subject: string, claim: Expr) => {
    store.addFact(subject, claim, from);
    n++;
  };
  fact(word, c("Lemma", s(entry.word)));
  const seen = new Set<string>();
  entry.parts.forEach((p, i) => {
    const pos = partOfSpeech(store, p.pos);
    if (!pos) return;
    if (!seen.has(pos)) {
      seen.add(pos);
      fact(word, c("PartOfSpeech", c(pos)));
      for (const cat of categoriesFor(store, pos)) fact(word, cat);
    }
    for (const f of p.forms) {
      const feat = feature(f.tags);
      if (feat && f.form && f.form !== entry.word && !f.form.includes(" ")) fact(word, c("Form", s(f.form), c(feat)));
    }
    // Each sense the dictionary gives, its gloss kept as content on the sense (understood later,
    // as definitions are: src/know/definitions.ts).
    p.glosses.slice(0, 3).forEach((g, j) => {
      const sense = `${word}#${pos.replace(/^PartOfSpeech/, "")}${i}_${j}`;
      const block = store.addBlock(g, "text/plain", from);
      fact(sense, c("SenseOf", c(word)));
      fact(sense, c("PartOfSpeech", c(pos)));
      fact(sense, c("Said", c("Block", s(block.id))));
      fact(word, c("Sense", c(sense)));
    });
  });
  return n;
}

/** Remembers that a word was looked up and no dictionary had it. */
export function learnNoWord(store: Store, word: string, from: Expr): void {
  store.addFact("Lexicon", c("NotFound", s(word.toLowerCase())), from);
}

/** Whether a word was looked up before and not found. */
export function knownMissing(store: Store, word: string): boolean {
  return store.facts("Lexicon", "NotFound").some((f) => {
    const a = (f.claim as { args: { value: Expr }[] }).args[0]?.value;
    return a?.kind === "string" && a.value === word.toLowerCase();
  });
}
