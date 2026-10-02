// wordfreq's word lists (docs/imports.md): a msgpack array whose first item is a header and whose
// i-th item after it is the list of words at -i centibels, so the words come most frequent first.
// Used to pick the most common words for measuring how much of the language bottoms out (design
// section 6: coverage of the most common lemmas). Only the parts of msgpack the lists use are read.

import { type Expr, c, s } from "../runtime/expr.js";
import type { Store } from "../runtime/store.js";
import { format } from "../ncon/index.js";

/** The buckets of a wordfreq cBpack list: the i-th holds the words at -i centibels. */
function buckets(buf: Uint8Array): string[][] {
  let i = 0;
  const text = new TextDecoder();
  const u = (n: number) => {
    let x = 0;
    for (let k = 0; k < n; k++) x = x * 256 + buf[i++];
    return x;
  };
  const str = (n: number) => {
    const s = text.decode(buf.subarray(i, i + n));
    i += n;
    return s;
  };
  const read = (): unknown => {
    const t = buf[i++];
    if (t <= 0x7f) return t;
    if (t >= 0x80 && t <= 0x8f) return map(t - 0x80);
    if (t >= 0x90 && t <= 0x9f) return arr(t - 0x90);
    if (t >= 0xa0 && t <= 0xbf) return str(t - 0xa0);
    switch (t) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xcc:
        return u(1);
      case 0xcd:
        return u(2);
      case 0xce:
        return u(4);
      case 0xd9:
        return str(u(1));
      case 0xda:
        return str(u(2));
      case 0xdb:
        return str(u(4));
      case 0xdc:
        return arr(u(2));
      case 0xdd:
        return arr(u(4));
      case 0xde:
        return map(u(2));
    }
    throw new Error(`wordfreq: msgpack type 0x${t.toString(16)} at ${i - 1} is not one the lists use`);
  };
  const arr = (n: number) => Array.from({ length: n }, read);
  const map = (n: number) => {
    const o: Record<string, unknown> = {};
    for (let k = 0; k < n; k++) o[String(read())] = read();
    return o;
  };
  const all = read() as unknown[];
  return all.slice(1).map((bucket) => (Array.isArray(bucket) ? (bucket as string[]) : []));
}

/** The words of a wordfreq cBpack list, most frequent first. */
export function wordfreqWords(buf: Uint8Array): string[] {
  return buckets(buf).flat();
}

/**
 * Each word with its Zipf frequency (log10 of its count per billion words: 9 minus its bucket's
 * centibels over 100), most frequent first.
 */
export function wordfreqZipf(buf: Uint8Array): [string, number][] {
  return buckets(buf).flatMap((ws, i) => ws.map((w): [string, number] => [w, Math.round((9 - i / 100) * 100) / 100]));
}

/**
 * The frequency pack: a Frequency fact on each word concept whose lemma the list has (design
 * section 9: how common a word is ranks the words a token may be a correction of). The list is by
 * written word, so a lemma gets its own written frequency, not its forms'.
 */
export function frequencyPack(buf: Uint8Array, store: Store, opts: { version: string }): { text: string; words: number } {
  const out: Expr[] = [c("Pack", ["name", s("wordfreq")], ["version", s(opts.version)], ["from", c("Wordfreq", s(`large_en-${opts.version}`))], ["license", s("CC BY-SA 4.0")])];
  const done = new Set<string>();
  for (const [w, z] of wordfreqZipf(buf)) {
    for (const h of store.lookup(w)) {
      if (h.text !== w || h.features.length || done.has(h.concept)) continue;
      done.add(h.concept);
      out.push(c("Fact", c(h.concept), c("Frequency", { kind: "number", value: z, pos: { line: 0, column: 0 } })));
    }
  }
  return { text: format({ forms: out as never }), words: done.size };
}
