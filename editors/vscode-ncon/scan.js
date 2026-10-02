// @ts-check
/**
 * The one scanner behind the colors: every token in a .ncon text (docs/specs/ncon-format.md
 * section 1), and how deep each head and parenthesis sits. Shared by the extension and the
 * tests, so what is tested is what is painted.
 *
 * Heads and parentheses take their nesting depth's color. Everything else has one color of its
 * own.
 */

/**
 * @typedef {"head" | "form" | "open" | "close" | "comma" | "comment" | "string" | "raw" | "variable" |
 *   "anonymous" | "name" | "meta" | "equals" | "number" | "constant" | "escape"} Kind
 * @typedef {{ kind: Kind, start: number, end: number, depth: number, form?: boolean, of?: string }} Mark
 */

/** The only heads allowed at top level (section 2). */
const FORMS = new Set(["Pack", "Concept", "Fact", "Reading", "Block", "Retract"]);

/** Metadata names on a top-level form (section 3). They are not roles. */
const META = new Set(["from", "at", "status", "weight", "id"]);

const IDENT = /[A-Za-z0-9_]/;

/**
 * @param {string} text
 * @returns {{ marks: Mark[], unbalanced: number[] }}
 */
function scan(text) {
  /** @type {{ head: string, form: boolean }[]} */
  const frames = [];
  /** @type {Mark[]} */
  const marks = [];
  /** @type {number[]} */
  const unbalanced = [];
  const n = text.length;
  let pendingHead = "";
  let pendingForm = false;
  let i = 0;
  const mark = (/** @type {Kind} */ kind, /** @type {number} */ start, /** @type {number} */ end) => {
    const m = { kind, start, end, depth: frames.length };
    marks.push(m);
    return m;
  };
  while (i < n) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      mark("comment", i, stop);
      i = stop;
      continue;
    }
    if (text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3);
      const stop = end < 0 ? n : end + 3;
      mark("raw", i, stop);
      i = stop;
      continue;
    }
    if (ch === '"') {
      const start = i++;
      while (i < n && text[i] !== '"' && text[i] !== "\n") {
        if (text[i] === "\\") {
          mark("escape", i, i + 2);
          i += 2;
        } else i++;
      }
      i = Math.min(n, i + 1);
      mark("string", start, i);
      continue;
    }
    if (ch === "$" && /[A-Za-z_]/.test(text[i + 1] ?? "")) {
      let e = i + 1;
      while (e < n && IDENT.test(text[e])) e++;
      mark("variable", i, e);
      i = e;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let e = i;
      while (e < n && IDENT.test(text[e])) e++;
      // A sense: Word#WhatItIs is one head.
      if (/[A-Z]/.test(ch) && text[e] === "#" && /[A-Z]/.test(text[e + 1] ?? "")) {
        e++;
        while (e < n && IDENT.test(text[e])) e++;
      }
      const word = text.slice(i, e);
      let k = e;
      while (k < n && /\s/.test(text[k])) k++;
      if (/[A-Z]/.test(ch) && text[k] === "(") {
        const form = frames.length === 0 && FORMS.has(word);
        const m = mark(form ? "form" : "head", i, e);
        m.of = word;
        pendingHead = word;
        pendingForm = form;
      } else if (/[a-z]/.test(ch) && text[k] === "=" && text[k + 1] !== "=") {
        const top = frames[frames.length - 1];
        mark(top?.form && META.has(word) ? "meta" : "name", i, e);
        mark("equals", k, k + 1);
        i = k + 1;
        continue;
      } else if (word === "_") {
        mark("anonymous", i, e);
      } else if (word === "true" || word === "false" || word === "null") {
        mark("constant", i, e);
      }
      i = e;
      continue;
    }
    if ((ch === "-" && /[0-9]/.test(text[i + 1] ?? "")) || (/[0-9]/.test(ch) && !IDENT.test(text[i - 1] ?? ""))) {
      const m = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i));
      if (m) {
        mark("number", i, i + m[0].length);
        i += m[0].length;
        continue;
      }
    }
    if (ch === "(") {
      const m = mark("open", i, i + 1);
      m.of = pendingHead || undefined;
      // A form's parentheses are the form's, not the rainbow's.
      if (pendingForm) m.form = true;
      frames.push({ head: pendingHead, form: pendingForm });
      pendingHead = "";
      pendingForm = false;
      i++;
      continue;
    }
    if (ch === ")") {
      if (frames.length) {
        const frame = frames.pop();
        const m = mark("close", i, i + 1);
        if (frame?.form) m.form = true;
      } else unbalanced.push(i);
      i++;
      continue;
    }
    if (ch === ",") {
      const frame = frames[frames.length - 1];
      if (frames.length) {
        const m = mark("comma", i, i + 1);
        m.depth = frames.length - 1;
        m.of = frame?.head;
      }
    }
    if (!/\s/.test(ch)) {
      pendingHead = "";
      pendingForm = false;
    }
    i++;
  }
  // What is still open is unbalanced too.
  unbalanced.push(...openIndexes(marks));
  return { marks, unbalanced };
}

/** Offsets of parentheses never closed. */
function openIndexes(/** @type {Mark[]} */ marks) {
  /** @type {number[]} */
  const stack = [];
  for (const m of marks) {
    if (m.kind === "open") stack.push(m.start);
    else if (m.kind === "close") stack.pop();
  }
  return stack;
}

/**
 * The call the cursor is inside, and which argument it is in: for signature help.
 * @param {string} text
 * @param {number} offset
 * @returns {{ head: string, index: number, argument: string } | undefined} `argument` is the
 *   text of the argument being written, up to the cursor
 */
function callAt(text, offset) {
  const { marks } = scan(text.slice(0, offset));
  /** @type {{ head: string | undefined, depth: number, commas: number, from: number }[]} */
  const open = [];
  for (const m of marks) {
    if (m.kind === "open") open.push({ head: m.of, depth: m.depth, commas: 0, from: m.end });
    else if (m.kind === "close") open.pop();
    else if (m.kind === "comma" && open.length && m.depth === open[open.length - 1].depth) {
      open[open.length - 1].commas++;
      open[open.length - 1].from = m.end;
    }
  }
  const top = open[open.length - 1];
  return top?.head ? { head: top.head, index: top.commas, argument: text.slice(top.from, offset) } : undefined;
}

/** Monokai, one color per nesting level, cycling. Never yellow or orange: those are strings and variables. */
const RAINBOW = ["#F92672", "#A6E22E", "#66D9EF", "#AE81FF", "#5FD7AF", "#FF6AC1", "#7AA2F7"];

/**
 * Everything that is not nesting, in Monokai. Comments are left to the theme (the grammar
 * scopes them as comments), so they look exactly as they do in every other language.
 */
const PALETTE = {
  form: { color: "#66D9EF", fontStyle: "italic" },
  string: { color: "#E6DB74" },
  raw: { color: "#E6DB74" },
  escape: { color: "#AE81FF" },
  variable: { color: "#FD971F", fontStyle: "italic" },
  anonymous: { color: "#75715E", fontStyle: "italic" },
  name: { color: "#F8F8F2", fontStyle: "italic" },
  meta: { color: "#A59F85", fontStyle: "italic" },
  equals: { color: "#F92672" },
  number: { color: "#AE81FF" },
  constant: { color: "#AE81FF" },
  comma: { color: "#F8F8F2" },
};

module.exports = { scan, callAt, FORMS, META, RAINBOW, PALETTE };
