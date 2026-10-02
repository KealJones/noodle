// The grammar of a manual page's usage lines (runtime.md section 9; design section 25: learning a
// tool is understanding its documentation). `git push [--all | --tags] [<repository> [<refspec>...]]`
// becomes structure: Usage, Optional, Choice, Flag, Option, Placeholder, Repeat, Literal, Group.
// A fragment this grammar cannot read stays Unparsed, as text, rather than being guessed at
// (AGENTS.md rule 10).

import { c, isHead, positional, s } from "../expr.js";
import type { Call, Expr } from "../expr.js";

/** Italic text in a SYNOPSIS marks a placeholder; the page reader brackets it with these. */
export const ITALIC_OPEN = "";
export const ITALIC_CLOSE = "";

class Fail extends Error {}

const SPACE = /\s/;
const DELIMS = "[]()|<>";
const ELLIPSIS = /^(\.\.\.|…)/;

const unparsed = (text: string): Expr => c("Unparsed", s(text));
const isFlag = (w: string) => w.startsWith("-");

class Parser {
  i = 0;
  constructor(private readonly t: string) {}

  private skip(): void {
    while (this.i < this.t.length && SPACE.test(this.t[this.i])) this.i++;
  }

  /** Alternatives up to the closing character (consumed by the caller), or to the end if none. */
  alts(close: string | null): Expr[][] {
    const out: Expr[][] = [[]];
    for (;;) {
      this.skip();
      const ch = this.t[this.i];
      if (ch === undefined) {
        if (close !== null) throw new Fail("unclosed");
        return out;
      }
      if (ch === close) return out;
      if (ch === "|") {
        this.i++;
        out.push([]);
        continue;
      }
      const last = out[out.length - 1];
      const at = this.i;
      try {
        if (ch === "]" || ch === ")") throw new Fail("stray closer");
        last.push(this.repeated(this.item()));
      } catch (e) {
        if (!(e instanceof Fail)) throw e;
        this.i = at;
        last.push(unparsed(this.chunk()));
      }
    }
  }

  /** Text up to the next space outside brackets: what a fragment we cannot read keeps. */
  private chunk(): string {
    const start = this.i;
    let depth = 0;
    let j = start;
    for (; j < this.t.length; j++) {
      const ch = this.t[j];
      if (ch === "[" || ch === "(" || ch === "<") depth++;
      else if (ch === "]" || ch === ")" || ch === ">") {
        // A closer that opens nothing here belongs to an enclosing group, not to this chunk.
        if (depth === 0) {
          if (j === start) j++;
          break;
        }
        depth--;
      } else if (SPACE.test(ch) && depth <= 0) break;
      else if (ch === "|" && depth <= 0 && j > start) break;
    }
    if (depth > 0) {
      j = start;
      while (j < this.t.length && !SPACE.test(this.t[j])) j++;
    }
    if (j === start) j = start + 1;
    this.i = j;
    return this.t.slice(start, j);
  }

  private repeated(e: Expr): Expr {
    const at = this.i;
    this.skip();
    const m = ELLIPSIS.exec(this.t.slice(this.i));
    if (!m) {
      this.i = at;
      return e;
    }
    this.i += m[0].length;
    return this.repeated(c("Repeat", e));
  }

  private item(): Expr {
    const ch = this.t[this.i];
    if (ch === "[") {
      this.i++;
      const a = this.alts("]");
      this.i++;
      return c("Optional", ...fold(a));
    }
    if (ch === "(") {
      this.i++;
      const a = this.alts(")");
      this.i++;
      return group(a);
    }
    if (ch === "<" || ch === ITALIC_OPEN) return this.placeholder();
    if (ELLIPSIS.test(this.t.slice(this.i))) throw new Fail("nothing to repeat");
    return this.word();
  }

  private placeholder(): Expr {
    const close = this.t[this.i] === "<" ? ">" : ITALIC_CLOSE;
    const end = this.t.indexOf(close, this.i + 1);
    if (end < 0) throw new Fail("unclosed placeholder");
    const text = this.t.slice(this.i + 1, end).trim();
    this.i = end + 1;
    return c("Placeholder", s(text));
  }

  private wordText(): string {
    const start = this.i;
    while (this.i < this.t.length) {
      const ch = this.t[this.i];
      if (SPACE.test(ch) || DELIMS.includes(ch) || ch === ITALIC_OPEN || ch === ITALIC_CLOSE) break;
      if (ELLIPSIS.test(this.t.slice(this.i))) break;
      this.i++;
    }
    return this.t.slice(start, this.i);
  }

  private word(): Expr {
    const w = this.wordText();
    if (w === "") throw new Fail("nothing here");
    if (!isFlag(w)) return c("Literal", s(w));
    // --[no-]name: the flag and its negation.
    const neg = /^\[([a-z]+-)\]/.exec(this.t.slice(this.i));
    if (neg && /-$/.test(w)) {
      this.i += neg[0].length;
      const name = this.wordText();
      if (name === "") throw new Fail("negatable flag has no name");
      const { base, value } = this.valued(w + name);
      return c("Choice", flagOf(w + name, value), flagOf(w + neg[1] + base.slice(w.length), value));
    }
    const { base, value } = this.valued(w);
    return flagOf(base, value);
  }

  /** A flag word's `=value`, or `[=value]` right after it. */
  private valued(w: string): { base: string; value?: Expr } {
    const eq = w.indexOf("=");
    if (eq >= 0) {
      const base = w.slice(0, eq);
      const rest = w.slice(eq + 1);
      if (rest) return { base, value: c("Literal", s(rest)) };
      const ch = this.t[this.i];
      if (ch === "<" || ch === "(" || ch === ITALIC_OPEN) return { base, value: this.item() };
      throw new Fail("missing value");
    }
    if (this.t.startsWith("[=", this.i)) {
      this.i += 2;
      const a = this.alts("]");
      this.i++;
      return { base: w, value: c("Optional", ...fold(a)) };
    }
    return { base: w };
  }
}

const flagOf = (flag: string, value?: Expr): Expr =>
  value ? c("Option", s(flag), ["value", value]) : c("Flag", s(flag));

const altOf = (elems: Expr[]): Expr => (elems.length === 1 ? elems[0] : c("Group", ...elems));

/** The elements of an optional's contents: one run, or one Choice of runs. */
function fold(a: Expr[][]): Expr[] {
  return a.length === 1 ? a[0] : [c("Choice", ...a.map(altOf))];
}

function group(a: Expr[][]): Expr {
  if (a.length > 1) return c("Choice", ...a.map(altOf));
  return altOf(a[0]);
}

function usage(line: string): Expr {
  let text = line.trim();
  // In git's pages the command's own name is italic, which is not a placeholder.
  if (text.startsWith(ITALIC_OPEN)) text = text.replace(ITALIC_OPEN, "").replace(ITALIC_CLOSE, "");
  const elems = new Parser(text).alts(null).flat();
  // The program and its subcommands: the plain words before the first option or placeholder.
  let lead = 0;
  while (lead < elems.length && isLiteral(elems[lead])) lead++;
  const words = elems.slice(0, lead).map((e) => positional(e as Call)[0]);
  return c("Usage", ...words, ...elems.slice(lead));
}

const isLiteral = (e: Expr) => isHead(e, "Literal");

/**
 * Usage lines, as text, into Usage structures. A line indented more than the least-indented one
 * continues the line before it.
 */
export function parseSynopsis(text: string): Expr[] {
  const lines = text
    .replace(/​/g, "")
    .split("\n")
    .filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const indent = (l: string) => l.length - l.trimStart().length;
  const least = Math.min(...lines.map(indent));
  const groups: string[][] = [];
  for (const l of lines) {
    if (indent(l) === least || groups.length === 0) groups.push([l]);
    else groups[groups.length - 1].push(l);
  }
  return groups.map((g) => usage(g.join(" ")));
}
