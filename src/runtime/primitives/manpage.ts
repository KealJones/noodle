// Read of a manual page (runtime.md section 9; design section 25: learning a tool is understanding
// its documentation). The page is found with `man -w` and parsed by mandoc, a real roff parser
// (`mandoc -T tree`); this module turns mandoc's tree into structure: ManPage, Section,
// Subsection, Paragraph, Item and Synopsis. Running text is kept as content blocks. Emphasis is not
// kept as markup, except that italic in a SYNOPSIS marks a placeholder (synopsis.ts reads it).

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { c, isCall, n, positional, s } from "../expr.js";
import type { Call, Expr } from "../expr.js";
import type { World } from "../primitive.js";
import { blockRef, SELF, str } from "./args.js";
import { ITALIC_CLOSE, ITALIC_OPEN, parseSynopsis } from "./synopsis.js";

// ---- finding and parsing the page --------------------------------------------------------------

const run = (world: World, program: string, args: string[], input?: Buffer): string => {
  try {
    return execFileSync(program, args, {
      encoding: "utf8",
      input,
      timeout: world.timeoutMs ?? 30000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C" },
    });
  } catch (e) {
    const err = e as { code?: string; stdout?: string; stderr?: string; message: string };
    if (err.code === "ENOENT") throw new Error(`${program} was not found: reading a manual page needs it (it is at /usr/bin/mandoc on macOS)`);
    // mandoc reports style warnings through its exit status and still writes the tree.
    if (program === "mandoc" && err.stdout) return err.stdout;
    throw new Error(`${program} failed: ${(err.stderr || err.message).trim()}`);
  }
};

function findPage(world: World, name: string, section?: string): string {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.+:@-]*$/.test(name)) throw new Error(`not a manual page name: ${name}`);
  if (section !== undefined && !/^[0-9][A-Za-z0-9]*$/.test(section)) throw new Error(`not a manual section: ${section}`);
  let out: string;
  try {
    out = run(world, "man", ["-w", ...(section ? [section] : []), name]);
  } catch (e) {
    if (/was not found/.test((e as Error).message)) throw e;
    throw new Error(`no manual page for ${name}${section ? ` in section ${section}` : ""}`);
  }
  const page = out.split("\n").find((l) => l.trim() !== "");
  if (!page) throw new Error(`no manual page for ${name}${section ? ` in section ${section}` : ""}`);
  return page.trim();
}

interface TNode {
  kind: string;
  name: string;
  indent: number;
  nofill: boolean;
  kids: TNode[];
}

// A node's line: its name, its kind, then (for an mdoc list or display) its arguments, then its
// position ("Bl (block) -tag -width [ [indent] ] *71:2").
const NODE = /^( *)(.*?) \((block|head|body|elem|text|comment)\)(?: (?![*\d]).*?)? \*?\d+:\d+\.?(.*)$/;

/** mandoc's tree: one node per line, nested by indentation, text lines at the leaves. */
function parseTree(out: string): { root: TNode; section: string | undefined } {
  const root: TNode = { kind: "root", name: "", indent: -1, nofill: false, kids: [] };
  const stack = [root];
  let section: string | undefined;
  for (const line of out.split("\n")) {
    const sec = /^sec\s*=\s*"(.*)"$/.exec(line);
    if (sec) section = sec[1];
    const m = NODE.exec(line);
    if (!m || m[3] === "comment") continue;
    const node: TNode = { kind: m[3], name: m[2], indent: m[1].length, nofill: /\bNOFILL\b/.test(m[4]), kids: [] };
    // Text is a leaf, and verbatim text keeps the page's own indentation after the tree's, so it
    // only nests under an inline element when it sits exactly one level inside it.
    while (stack.length > 1) {
      const top = stack[stack.length - 1];
      if (top.indent >= node.indent || (node.kind === "text" && top.kind === "elem" && (node.nofill || node.indent !== top.indent + 4))) stack.pop();
      else break;
    }
    stack[stack.length - 1].kids.push(node);
    if (node.kind !== "text") stack.push(node);
  }
  return { root, section };
}

// ---- roff text ---------------------------------------------------------------------------------

const CHARS: Record<string, string> = {
  lq: '"', rq: '"', dq: '"', oq: "'", cq: "'", aq: "'", Aq: "'", hy: "-", en: "-", em: " - ", mi: "-", bu: "*",
  rs: "\\", ha: "^", ti: "~", ga: "`", aa: "'", co: "(C)", rg: "(R)", pl: "+", eq: "=", sl: "/", ba: "|", or: "|",
  lB: "[", rB: "]", lC: "{", rC: "}", le: "<=", ge: ">=", ne: "!=", "->": "->", "<-": "<-", "+-": "+-",
};
const SIMPLE: Record<string, string> = { "-": "-", e: "\\", "\\": "\\", " ": " ", "~": " ", "0": " ", ".": ".", "'": "'", "`": "`" };
const NOTHING = "&%|^/,:c";

/**
 * A roff line as plain text: escapes and special characters resolved, fonts dropped. With
 * `italic`, italic runs are bracketed so the synopsis reader can tell placeholders.
 */
function unescape(raw: string, italic = false): string {
  let out = "";
  let ital = false;
  const setItalic = (on: boolean) => {
    if (!italic || on === ital) return;
    out += on ? ITALIC_OPEN : ITALIC_CLOSE;
    ital = on;
  };
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    // mandoc marks a hyphen, a no-break space and a break point inside words with controls.
    if (ch === "\x1e") out += "-";
    else if (ch === "\x1f") out += " ";
    else if (ch === "\x1d") continue;
    else if (ch !== "\\") out += ch;
    else {
      const next = raw[++i];
      if (next === undefined) break;
      if (next === "f") {
        let font: string;
        if (raw[i + 1] === "(") {
          font = raw.slice(i + 2, i + 4);
          i += 3;
        } else if (raw[i + 1] === "[") {
          const end = raw.indexOf("]", i);
          font = raw.slice(i + 2, end);
          i = end;
        } else font = raw[++i] ?? "";
        setItalic(font === "I" || font === "BI");
      } else if (next === "(" || next === "[") {
        const end = next === "(" ? i + 3 : raw.indexOf("]", i);
        const name = next === "(" ? raw.slice(i + 1, end) : raw.slice(i + 1, end);
        const u = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
        out += u ? String.fromCodePoint(parseInt(u[1], 16)) : (CHARS[name] ?? `\\${next}${name}${next === "[" ? "]" : ""}`);
        i = next === "(" ? end - 1 : end;
      } else if (next === "*") {
        const name = raw[i + 1] === "(" ? raw.slice(i + 2, i + 4) : raw[i + 1] === "[" ? raw.slice(i + 2, raw.indexOf("]", i)) : (raw[i + 1] ?? "");
        const len = raw[i + 1] === "(" ? 3 : raw[i + 1] === "[" ? name.length + 2 : 1;
        out += CHARS[name] ?? `\\*${raw.slice(i + 1, i + 1 + len)}`;
        i += len;
      } else if (next === "h" || next === "v" || next === "z" || next === "w" || next === "o" || next === "b" || next === "N") {
        const q = raw[i + 1];
        const end = q ? raw.indexOf(q, i + 2) : -1;
        if (end > 0) i = end;
      } else if (next === "s") {
        const m = /^[+-]?\d+/.exec(raw.slice(i + 1));
        if (m) i += m[0].length;
      } else if (next in SIMPLE) out += SIMPLE[next];
      else if (!NOTHING.includes(next)) out += next;
    }
  }
  setItalic(false);
  return out;
}

const fillText = (raw: string) => unescape(raw).replace(/\s+/g, " ").trim();

// ---- flow: what a body holds ---------------------------------------------------------------------

type Tok =
  | { t: "text"; raw: string; nofill: boolean; extra: number }
  | { t: "para" }
  | { t: "line" }
  | { t: "rs"; kids: Tok[] }
  | { t: "ss"; title: string; kids: Tok[] }
  | { t: "tagged"; term: string; kids: Tok[] };

const child = (node: TNode, kind: string) => node.kids.find((k) => k.kind === kind);

// The text under a node, in order, at any depth (an mdoc item's head is macros: Fl, Ar).
const textUnder = (node: TNode): string[] => node.kids.flatMap((k) => (k.kind === "text" ? [fillText(k.name)] : textUnder(k))).filter(Boolean);

const headText = (node: TNode) => textUnder(child(node, "head") ?? { kind: "head", name: "", indent: 0, nofill: false, kids: [] });

/**
 * mdoc pages (BSD's, most of macOS's own tools) write a flag as `Fl x` and print it as `-x`: the
 * dash is put back on the text, so what follows reads them as man(7) pages are read.
 */
function mdocFlags(node: TNode) {
  for (const k of node.kids) mdocFlags(k);
  if (node.name !== "Fl") return;
  const t = node.kids.find((k) => k.kind === "text");
  if (t) t.name = t.name.startsWith("-") ? t.name : `-${t.name}`;
  else node.kids.push({ kind: "text", name: "-", indent: node.indent + 4, nofill: false, kids: [] });
}

/** A body's children as a flat run of text, breaks and indented or tagged groups. */
function toks(nodes: TNode[], holder: number): Tok[] {
  const out: Tok[] = [];
  for (const node of nodes) {
    if (node.kind === "text") out.push({ t: "text", raw: node.name, nofill: node.nofill, extra: Math.max(0, node.indent - holder - 4) });
    else if (node.kind === "elem") {
      if (node.name === "br") out.push({ t: "line" });
      else if (node.kids.length > 0) out.push(...toks(node.kids, node.indent));
      else out.push({ t: "para" });
    } else if (node.kind === "block") {
      const body = child(node, "body");
      const inner = body ? toks(body.kids, body.indent) : [];
      switch (node.name) {
        case "RS":
          out.push({ t: "rs", kids: inner });
          break;
        case "SS":
        case "Ss":
          out.push({ t: "ss", title: headText(node).join(" "), kids: inner });
          break;
        case "It":
          // An mdoc list item: its head is the term (a flag and its argument), its body what it does.
          out.push({ t: "tagged", term: headText(node).join(" "), kids: inner });
          break;
        case "TP":
        case "IP": {
          const tag = headText(node);
          // IP's last head word is the indent width.
          if (node.name === "IP" && tag.length > 1 && /^\d+$/.test(tag[tag.length - 1])) tag.pop();
          out.push({ t: "tagged", term: tag.join(" "), kids: inner });
          break;
        }
        default:
          // PP and its kin start a paragraph; the paragraph's text is the body's.
          out.push({ t: "para" }, ...inner);
      }
    }
  }
  return out;
}

const MARKER = /^\\h'[^']*'.*\\h'[^']*'\\c$/;
const isMarker = (t: Tok | undefined) => t?.t === "text" && MARKER.test(t.raw.trim());

interface Line {
  raw: string;
  nofill: boolean;
  extra: number;
  after: "space" | "newline" | "join";
}

/** The text of a paragraph's lines: filled lines run together, verbatim ones keep their breaks. */
function textOf(lines: Line[]): string {
  let out = "";
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    if (prev) out += l.after === "join" ? "" : l.after === "newline" || (prev.nofill && l.nofill) ? "\n" : " ";
    out += l.nofill ? " ".repeat(l.extra) + unescape(l.raw).trimEnd() : fillText(l.raw);
  });
  return out.replace(/ +\n/g, "\n").trim();
}

class Builder {
  constructor(private readonly world: World) {}

  block(text: string): Expr {
    return blockRef(this.world.store.addBlock(text, "text/plain", SELF).id);
  }

  /** A body's content as Paragraph, Item and Subsection parts. */
  parts(tokens: Tok[]): Expr[] {
    const out: Expr[] = [];
    let lines: Line[] = [];
    let pendingBreak = false;
    const take = (): string | undefined => {
      const text = textOf(lines);
      lines = [];
      pendingBreak = false;
      return text === "" ? undefined : text;
    };
    const flush = () => {
      const text = take();
      if (text !== undefined) out.push(c("Paragraph", this.block(text)));
    };
    for (const tok of tokens) {
      switch (tok.t) {
        case "text": {
          const prev = lines[lines.length - 1];
          const after = prev && /\\c$/.test(prev.raw.trim()) ? "join" : pendingBreak ? "newline" : "space";
          pendingBreak = false;
          lines.push({ raw: tok.raw.replace(/\\c\s*$/, ""), nofill: tok.nofill, extra: tok.extra, after });
          break;
        }
        case "line":
          pendingBreak = true;
          break;
        case "para":
          flush();
          break;
        case "rs": {
          // Text straight before an indented block is its term, as a tagged item's tag is.
          const term = take();
          if (term !== undefined) out.push(c("Item", ["term", this.block(term)], ...this.parts(tok.kids)));
          else if (isMarker(tok.kids[0])) out.push(c("Item", ...this.parts(tok.kids.slice(1))));
          else out.push(...this.parts(tok.kids));
          break;
        }
        case "ss":
          flush();
          out.push(c("Subsection", s(tok.title), ...this.parts(tok.kids)));
          break;
        case "tagged":
          flush();
          // A bullet's marker (a lone "*" once resolved) is not a term.
          out.push(c("Item", ...(tok.term && tok.term !== "*" ? [["term", this.block(tok.term)] as [string, Expr]] : []), ...this.parts(tok.kids)));
          break;
      }
    }
    flush();
    return out;
  }

  /** The SYNOPSIS: its text lines, each usage on its own, and anything under a heading after. */
  synopsis(tokens: Tok[]): Expr[] {
    const lines: string[] = [];
    let run = "";
    const end = () => {
      if (run !== "") lines.push(run);
      run = "";
    };
    const walk = (ts: Tok[]) => {
      for (const tok of ts) {
        if (tok.t === "text") {
          const text = unescape(tok.raw.replace(/\\c\s*$/, ""), true);
          if (tok.nofill) {
            end();
            lines.push(" ".repeat(tok.extra) + text.trimEnd());
          } else run += (run === "" ? "" : " ") + text.replace(/\s+/g, " ").trim();
        } else if (tok.t === "para" || tok.t === "line") end();
        else if (tok.t === "rs" || tok.t === "tagged") {
          end();
          walk(tok.kids);
        }
      }
    };
    walk(tokens.filter((t) => t.t !== "ss"));
    end();
    const usages = parseSynopsis(lines.join("\n"));
    return [...(usages.length > 0 ? [c("Synopsis", ...usages)] : []), ...this.parts(tokens.filter((t) => t.t === "ss"))];
  }
}

// ---- the page ----------------------------------------------------------------------------------

/** `Read(ManPage(name))` and `Read(ManPage(name, section))`. */
export function readManPage(world: World, source: Call): Expr {
  const args = positional(source);
  const name = str(args[0], "a ManPage's name");
  const sec = args[1] === undefined ? undefined : args[1].kind === "number" ? String(args[1].value) : str(args[1], "a ManPage's section");
  const page = findPage(world, name, sec);
  const tree = page.endsWith(".gz")
    ? run(world, "mandoc", ["-T", "tree"], gunzipSync(fs.readFileSync(page)))
    : run(world, "mandoc", ["-T", "tree", page]);
  const { root, section } = parseTree(tree);
  mdocFlags(root);
  const build = new Builder(world);

  const head: [string, Expr][] = [["name", s(name)]];
  if (section !== undefined) head.push(["section", /^\d+$/.test(section) ? n(Number(section)) : s(section)]);
  const sections: Expr[] = [];
  for (const node of root.kids) {
    if (node.kind !== "block" || (node.name !== "SH" && node.name !== "Sh")) continue;
    const title = headText(node).join(" ");
    const body = child(node, "body");
    const tokens = body ? toks(body.kids, body.indent) : [];
    // An mdoc NAME says the names with Nm and the summary with Nd.
    const nd = title === "NAME" ? body?.kids.find((k) => k.name === "Nd") : undefined;
    if (nd) {
      const summary = textUnder(child(nd, "body") ?? nd).join(" ");
      const command = (body?.kids.find((k) => k.name === "Nm") ? textUnder(body.kids.find((k) => k.name === "Nm")!) : [])[0];
      if (summary) head.push(["summary", build.block(summary)]);
      if (command) head.push(["command", s(command)]);
    } else if (title === "NAME") {
      const raw = tokens
        .filter((t) => t.t === "text")
        .map((t) => (t as { raw: string }).raw.trim())
        .join(" ");
      // The page's own separator between the names and the summary is a spaced, escaped hyphen.
      // Some pages (gh's) write a plain hyphen instead.
      const escaped = raw.indexOf(" \\- ");
      const plain = escaped < 0 ? / - /.exec(raw)?.index ?? -1 : -1;
      const cut = escaped >= 0 ? escaped : plain;
      if (cut >= 0) {
        const command = fillText(raw.slice(0, cut)).split(",")[0].trim();
        const summary = fillText(raw.slice(cut + (escaped >= 0 ? 4 : 3)));
        if (summary) head.push(["summary", build.block(summary)]);
        if (command) head.push(["command", s(command)]);
      }
    }
    sections.push(c("Section", s(title), ...(title === "SYNOPSIS" ? build.synopsis(tokens) : build.parts(tokens))));
  }
  return c("ManPage", ...head, ...sections);
}

export const isManPage = (source: Expr): source is Call => isCall(source) && source.head === "ManPage";
