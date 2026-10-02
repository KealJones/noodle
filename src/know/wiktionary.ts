// Import word forms and pronunciations from Wiktionary (the Kaikki extract, JSON lines) into an
// N-Con pack (design sections 5 and 22). A word is its forms: an inflected form keeps its
// grammatical feature ("pushed" is push in the past), and a pronunciation is a fact on the word.
// Only words the store already has are imported (the extract has millions of entries), so the pack
// fills in what WordNet left out (regular inflections, sound) rather than adding new words.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { type Expr, c, s } from "../runtime/expr.js";
import type { Store } from "../runtime/store.js";
import { format } from "../ncon/index.js";
import { Names } from "./names.js";

/** Wiktionary's inflection tags to the form features the seed's lexical rules know. */
function feature(tags: string[]): string | undefined {
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
