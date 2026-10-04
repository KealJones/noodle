// Read of a program's own help (design section 25: learning a tool is understanding its
// documentation, `--help` where it has no manual page). `Read(Help(program, ...words))` runs
// `program words --help`, held to reading (Run's confinement: no file written, no network), and
// turns what it prints into the same structure a manual page gives (manpage.ts): ManPage with a
// summary, a SYNOPSIS of Usage lines, and sections of Items (a term and what it says). Help text
// has no markup, so this reads its layout, the common one: headings (a line at the margin ending
// in a colon, or in capitals), usage lines (lines that start with the program's own name), and
// items (an indented term, then two spaces or a colon, then what it says, continued on more
// indented lines). Nothing here knows any program's words.
//
// `Read(Program(name))` says whether a program is there to learn: where it is on the PATH, and
// whether it has a manual page.

import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import { b, c, isCall, positional, s } from "../expr.js";
import type { Call, Expr } from "../expr.js";
import type { World } from "../primitive.js";
import { blockRef, SELF, str } from "./args.js";
import { canConfine, READ_ONLY, SANDBOX } from "./run.js";
import { parseSynopsis } from "./synopsis.js";

const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;

/** Where a program is on the PATH, if it is there. */
export function onPath(name: string): string | undefined {
  if (!NAME.test(name)) return undefined;
  for (const dir of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const p = join(dir, name);
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      // not here
    }
  }
  return undefined;
}

function hasManual(name: string): boolean {
  try {
    return execFileSync("man", ["-w", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000 }).trim() !== "";
  } catch {
    return false;
  }
}

/** `Read(Program(name))`: Program(name, path=..., manual=true|false), or an error if it is not there. */
export function readProgram(source: Call): Expr {
  const name = str(positional(source)[0], "a Program's name");
  const path = onPath(name);
  if (!path) throw new Error(`no program ${name} on the PATH`);
  return c("Program", s(name), ["path", s(path)], ["manual", b(hasManual(name))]);
}

/** What a program prints for help, run held to reading: its output, or its error output if it wrote nothing else. */
function helpOutput(world: World, program: string, args: string[]): string {
  if (!canConfine()) throw new Error(`${program} cannot be held to reading here, so its help is not read`);
  const opts = { encoding: "utf8" as const, timeout: world.timeoutMs ?? 10000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"], cwd: world.root, env: { ...process.env, PAGER: "cat", TERM: "dumb", NO_COLOR: "1", COLUMNS: "100" } };
  try {
    const out = execFileSync(SANDBOX, ["-p", READ_ONLY, program, ...args], opts);
    return out;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: string };
    if (err.code === "ENOENT") throw new Error(`could not start ${program}`);
    return err.stdout || err.stderr || "";
  }
}

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean);
const indentOf = (l: string) => l.length - l.trimStart().length;

/** An item line: an indented term, then two or more spaces (or a colon and a space), then what it says. */
const ITEM = /^(\s+)(-\S.*?|[A-Za-z0-9][\w.+-]*(?:,\s*[A-Za-z0-9][\w.+-]*)*:?)(?:\s{2,}|:\s+|\t+)(\S.*)$/;
/** An item with no description on its line. */
const BARE = /^(\s+)(-\S.*?|[A-Za-z0-9][\w.+-]*(?:,\s*[A-Za-z0-9][\w.+-]*)*:?)\s*$/;

export interface HelpParts {
  summary?: string;
  usages: string[];
  sections: { title: string; items: { term: string; text: string }[]; text: string[] }[];
}

/**
 * Help text into its parts. `path` is the command line it documents (the program and its
 * subcommands): a line that starts with them, after an optional "Xxx:" label, is a usage line.
 */
export function parseHelp(text: string, path: string[]): HelpParts {
  const lines = text.replace(/\r/g, "").replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  const out: HelpParts = { usages: [], sections: [] };
  const program = path[0];
  let section: HelpParts["sections"][number] | undefined;
  let item: { term: string; text: string } | undefined;
  let itemIndent = 0;
  // Where the item's description starts: a line that starts left of it is not its continuation.
  let column = 0;
  let inUsage = false;
  const paragraphs: string[][] = [[]];
  // A usage line names the program, alone or with its subcommands, as its first word.
  const usageText = (l: string): string | undefined => {
    const t = l.trim().replace(/^[A-Za-z][\w ]*:\s*/, "");
    const w = words(t);
    return w[0] === program || w[0]?.endsWith(`/${program}`) ? t : undefined;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\t/g, "        ");
    const trimmed = line.trim();
    if (!trimmed) {
      item = undefined;
      inUsage = false;
      if (!section) paragraphs.push([]);
      continue;
    }
    // "prog - what it does": a manual page's NAME line, at the top.
    const named = !out.summary && i < 3 ? new RegExp(`^${program.replace(/[.+]/g, "\\$&")}\\s+-\\s+(.+)$`).exec(trimmed) : null;
    if (named) {
      out.summary = named[1].replace(/\s*\[[^\]]*\]\s*$/, "");
      continue;
    }
    const u = usageText(line);
    const labelled = /^[A-Za-z][\w ]*:\s*\S/.test(trimmed) && indentOf(line) === 0;
    // A usage line is labelled ("Usage: prog ..."), follows one, opens a section of its own, or is
    // the first line that names the program.
    const opening = !!section && !section.items.length && !section.text.length;
    if (u && (labelled || inUsage || opening || (!section && out.usages.length === 0))) {
      out.usages.push(u);
      inUsage = true;
      item = undefined;
      continue;
    }
    // A heading: at the margin, and ending in a colon or all in capitals.
    if (indentOf(line) === 0 && (/:$/.test(trimmed) || (/^[A-Z][A-Z0-9 /&-]+$/.test(trimmed) && /[A-Z]{2}/.test(trimmed)))) {
      section = { title: trimmed.replace(/:$/, ""), items: [], text: [] };
      out.sections.push(section);
      item = undefined;
      inUsage = false;
      continue;
    }
    const m = ITEM.exec(line) ?? BARE.exec(line);
    if (inUsage && indentOf(line) > 0 && !(m && m[2].startsWith("-"))) {
      // A usage line continued.
      out.usages[out.usages.length - 1] += " " + trimmed;
      continue;
    }
    // A term starts a new item where it starts left of the description before it ("      --raw-output0"
    // under "  -r, --raw-output", "      unlink" under "  rm, remove"); further right, it continues it.
    if (m && indentOf(line) > 0 && (!item || indentOf(line) <= itemIndent || indentOf(line) < column)) {
      const target = section ?? (out.sections[0] ?? (out.sections.push({ title: "", items: [], text: [] }), out.sections[0]));
      item = { term: m[2].trim().replace(/:$/, ""), text: (m[3] ?? "").trim() };
      itemIndent = indentOf(line);
      column = m[3] ? line.indexOf(m[3], indentOf(line) + m[2].length) : line.length;
      target.items.push(item);
      continue;
    }
    if (item && indentOf(line) > itemIndent) {
      item.text += (item.text ? " " : "") + trimmed;
      continue;
    }
    item = undefined;
    if (section) section.text.push(trimmed);
    else paragraphs[paragraphs.length - 1].push(trimmed);
  }
  // The summary: the first paragraph before any heading that says something (three words or more).
  // A line that starts with the program's name and a colon is its complaint, not what it is.
  if (!out.summary) out.summary = paragraphs.map((p) => p.join(" ")).find((p) => words(p).length >= 3 && !p.startsWith(`${program}:`));
  return out;
}

/** In help text, a placeholder is in angle brackets or in capitals (`FILE`, `[FILES...]`). */
function marked(usage: string): string {
  return usage.replace(/(^|[\s[(|=])([A-Z][A-Z0-9_-]*[A-Z0-9])(?=$|[\s\])|.])/g, (_m, pre: string, w: string) => `${pre}<${w.toLowerCase()}>`);
}

/** `Read(Help(program, ...words))`: the program's help, as a manual page's structure. */
export function readHelp(world: World, source: Call): Expr {
  const args = positional(source).map((a) => str(a, "a Help's words"));
  const [program, ...sub] = args;
  if (!program || !onPath(program)) throw new Error(`no program ${program} on the PATH`);
  for (const w of sub) if (!NAME.test(w) || w.startsWith("-")) throw new Error(`not a subcommand: ${w}`);
  let text = helpOutput(world, program, [...sub, "--help"]);
  let parts = parseHelp(text, args);
  // Where `--help` printed nothing it documents, the program's own "help" subcommand may.
  if (!parts.usages.length && !parts.sections.some((x) => x.items.length)) {
    text = helpOutput(world, program, ["help", ...sub]);
    parts = parseHelp(text, args);
  }
  if (!parts.usages.length && !parts.sections.some((x) => x.items.length)) throw new Error(`${args.join(" ")} printed no help`);
  // The help is the program's own documentation, kept as its source.
  const block = (t: string) => blockRef(world.store.addBlock(t, "text/plain", c("ToolDoc", s(args[0] ?? program), s("--help"))).id);
  const usages = parseSynopsis(parts.usages.map(marked).join("\n"));
  const head: [string, Expr][] = [["name", s(args.join("-"))], ["command", s(args.join(" "))]];
  if (parts.summary) head.push(["summary", block(parts.summary)]);
  const sections: Expr[] = [];
  if (usages.length) sections.push(c("Section", s("SYNOPSIS"), c("Synopsis", ...usages)));
  for (const sec of parts.sections) {
    const body: Expr[] = [
      ...sec.text.length ? [c("Paragraph", block(sec.text.join(" ")))] : [],
      ...sec.items.map((it) => c("Item", ["term", block(it.term)], ...(it.text ? [c("Paragraph", block(it.text))] : []))),
    ];
    if (body.length) sections.push(c("Section", s(sec.title.toUpperCase()), ...body));
  }
  return c("ManPage", ...head, ...sections);
}

export const isHelp = (source: Expr): source is Call => isCall(source) && source.head === "Help";
