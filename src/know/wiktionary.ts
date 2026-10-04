// Import word forms and pronunciations from Wiktionary (the Kaikki extract, JSON lines) into an
// N-Con pack (design sections 5 and 22). A word is its forms: an inflected form keeps its
// grammatical feature ("pushed" is push in the past), and a pronunciation is a fact on the word.
// Only words the store already has are imported (the extract has millions of entries), so the pack
// fills in what WordNet left out (regular inflections, sound) rather than adding new words.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { type Expr, c, s } from "../runtime/expr.js";
import type { Store } from "../runtime/store.js";
import { format } from "../ncon/index.js";
import { Names } from "./names.js";
import { categoriesFor } from "./wordnet.js";

/** Wiktionary's inflection tags to the form features the seed's lexical rules know. */
export function feature(tags: string[]): string | undefined {
  const has = (t: string) => tags.includes(t);
  if (has("obsolete") || has("archaic") || has("misspelling") || has("nonstandard") || has("dialectal")) return undefined;
  if (has("participle") && has("past")) return "PastParticiple";
  if (has("participle") && has("present")) return "Gerund";
  if (has("past")) return "Past";
  if (has("third-person") && has("singular") && has("present")) return "ThirdSingular";
  if (has("plural") && !has("singular")) return "Plural";
  return undefined;
}

export async function importWiktionary(path: string, store: Store, opts: { version: string }): Promise<{ text: string; words: number; forms: number }> {
  const names = new Names(store);
  const forms = new Map<string, { lemma: string; forms: Map<string, Set<string>>; sound?: string }>();
  const rl = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"lang": "English"') && !line.includes('"lang":"English"')) continue;
    let e: { word?: string; lang?: string; forms?: { form: string; tags?: string[] }[]; sounds?: { ipa?: string }[] };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const word = e.word;
    if (!word || e.lang !== "English") continue;
    // Only a word the store has a concept for, by its exact lemma.
    if (!store.lookup(word).some((h) => h.text === word && !h.features.length)) continue;
    const name = names.word(word);
    let entry = forms.get(name);
    if (!entry) forms.set(name, (entry = { lemma: word, forms: new Map() }));
    for (const f of e.forms ?? []) {
      const feat = feature(f.tags ?? []);
      if (!feat || !f.form || f.form === word || f.form.includes(" ")) continue;
      if (!entry.forms.has(f.form)) entry.forms.set(f.form, new Set());
      entry.forms.get(f.form)!.add(feat);
    }
    const ipa = e.sounds?.find((x) => x.ipa)?.ipa;
    if (ipa && !entry.sound) entry.sound = ipa;
  }
  const out: Expr[] = [c("Pack", ["name", s("wiktionary-forms")], ["version", s(opts.version)], ["from", c("Wiktionary", s(`kaikki-${opts.version}`))], ["license", s("CC BY-SA 4.0")])];
  let count = 0;
  for (const [name, e] of forms) {
    const claims: Expr[] = [];
    for (const [form, feats] of e.forms) {
      // A form the store already has with that feature is not said twice.
      for (const f of feats) {
        if (store.lookup(form).some((h) => h.concept === name && h.features.includes(f))) continue;
        claims.push(c("Form", s(form), c(f)));
        count++;
      }
    }
    if (e.sound) claims.push(c("Sounds", s(e.sound)));
    if (claims.length) out.push(c("Concept", c(name), ...claims));
  }
  return { text: format({ forms: out as never }), words: out.length - 1, forms: count };
}

// -----------------------------------------------------------------------------------------------
// Beyond forms (PLAN.md phase 3.2): alternative forms, idioms and phrasal verbs.
//
// An alternative form ("colour" of color, "pls" of please) is identity for understanding (design
// section 5): a Form of the word it is a form of, where no word in the store has that form yet.
// Misspellings, and forms Wiktionary marks obsolete, archaic, nonstandard, dialectal, rare or
// dated, are not kept (tasks/lessons.md).
//
// An idiom or a phrasal verb ("spill the beans", "give up") is a concept whose words are its
// parts: `Words(Spill(), The(), Bean(Plural()))`, each part a word concept (an inflected part with
// its feature), never a string with spaces. Hearing proposes the span wherever its parts are
// heard in order, in any form ("spilled the beans" is the idiom in the past). A phrase already in
// the store (a WordNet lemma) gets its parts; a new one gets its part of speech and its senses,
// each with its definition as a content block (Said(Block)) for the definition understander.

const SKIP = ["misspelling", "obsolete", "archaic", "nonstandard", "dialectal", "rare", "dated", "pronunciation-spelling", "eye-dialect", "form-of", "uncommon"];
const KAIKKI_POS: Record<string, string> = { noun: "PartOfSpeechNoun", verb: "PartOfSpeechVerb", adj: "PartOfSpeechAdjective", adv: "PartOfSpeechAdverb" };

type KaikkiSense = { glosses?: string[]; tags?: string[]; alt_of?: { word: string }[]; links?: [string, string][]; categories?: (string | { name: string })[] };
type KaikkiEntry = { word?: string; lang?: string; pos?: string; forms?: { form: string; tags?: string[] }[]; senses?: KaikkiSense[] };

export interface PhrasesResult {
  alternatives: { text: string; forms: number; words: number };
  idioms: { text: string; phrases: number; known: number; senses: number; skipped: number };
}

export async function importWiktionaryPhrases(path: string, store: Store, opts: { version: string }): Promise<PhrasesResult> {
  const names = new Names(store);
  const from = c("Wiktionary", s(`kaikki-${opts.version}`));
  /** The word concept a lemma is, exactly (no inflection). */
  const lemmaOf = (w: string) => store.lookup(w).find((h) => h.text === w && !h.features.length)?.concept;
  /** A part of a phrase: its word concept, with the feature it is inflected by, if it is a form. */
  const part = (w: string): Expr | undefined => {
    const l = lemmaOf(w);
    if (l) return c(l);
    const f = store.lookup(w).find((h) => h.text === w && h.features.length === 1);
    return f ? c(f.concept, c(f.features[0])) : undefined;
  };
  const alt = new Map<string, Map<string, Set<string>>>(); // word concept -> form -> features
  const phrases = new Map<string, { lemma: string; parts: Expr[]; pos: Set<string>; senses: { gloss: string; pos?: string; kind?: string }[] }>();
  let skipped = 0;
  const addAlt = (target: string, form: string, feat?: string) => {
    if (!/^[a-z]+$/.test(form)) return;
    // Only a form no word in the store has: an alternative form fills a gap, and never makes a word
    // the store knows ("me", "the", "git", "u") ambiguous with another ("my", "they", "get", "you").
    if (store.lookup(form).length) return;
    if (!alt.has(target)) alt.set(target, new Map());
    const m = alt.get(target)!;
    if (!m.has(form)) m.set(form, new Set());
    if (feat) m.get(form)!.add(feat);
  };
  const rl = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    let e: KaikkiEntry;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const word = e.word;
    if (!word || e.lang !== "English" || e.pos === "name") continue;
    const senses = (e.senses ?? []).filter((x) => !(x.tags ?? []).some((t) => SKIP.includes(t)));
    if (!word.includes(" ")) {
      // Alternative forms: this word is a form of another ("pls" of please), by a sense that says
      // so with its tags. (An entry's own list of alternative forms carries no such tags, and
      // lists misspellings beside spellings: "teh" for "the".)
      if (!/^[a-z]+$/.test(word)) continue;
      for (const sn of senses) {
        const of = sn.alt_of?.length === 1 ? sn.alt_of[0].word : undefined;
        const target = of && /^[a-z]+$/.test(of) ? lemmaOf(of) : undefined;
        if (!target) continue;
        addAlt(target, word);
        for (const f of e.forms ?? []) {
          const feat = feature(f.tags ?? []);
          if (feat && f.form !== word) addAlt(target, f.form, feat);
        }
      }
      continue;
    }
    // Idioms and phrasal verbs: a sense Wiktionary marks idiomatic, an entry in its phrasal verbs
    // category, or a phrase.
    const cats = (e.senses ?? []).flatMap((x) => (x.categories ?? []).map((k) => (typeof k === "string" ? k : k.name)));
    const idiom = senses.some((x) => x.tags?.includes("idiomatic")) || cats.some((k) => k.startsWith("English phrasal verbs")) || e.pos === "phrase" || e.pos === "prep_phrase" || e.pos === "proverb";
    if (!idiom || !senses.length) continue;
    const words = word.split(" ");
    const parts = words.map(part);
    if (words.some((w) => !/^[a-z]+$/.test(w)) || parts.some((p) => !p)) {
      skipped++;
      continue;
    }
    const name = names.word(word);
    let ph = phrases.get(name);
    if (!ph) phrases.set(name, (ph = { lemma: word, parts: parts as Expr[], pos: new Set(), senses: [] }));
    const pos = e.pos ? KAIKKI_POS[e.pos] : undefined;
    if (pos) ph.pos.add(pos);
    for (const sn of senses) {
      const gloss = sn.glosses?.[sn.glosses.length - 1];
      if (!gloss) continue;
      // The sense is named by the first word its definition links to that the store has.
      const kind = sn.links?.map((l) => l[0]).find((l) => /^[a-z]+$/.test(l) && lemmaOf(l));
      ph.senses.push({ gloss, pos, kind });
    }
  }

  // Alternative forms.
  const altOut: Expr[] = [c("Pack", ["name", s("wiktionary-alternatives")], ["version", s(opts.version)], ["from", from], ["license", s("CC BY-SA 4.0")])];
  let altForms = 0;
  for (const [target, m] of alt) {
    const claims: Expr[] = [];
    for (const [form, feats] of m) {
      if (!feats.size) claims.push(c("Form", s(form)));
      for (const f of feats) claims.push(c("Form", s(form), c(f)));
      altForms += Math.max(1, feats.size);
    }
    altOut.push(c("Concept", c(target), ...claims));
  }

  // Idioms and phrasal verbs.
  const idOut: Expr[] = [c("Pack", ["name", s("wiktionary-idioms")], ["version", s(opts.version)], ["from", from], ["license", s("CC BY-SA 4.0")])];
  let known = 0;
  let senseCount = 0;
  for (const [name, ph] of phrases) {
    const words = c("Words", ...ph.parts);
    if (lemmaOf(ph.lemma) === name) {
      // A phrase the store already has (a WordNet lemma): only its parts are new.
      known++;
      idOut.push(c("Fact", c(name), words, ["from", from]));
      continue;
    }
    const claims: Expr[] = [words, ...[...ph.pos].map((p) => c("PartOfSpeech", c(p)))];
    const senseForms: Expr[] = [];
    ph.senses.forEach((sn, i) => {
      const sense = names.other(`${ph.lemma}#${i}`, `${name}#${sn.kind ? sn.kind[0].toUpperCase() + sn.kind.slice(1) : "Sense"}`);
      const id = "b_" + createHash("sha256").update(sn.gloss).digest("hex").slice(0, 16);
      senseForms.push(c("Block", ["id", s(id)], ["media", s("text/plain")], ["body", s(sn.gloss)]));
      const sc: Expr[] = [c("SenseOf", c(name))];
      if (sn.pos) sc.push(c("PartOfSpeech", c(sn.pos)));
      sc.push(c("Said", c("Block", s(id))));
      senseForms.push(c("Concept", c(sense), ...sc, ["from", c("Wiktionary", s(ph.lemma))]));
      claims.push(c("Sense", c(sense)));
      senseCount++;
    });
    idOut.push(c("Concept", c(name), ...claims, ["from", from]));
    for (const p of ph.pos) for (const cat of categoriesFor(store, p)) idOut.push(c("Fact", c(name), cat, ["from", c("Derived", from, c("Seed", s("lexical-rules")))]));
    idOut.push(...senseForms);
  }
  return {
    alternatives: { text: format({ forms: altOut as never }), forms: altForms, words: alt.size },
    idioms: { text: format({ forms: idOut as never }), phrases: phrases.size, known, senses: senseCount, skipped },
  };
}
