// Before the chart (runtime.md section 3): set aside what is not language, cut the text into
// tokens, give each token its candidates, and propose segment boundaries. Everything here is
// character mechanics or a lookup; which tokens are words, marks, boundaries or tone is facts in the
// store, never lists in code.

import type { Expr } from "./expr.js";
import { c, isCall, positional } from "./expr.js";
import { matchShape } from "./shape.js";
import type { Store } from "./store.js";

export interface Token {
  text: string;
  /** Character offsets in the text the turn heard (after setting aside). */
  start: number;
  end: number;
  /** Leading spaces of the line, on a line's first token (runtime.md section 3.2). */
  indent?: number;
}

export type CandidateSource = "Exact" | "SpellDistance" | "Stretched" | "InPlay" | "Shape" | "Unknown" | "SetAside";

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
        else if (JOINER.test(text[end]) && end + 1 < text.length && WORD.test(text[end + 1])) end += 2;
        else break;
      }
    } else {
      const m = marks.find((l) => text.startsWith(l, i) && !/^\s*$/u.test(l));
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

export interface Hearing {
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
    const exact = store.lookup(tok.text);
    for (const h of exact) add({ start: i, end: i + 1, concept: h.concept, features: h.features, source: "Exact", distance: 0 });
    const word = /^[\p{L}][\p{L}'’]*$/u.test(tok.text) ? tok.text.toLowerCase() : undefined;
    if (word) {
      for (const sq of squeezes(word))
        for (const h of store.lookup(sq)) add({ start: i, end: i + 1, concept: h.concept, features: h.features, source: "Stretched", distance: 0 });
      if (word.length >= 3 && !exact.length) {
        const max = word.length <= 4 ? 1 : 2;
        for (const l of lemmaList) {
          if (!/^[\p{L}]/u.test(l) || l.includes(" ")) continue;
          const d = editDistance(word, l, max);
          if (d > 0 && d <= max) for (const h of store.lookup(l)) add({ start: i, end: i + 1, concept: h.concept, features: h.features, source: "SpellDistance", distance: d });
        }
      }
    }
    for (const name of surroundings.names) {
      const d = editDistance(tok.text.toLowerCase(), name.toLowerCase(), 2);
      if (d <= 2 && d <= Math.floor(name.length / 4)) add({ start: i, end: i + 1, literal: str(name), features: [], source: "InPlay", distance: d, kind: "Name" });
    }
  });

  // Multi-word lemmas ("go ahead", "never mind") enter as spans.
  for (const l of lemmaList) {
    if (!l.includes(" ")) continue;
    const parts = l.split(/\s+/).filter(Boolean);
    for (let i = 0; i + parts.length <= tokens.length; i++)
      if (parts.every((p, k) => tokens[i + k].text.toLowerCase() === p))
        for (const h of store.lookup(l)) add({ start: i, end: i + parts.length, concept: h.concept, features: h.features, source: "Exact", distance: 0 });
  }

  // Shapes propose kinds for spans that end on a token boundary.
  const shapes = store.factsWithHead("HasShape").filter((f) => store.facts(f.subject, "SetsAside").length === 0);
  const ends = new Map(tokens.map((t, i) => [t.end, i]));
  tokens.forEach((tok, i) => {
    for (const f of shapes) {
      const len = matchShape(positional(f.claim as never)[0] as Expr, text, tok.start);
      const j = ends.get(tok.start + len);
      if (len && j !== undefined)
        add({ start: i, end: j + 1, literal: str(text.slice(tok.start, tok.start + len)), features: [], source: "Shape", distance: 0, kind: f.subject });
    }
  });

  // A token with no candidate can only be skipped or taken as a literal (runtime.md 3.3).
  tokens.forEach((tok, i) => {
    if (!candidates[i].some((x) => x.end === i + 1)) add({ start: i, end: i + 1, literal: str(tok.text), features: [], source: "Unknown", distance: 0 });
  });
  return { tokens, candidates, aside };
}

const str = (value: string): Expr => ({ kind: "string", value, pos: { line: 0, column: 0 } });

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
