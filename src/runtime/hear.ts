// Before the chart (runtime.md section 3): set aside what is not language, cut the text into
// tokens, give each token its candidates, and propose segment boundaries. Everything here is
// character mechanics or a lookup; which tokens are words, marks, boundaries or tone is facts in the
// store, never lists in code.

import type { Expr } from "./expr.js";
import { c, isCall, positional } from "./expr.js";
import { matchShape, matchShapeValue } from "./shape.js";
import type { Store } from "./store.js";

export interface Token {
  text: string;
  /** Character offsets in the text the turn heard (after setting aside). */
  start: number;
  end: number;
  /** Leading spaces of the line, on a line's first token (runtime.md section 3.2). */
  indent?: number;
}

export type CandidateSource = "Exact" | "CaseMatch" | "Inflected" | "SpellDistance" | "Stretched" | "InPlay" | "Shape" | "Unknown" | "SetAside";

export interface Candidate {
  /** Token indices [start, end). */
  start: number;
  end: number;
  /** The concept the span may be, or a literal (an unknown word, a shape match, a set-aside block). */
  concept?: string;
  literal?: Expr;
  /** Form features of the form it was found by (Past, Plural...). */
  features: string[];
  source: CandidateSource;
  distance: number;
  /** For a shape: the kind it proposes. */
  kind?: string;
}

export interface SetAside {
  kind: string;
  text: string;
  start: number;
  end: number;
}

const WORD = /[\p{L}\p{N}]/u;
const JOINER = /['’._\-/@+]/u;
/** Between two digits only these join: "3.5", "2026-10-01". "2+2" and "12/4" are three tokens. */
const NUMBER_JOINER = /[.\-]/u;
const DIGIT = /\p{Nd}/u;
const TAB_WIDTH = 4;

/** Moves spans matched by shapes whose kind SetsAside() out of the text (runtime.md 3.1). */
export function setAside(store: Store, text: string): { text: string; aside: SetAside[] } {
  const shapes = store
    .factsWithHead("HasShape")
    .filter((f) => store.facts(f.subject, "SetsAside").length > 0)
    .map((f) => ({ kind: f.subject, shape: positional(f.claim as never)[0] as Expr }));
  if (!shapes.length) return { text, aside: [] };
  const aside: SetAside[] = [];
  let out = "";
  for (let i = 0; i < text.length; ) {
    let best: { kind: string; len: number } | undefined;
    for (const sh of shapes) {
      const len = matchShape(sh.shape, text, i);
      if (len && (!best || len > best.len)) best = { kind: sh.kind, len };
    }
    if (best) {
      // The span keeps one placeholder character so the chart still sees something there.
      aside.push({ kind: best.kind, text: text.slice(i, i + best.len), start: out.length, end: out.length + 1 });
      out += "\u0000";
      i += best.len;
    } else out += text[i++];
  }
  return { text: out, aside };
}

/** Lemmas that start with a mark (not a letter or digit), longest first, for the tokenizer. */
function markLemmas(store: Store): string[] {
  const out: string[] = [];
  for (const t of store.lemmaTexts()) if (t && !WORD.test(t[0])) out.push(t);
  return out.sort((a, b) => b.length - a.length);
}

export function tokenize(store: Store, text: string): Token[] {
  const marks = markLemmas(store);
  const tokens: Token[] = [];
  let lineStart = true;
  let indent = 0;
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
      const len = ch === "\r" ? 2 : 1;
      tokens.push({ text: "\n", start: i, end: i + len });
      i += len;
      lineStart = true;
      indent = 0;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (lineStart) indent += ch === "\t" ? TAB_WIDTH : 1;
      i++;
      continue;
    }
    if (/\s/u.test(ch)) {
      i++;
      continue;
    }
    let end = i;
    if (ch === "\u0000") end = i + 1;
    else if (WORD.test(ch)) {
      end = i + 1;
      while (end < text.length) {
        if (WORD.test(text[end])) end++;
        else if (JOINER.test(text[end]) && end + 1 < text.length && WORD.test(text[end + 1]) && (NUMBER_JOINER.test(text[end]) || !DIGIT.test(text[end - 1]) || !DIGIT.test(text[end + 1]))) end += 2;
        else break;
      }
    } else {
      // A mark written with a space in it ("- ", "- [ ]") is a line's mark: it starts a line or it
      // is not that mark ("7 - 3" is a minus, not a bullet).
      const m = marks.find((l) => text.startsWith(l, i) && !/^\s*$/u.test(l) && (lineStart || !/\s/u.test(l)));
      end = i + (m ? m.length : 1);
    }
    const tok: Token = { text: text.slice(i, end), start: i, end };
    if (lineStart) tok.indent = indent;
    tokens.push(tok);
    lineStart = false;
    i = end;
  }
  return tokens;
}

/** Damerau-Levenshtein distance (optimal string alignment), stopping early past max. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) d.push([i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let x = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) x = Math.min(x, d[i - 2][j - 2] + 1);
      d[i][j] = x;
      rowMin = Math.min(rowMin, x);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** Every run of 3 or more of one letter squeezed to one and to two, all combinations up to 8. */
export function squeezes(word: string): string[] {
  const runs = [...word.matchAll(/(\p{L})\1{2,}/gu)];
  if (!runs.length) return [];
  let outs = [""];
  let at = 0;
  for (const r of runs) {
    const pre = word.slice(at, r.index);
    const ch = r[1];
    outs = outs.flatMap((o) => [o + pre + ch, o + pre + ch + ch]).slice(0, 8);
    at = (r.index ?? 0) + r[0].length;
  }
  return outs.map((o) => o + word.slice(at));
}

/** The bases a word may be, by the Suffix facts on form features (seed/lexical-rules.ncon). */
export function inflections(store: Store, word: string): { base: string; feature: string }[] {
  const out: { base: string; feature: string }[] = [];
  for (const f of store.factsWithHead("Suffix")) {
    const claim = f.claim as never as { args: { name?: string; value: Expr }[] };
    const suffix = claim.args.find((a) => a.name === undefined)?.value;
    if (suffix?.kind !== "string" || !word.endsWith(suffix.value) || word.length - suffix.value.length < 2) continue;
    let base = word.slice(0, -suffix.value.length);
    const restore = claim.args.find((a) => a.name === "restore")?.value;
    const undouble = claim.args.find((a) => a.name === "undouble")?.value;
    if (restore?.kind === "string") base += restore.value;
    if (undouble?.kind === "boolean" && undouble.value) {
      if (base.length < 3 || base[base.length - 1] !== base[base.length - 2]) continue;
      base = base.slice(0, -1);
    }
    out.push({ base, feature: f.subject });
  }
  return out;
}

export interface Hearing {
  /** The text heard, after setting aside: what the tokens' offsets are into. */
  text: string;
  tokens: Token[];
  candidates: Candidate[][];
  aside: SetAside[];
}

/** Names Focus put in the candidate set (runtime.md 11b): files, branches, things in play. */
export interface Surroundings {
  names: string[];
}

export function hear(store: Store, raw: string, surroundings: Surroundings = { names: [] }): Hearing {
  const { text, aside } = setAside(store, raw);
  const tokens = tokenize(store, text);
  const candidates: Candidate[][] = tokens.map(() => []);
  const add = (cand: Candidate) => candidates[cand.start].push(cand);
  const lemmaList = [...store.lemmaTexts()];

  let asideIndex = 0;
  tokens.forEach((tok, i) => {
    if (tok.text === "\u0000") {
      const a = aside[asideIndex++];
      add({ start: i, end: i + 1, literal: c("Block", { kind: "string", value: a.text, pos: { line: 0, column: 0 } }), features: [], source: "SetAside", distance: 0, kind: a.kind });
      return;
    }
    // A lemma written with capitals ("WHO", "Ada") is that name: a token in another case reaches it
    // only as a correction a step away, so "who" is the word, not the organization.
    const exact = store.lookup(tok.text).filter((h) => h.text === h.text.toLowerCase() || h.text === tok.text || h.text.toLowerCase() !== tok.text.toLowerCase());
    const recased = store.lookup(tok.text).filter((h) => !exact.includes(h));
    for (const h of exact) add({ start: i, end: i + 1, concept: h.concept, features: h.features, source: "Exact", distance: 0 });
    for (const h of recased) add({ start: i, end: i + 1, concept: h.concept, features: h.features, source: "CaseMatch", distance: 1 });
    const word = /^[\p{L}][\p{L}'’]*$/u.test(tok.text) ? tok.text.toLowerCase() : undefined;
    if (word) {
      for (const sq of squeezes(word))
        for (const h of store.lookup(sq)) add({ start: i, end: i + 1, concept: h.concept, features: h.features, source: "Stretched", distance: 0 });
      // A regular form: a lemma plus a suffix from the seed's inflection facts. Morphology, not a
      // spelling correction, so it competes even with an exact word ("prs" the word, "pr" plural).
      for (const inf of inflections(store, word))
          for (const h of store.lookup(inf.base))
            if (!h.features.length) add({ start: i, end: i + 1, concept: h.concept, features: [inf.feature], source: "Inflected", distance: 0 });
      if (word.length >= 3 && !exact.length && !candidates[i].some((x) => x.source === "Inflected")) {
        const max = word.length <= 4 ? 1 : 2;
        for (const l of lemmaList) {
          if (!/^[\p{L}]/u.test(l) || l.includes(" ")) continue;
          const d = editDistance(word, l, max);
          if (d > 0 && d <= max) for (const h of store.lookup(l)) add({ start: i, end: i + 1, concept: h.concept, features: h.features, source: "SpellDistance", distance: d });
        }
      }
    }
    // Names in the surroundings: an exact name (case aside) is the candidate; only with none are
    // names a small spelling distance away proposed, as for words.
    // A name is also matched by its stem, before its last dot ("readme" for README.md).
    const stem = (name: string) => (name.lastIndexOf(".") > 0 ? name.slice(0, name.lastIndexOf(".")) : name);
    const near = surroundings.names
      .map((name) => ({ name, d: Math.min(editDistance(tok.text.toLowerCase(), name.toLowerCase(), 2), editDistance(tok.text.toLowerCase(), stem(name).toLowerCase(), 2)) }))
      .filter(({ name, d }) => d <= 2 && d <= Math.floor(name.length / 4));
    const same = near.filter((x) => x.d === 0);
    for (const { name, d } of same.length ? same : near) add({ start: i, end: i + 1, literal: str(name), features: [], source: "InPlay", distance: d, kind: "Name" });
  });

  // Multi-word lemmas ("go ahead", "never mind") enter as spans.
  for (const l of lemmaList) {
    if (!l.includes(" ")) continue;
    const parts = l.split(/\s+/).filter(Boolean);
    for (let i = 0; i + parts.length <= tokens.length; i++)
      if (parts.every((p, k) => tokens[i + k].text.toLowerCase() === p))
        for (const h of store.lookup(l)) add({ start: i, end: i + parts.length, concept: h.concept, features: h.features, source: "Exact", distance: 0 });
  }

  // A concept said as words in order (`Words(Give(), Up())`: an idiom, a phrasal verb) enters as
  // a span where each token is heard as its part. A part given in a form (`Bean(Plural())`) is
  // heard only in that form; any other part in any form ("gave up"), and the span has the form
  // features those parts were heard with (Past). Spelling corrections are not parts.
  const byFirst = wordSequences(store);
  for (let i = 0; i < tokens.length; i++)
    for (const first of new Set(candidates[i].filter((x) => x.concept && x.end === i + 1).map((x) => x.concept!)))
      for (const seq of byFirst.get(first) ?? []) {
        if (i + seq.parts.length > tokens.length) continue;
        const feats: string[] = [];
        let exact = true;
        const heard = seq.parts.every((p, k) => {
          const own = candidates[i + k].filter((x) => x.concept === p.concept && x.end === i + k + 1 && x.source !== "SpellDistance" && p.features.every((f) => x.features.includes(f)));
          const hit = own.find((x) => x.source === "Exact") ?? own[0];
          if (hit && !p.features.length) feats.push(...hit.features);
          if (hit && hit.source !== "Exact") exact = false;
          return !!hit;
        });
        const end = i + seq.parts.length;
        if (!heard || candidates[i].some((x) => x.concept === seq.concept && x.end === end && x.features.join() === feats.join())) continue;
        add({ start: i, end, concept: seq.concept, features: [...new Set(feats)], source: exact ? "Exact" : "Inflected", distance: 0 });
      }

  // Shapes propose kinds for spans that end on a token boundary.
  const shapes = store.factsWithHead("HasShape").filter((f) => store.facts(f.subject, "SetsAside").length === 0);
  const ends = new Map(tokens.map((t, i) => [t.end, i]));
  tokens.forEach((tok, i) => {
    for (const f of shapes) {
      const { len, value } = matchShapeValue(positional(f.claim as never)[0] as Expr, text, tok.start);
      const j = ends.get(tok.start + len);
      if (len && j !== undefined) {
        add({ start: i, end: j + 1, literal: literal(value ?? text.slice(tok.start, tok.start + len)), features: [], source: "Shape", distance: 0, kind: f.subject });
        // A captured name is exact: the tokens inside it are not also words to correct.
        if (value !== undefined) for (let k = i + 1; k < j; k++) candidates[k] = candidates[k].filter((x) => x.source === "Exact" || x.source === "Shape");
      }
    }
  });

  // A token with no candidate can only be skipped or taken as a literal (runtime.md 3.3). One whose
  // only candidates are spelling corrections keeps itself as a literal too: "yeet" may be a new
  // word, not "yet" misspelt, and the chart and score decide. So does one found only in another
  // case: "sam" may be a name, not the acronym SAM.
  tokens.forEach((tok, i) => {
    const own = candidates[i].filter((x) => x.end === i + 1);
    if (!own.length || own.every((x) => x.source === "SpellDistance" || x.source === "CaseMatch")) add({ start: i, end: i + 1, literal: str(tok.text), features: [], source: "Unknown", distance: 0 });
  });
  return { text, tokens, candidates, aside };
}

/**
 * The words of a hearing nothing in the store hears: a token of letters heard only as itself (an
 * Unknown candidate, which it gets when it has no candidate, or only spelling corrections or
 * another case), and not inside a span a shape, a set-aside block or a name in play covers.
 */
export function unheard(h: Hearing): string[] {
  const covered = new Set<number>();
  for (const cs of h.candidates)
    for (const x of cs) if (x.source === "Shape" || x.source === "SetAside" || x.source === "InPlay") for (let k = x.start; k < x.end; k++) covered.add(k);
  return h.tokens.flatMap((tok, i) =>
    !covered.has(i) && /^[\p{L}][\p{L}'-]*$/u.test(tok.text) && h.candidates[i].some((x) => x.source === "Unknown") ? [tok.text] : [],
  );
}

/** The concepts said as words in order, by their first word (read once per store, then kept). */
type Part = { concept: string; features: string[] };
const sequences = new WeakMap<object, Map<string, { concept: string; parts: Part[] }[]>>();
function wordSequences(store: Store): Map<string, { concept: string; parts: Part[] }[]> {
  const facts = store.factsWithHead("Words");
  let m = sequences.get(facts);
  if (m) return m;
  m = new Map();
  for (const f of facts) {
    const parts = positional(f.claim as never).map((x: Expr): Part | undefined =>
      isCall(x) ? { concept: x.head, features: positional(x).flatMap((y) => (isCall(y) ? [y.head] : [])) } : undefined,
    );
    if (parts.length < 2 || parts.some((x) => !x)) continue;
    const list = m.get(parts[0]!.concept) ?? [];
    list.push({ concept: f.subject, parts: parts as Part[] });
    m.set(parts[0]!.concept, list);
  }
  sequences.set(facts, m);
  return m;
}

const str = (value: string): Expr => ({ kind: "string", value, pos: { line: 0, column: 0 } });

/** N-Con's own number syntax (ncon.md section 1): a span written as one is that number. */
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/**
 * What a shape's span is: a number when it is written as one (the data model has numbers, as it
 * has strings), else the text. Which spans are numerals is the shapes' business, in the seed.
 */
const literal = (value: string): Expr => (NUMBER.test(value) ? { kind: "number", value: Number(value), pos: { line: 0, column: 0 } } : str(value));

/** Token indices where a segment may end: after a token whose candidates include an EndsClause word. */
export function boundaries(store: Store, h: Hearing): { ends: number[]; opens: number[] } {
  const ends: number[] = [];
  const opens: number[] = [];
  h.tokens.forEach((_, i) => {
    const cs = h.candidates[i].filter((x) => x.end === i + 1 && x.concept && x.source === "Exact");
    if (cs.some((x) => store.facts(x.concept!, "EndsClause").length)) ends.push(i + 1);
    if (i > 0 && cs.some((x) => store.facts(x.concept!, "OpensClause").length)) opens.push(i);
  });
  return { ends, opens };
}

/** At most two segmentations (runtime.md 3.2): at clause ends, and also before clause openers. */
export function segmentations(store: Store, h: Hearing): [number, number][][] {
  const { ends, opens } = boundaries(store, h);
  const cut = (points: number[]) => {
    const ps = [...new Set([0, ...points, h.tokens.length])].sort((a, b) => a - b);
    const segs: [number, number][] = [];
    for (let k = 0; k + 1 < ps.length; k++) if (ps[k] < ps[k + 1]) segs.push([ps[k], ps[k + 1]]);
    return segs;
  };
  const a = cut(ends);
  const b2 = cut([...ends, ...opens]);
  return JSON.stringify(a) === JSON.stringify(b2) ? [a] : [a, b2];
}

export { isCall };
