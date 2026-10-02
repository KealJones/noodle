// Import Open English WordNet (WN-LMF XML) into an N-Con pack (design sections 5 and 22). A word
// is its forms and senses; each synset is one sense concept, named Word#WhatItIs from its first
// member and its nearest broader kind, shared by every member word, so different words for one
// meaning reach one concept. Definitions are kept as content blocks the sense refers to, never
// matched against. Categories come from parts of speech through the seed's own mapping (seed/
// lexical-rules.ncon), and never for a word the seed already gives entries to.

import { createHash } from "node:crypto";
import { type Expr, c, isCall, positional, s } from "../runtime/expr.js";
import { instantiate, match } from "../runtime/match.js";
import type { Store } from "../runtime/store.js";
import { format } from "../ncon/index.js";
import { Names, encodeLemma } from "./names.js";
import { type XmlElement, child, childrenNamed, elements, parseXml } from "./xml.js";

/** WN-LMF part-of-speech codes to the seed's part-of-speech concepts. */
const POS: Record<string, string> = { n: "PartOfSpeechNoun", v: "PartOfSpeechVerb", a: "PartOfSpeechAdjective", s: "PartOfSpeechAdjective", r: "PartOfSpeechAdverb" };

interface Synset {
  id: string;
  pos: string;
  members: string[];
  hypernyms: string[];
  definition?: string;
}

export interface ImportResult {
  text: string;
  words: number;
  senses: number;
}

export function importWordNet(xml: string, store: Store, opts: { version: string; limitLemmas?: ReadonlySet<string> }): ImportResult {
  const doc = parseXml(xml);
  const synsets = new Map<string, Synset>();
  for (const el of elements(doc, "Synset")) {
    const hypernyms = childrenNamed(el, "SynsetRelation")
      .filter((r) => r.attrs.relType === "hypernym" || r.attrs.relType === "instance_hypernym")
      .map((r) => r.attrs.target);
    synsets.set(el.attrs.id, { id: el.attrs.id, pos: el.attrs.partOfSpeech, members: [], hypernyms, definition: child(el, "Definition")?.text.trim() });
  }
  const entries: { lemma: string; pos: string; forms: string[]; senses: string[] }[] = [];
  for (const el of elements(doc, "LexicalEntry")) {
    const lemmaEl = child(el, "Lemma");
    if (!lemmaEl) continue;
    const lemma = lemmaEl.attrs.writtenForm;
    if (opts.limitLemmas && !opts.limitLemmas.has(lemma.toLowerCase())) continue;
    const senses = childrenNamed(el, "Sense").map((x) => x.attrs.synset);
    for (const id of senses) synsets.get(id)?.members.push(lemma);
    entries.push({ lemma, pos: lemmaEl.attrs.partOfSpeech, forms: childrenNamed(el, "Form").map((f) => f.attrs.writtenForm), senses });
  }

  const names = new Names(store);
  const firstLemma = (id: string) => synsets.get(id)?.members[0];
  // Name senses: Word#Kind, the next broader kind breaking a tie, then _2.
  const senseName = new Map<string, string>();
  const used = new Set<string>();
  for (const sy of synsets.values()) {
    if (!sy.members.length) continue;
    const word = names.word(sy.members[0]);
    const candidates: string[] = [];
    let frontier = sy.hypernyms;
    for (let d = 0; d < 6 && frontier.length; d++) {
      for (const h of frontier) {
        const k = firstLemma(h);
        const e = k && encodeLemma(k);
        if (e) candidates.push(e);
      }
      frontier = frontier.flatMap((h) => synsets.get(h)?.hypernyms ?? []);
    }
    for (const m of sy.members.slice(1)) {
      const e = encodeLemma(m);
      if (e) candidates.push(e);
    }
    let name = candidates.map((k) => `${word}#${k}`).find((n) => !used.has(n));
    if (!name) {
      const base = `${word}#${candidates[0] ?? "Sense"}`;
      name = base;
      for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
    }
    used.add(name);
    senseName.set(sy.id, name);
  }

  const from = c("WordNet", s(`oewn-${opts.version}`));
  const forms: Expr[] = [c("Pack", ["name", s("oewn")], ["version", s(opts.version)], ["from", from], ["license", s("CC BY 4.0")])];
  // One concept per word: its lemma, part of speech, forms and senses.
  const byWord = new Map<string, { lemma: string; pos: Set<string>; forms: Set<string>; senses: Set<string> }>();
  for (const e of entries) {
    const w = names.word(e.lemma);
    const x = byWord.get(w) ?? { lemma: e.lemma, pos: new Set(), forms: new Set(), senses: new Set() };
    if (POS[e.pos]) x.pos.add(POS[e.pos]);
    for (const f of e.forms) if (f !== e.lemma) x.forms.add(f);
    for (const id of e.senses) {
      const n = senseName.get(id);
      if (n) x.senses.add(n);
    }
    byWord.set(w, x);
  }
  for (const [w, x] of byWord) {
    const claims: Expr[] = [];
    if (!store.facts(w, "Lemma").some((f) => isCall(f.claim) && positional(f.claim)[0]?.kind === "string" && (positional(f.claim)[0] as { value: string }).value === x.lemma))
      claims.push(c("Lemma", s(x.lemma)));
    for (const p of x.pos) claims.push(c("PartOfSpeech", c(p)));
    for (const f of x.forms) claims.push(c("Form", s(f)));
    for (const n of x.senses) claims.push(c("Sense", c(n)));
    if (claims.length) forms.push(c("Concept", c(w), ...claims));
    // Entries from the part of speech, through the seed's mapping, unless the seed gives the word
    // its own (function words are the seed's; design section 6).
    if (!store.facts(w, "Category").length)
      for (const p of x.pos) for (const cat of categoriesFor(store, p)) forms.push(c("Fact", c(w), cat, ["from", c("Derived", from, c("Seed", s("lexical-rules")))]));
  }
  let senses = 0;
  for (const sy of synsets.values()) {
    const name = senseName.get(sy.id);
    if (!name) continue;
    senses++;
    const claims: Expr[] = sy.members.map((m) => c("SenseOf", c(names.word(m))));
    for (const h of sy.hypernyms) {
      const hn = senseName.get(h);
      if (hn) claims.push(c("IsA", c(hn)));
    }
    if (POS[sy.pos]) claims.push(c("PartOfSpeech", c(POS[sy.pos])));
    if (sy.definition) {
      const id = "b_" + createHash("sha256").update(sy.definition).digest("hex").slice(0, 16);
      forms.push(c("Block", ["id", s(id)], ["media", s("text/plain")], ["body", s(sy.definition)]));
      claims.push(c("Said", c("Block", s(id))));
    }
    forms.push(c("Concept", c(name), ...claims, ["from", c("WordNet", s(sy.id))]));
  }
  return { text: format({ forms: forms as never }), words: byWord.size, senses };
}

/** The Category facts the seed's part-of-speech readings give a part of speech. */
export function categoriesFor(store: Store, pos: string): Expr[] {
  const out: Expr[] = [];
  for (const r of store.readingsOn(pos)) {
    const m = r.becomes && match(r.pattern, c("PartOfSpeech", c(pos)), store);
    if (m && r.becomes) out.push(instantiate(r.becomes, m.bindings));
  }
  return out;
}

export type { XmlElement };
