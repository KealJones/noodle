// Learning what commands are for from tldr-pages (https://github.com/tldr-pages/tldr, CC BY 4.0;
// design sections 20, 22 and 25). A tldr page is a command's documentation written as tasks: a
// summary ("> List open files and the corresponding processes."), then examples, each a line that
// says what it does ("- Find the process that opened a local internet port:") and the command line
// that does it (`lsof -i :{{port}}`).
//
// Each example becomes a task: a concept of its own, part of the tool, whose description is kept
// and understood by Noodle's own pipeline into what it does (Describes, as a man page's summary is,
// tooldocs.ts), with one reading that runs its command line. Each {{placeholder}} is a slot, a
// variable of the reading. Where the description names the thing a slot is (the placeholder's name
// heard as a word: "port", "path/to/file" is a file, "branch_name" a name or a branch), the slot
// takes that thing's place in what the description is understood as, so a request matched against
// it by the scored match (runtime.md 6.2) fills the slot with what the request says there. Nothing
// fills a slot otherwise: a match that leaves one unfilled does not stand for the request, so the
// task is not reached, never run with a guess (design section 23).
//
// What an example changes is what the store already knows of its command: a command whose own
// documentation (its man page or its help) says it only shows something, run with options that
// each only show, only reads; any other is unknown, so it is offered before it runs. The source is
// Tldr, at the documentation's trust level (3) in the trust table: it proposes, never grants.
//
// Nothing here knows any command: the same code reads every page.

import { createHash } from "node:crypto";
import { type Call, type Expr, c, isCall, isHead, key, n, positional, role, s, v, walk } from "../runtime/expr.js";
import type { Store } from "../runtime/store.js";
import { format } from "../ncon/index.js";
import { Names, encodeLemma } from "./names.js";
import { type Understood, summaryReader } from "./tooldocs.js";

/** One tldr page, as written. */
export interface TldrPage {
  /** Its command, as its title says it ("lsof", "git reset"). */
  name: string;
  /** The folder it is in: common, osx, linux. */
  platform: string;
  /** Its summary lines, without the pointer to more information. */
  summary: string[];
  examples: { description: string; command: string }[];
}

export interface TldrResult {
  text: string;
  pages: number;
  examples: number;
  /** Examples whose description was understood (they get a Describes fact and a reading). */
  understood: number;
  /** Slots placed in what the description says. */
  placed: number;
  slots: number;
  /** Examples whose command's effects came from its own documentation. */
  knownEffects: number;
  skipped: { page: string; command: string; why: string }[];
}

/** Reads a page's markdown. Undefined where it has no title. */
export function parsePage(text: string, platform: string): TldrPage | undefined {
  const lines = text.split("\n").map((l) => l.trim());
  const title = lines.find((l) => l.startsWith("# "));
  if (!title) return undefined;
  const summary = lines
    .filter((l) => l.startsWith(">"))
    .map((l) => l.replace(/^>\s*/, ""))
    .filter((l) => l && !/^More information:/i.test(l));
  const examples: TldrPage["examples"] = [];
  let pending: string | undefined;
  for (const l of lines) {
    if (l.startsWith("- ")) pending = l.slice(2).replace(/:$/, "").trim();
    else if (pending !== undefined && /^`.*`$/.test(l)) {
      examples.push({ description: pending, command: l.slice(1, -1) });
      pending = undefined;
    }
  }
  return { name: title.slice(2).trim(), platform, summary, examples };
}

/** A command line's argument: literal text and slots, written together. */
type Piece = { text: string } | { slot: string };
export interface ParsedCommand {
  args: Piece[][];
}

/**
 * Reads a command line into its arguments, or says why it cannot be run without a shell (Run
 * starts a program with an argument array, never through a shell: design section 26b). A
 * placeholder that offers spellings of an option ({{[-h|--human-readable]}}) is the option, in its
 * long spelling (the one a command line is read by, as tooldocs takes); one that offers values
 * with no name ({{b|k|m}}) names no slot, so the example is left out.
 */
export function parseCommand(line: string): ParsedCommand | { why: string } {
  const args: Piece[][] = [];
  let cur: Piece[] | undefined;
  const push = (p: Piece) => {
    cur ??= [];
    const last = cur.at(-1);
    if ("text" in p && last && "text" in last) last.text += p.text;
    else cur.push(p);
  };
  const end = () => {
    if (cur?.length) args.push(cur);
    cur = undefined;
  };
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (line.startsWith("{{", i)) {
      const close = line.indexOf("}}", i + 2);
      if (close < 0) return { why: "an unclosed placeholder" };
      const inner = line.slice(i + 2, close);
      i = close + 1;
      const options = /^\[(.*)\]$/.exec(inner);
      if (options) {
        const spellings = options[1].split("|");
        const long = spellings[spellings.length - 1].trim().split(/\s+/);
        if (quote) return { why: "an option inside quotes" };
        long.forEach((w, j) => {
          if (j) end();
          push({ text: w });
        });
        continue;
      }
      if (inner.includes("|")) return { why: "a placeholder of values with no name" };
      const name = inner.trim().split(/\s+/)[0];
      if (!/[A-Za-z]/.test(name)) return { why: "a placeholder with no name" };
      push({ slot: name });
      continue;
    }
    if (quote) {
      if (ch === quote) quote = undefined;
      else push({ text: ch });
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur ??= [];
      continue;
    }
    if (/\s/.test(ch)) {
      end();
      continue;
    }
    // What only a shell does: pipes, redirections, sequences, substitutions, globs, variables, home.
    if (/[|<>;&`$*?\\]/.test(ch) || (ch === "~" && !cur?.length) || (ch === "=" && args.length === 0)) return { why: "shell syntax" };
    push({ text: ch });
  }
  if (quote) return { why: "an unclosed quotation" };
  end();
  if (!args.length || args[0].length !== 1 || !("text" in args[0][0])) return { why: "no program" };
  return { args };
}

/** A placeholder's name as words, the thing it is first: "path/to/source.tar.ext" is a source, then a path. */
function slotWords(name: string): string[] {
  const clean = name.replace(/\.{3}$/, "").replace(/\d+/g, "");
  const parts = clean.split("/").filter(Boolean);
  const last = parts.pop() ?? "";
  const [stem, ...ext] = last.split(".");
  const words = (x: string) => x.split(/[^A-Za-z]+/).filter(Boolean).map((w) => w.toLowerCase());
  const own = words(stem).reverse();
  const rest = [...ext.flatMap(words), ...parts.flatMap(words)].reverse();
  return [...own, ...rest].filter((w, i, all) => all.indexOf(w) === i);
}

/** A variable's name for a slot: letters, digits and underscores. */
const varName = (slot: string) => {
  const x = slot.replace(/\.{3}$/, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[A-Za-z]/.test(x) ? x : `slot_${x}`;
};

/** What a phrase is at its core: a referent's kind, and inside what only says how many ("a", "some"). */
function core(e: Expr): Expr {
  if (isHead(e, "Ref") && role(e, "kind")) return core(role(e, "kind")!);
  if (isCall(e) && ["Some", "Every", "The", "A"].includes(e.head) && positional(e).length === 1) return core(positional(e)[0]);
  return e;
}

/**
 * The phrases of what a description says, outermost first: not the words it was said with (a
 * referent's said, which the scored match leaves out), nor a phrase a slot has already taken.
 */
function phrases(e: Expr): Call[] {
  if (!isCall(e)) return [];
  const inner = e.args.filter((a) => a.name !== "said").flatMap((a) => phrases(a.value));
  return [...walk(e)].some((x) => x.kind === "variable") ? inner : [e, ...inner];
}

/** The expression with the first phrase whose core is `at` replaced. */
function replaceAt(e: Expr, at: Expr, by: Expr): Expr {
  if (e === at) return by;
  if (!isCall(e)) return e;
  let done = false;
  const args = e.args.map((a) => {
    if (done || a.name === "said") return a;
    const x = replaceAt(a.value, at, by);
    if (x !== a.value) done = true;
    return x === a.value ? a : { ...a, value: x };
  });
  return done ? { ...e, args } : e;
}

const isSeedPart = (from: Expr, part: string) => isHead(from, "Seed") && positional(from)[0]?.kind === "string" && (positional(from)[0] as { value: string }).value === part;

export async function learnTldr(
  pages: TldrPage[],
  store: Store,
  /** The words other packs give (and no tool's readings), to understand the descriptions with. */
  words?: Store,
  /** What the store knows of commands (the tool packs), for what an example changes. */
  known?: Store,
  version = "local",
  progress?: (done: number, total: number) => void,
): Promise<TldrResult> {
  const lex = words ?? store;
  const names = new Names(lex);
  const understand = words ? summaryReader(words) : undefined;
  const forms: Expr[] = [];
  const blocks = new Set<string>();
  const block = (text: string, from: Expr): Expr => {
    const id = "b_" + createHash("sha256").update(text).digest("hex").slice(0, 16);
    if (!blocks.has(id)) {
      blocks.add(id);
      forms.push(c("Block", ["id", s(id)], ["media", s("text/markdown")], ["body", s(text)], ["from", from]));
    }
    return c("Block", s(id));
  };
  const result: TldrResult = { text: "", pages: 0, examples: 0, understood: 0, placed: 0, slots: 0, knownEffects: 0, skipped: [] };
  const tools = new Set<string>();
  const named_ = new Set<string>();
  const isNoun = (concept: string) => lex.facts(concept, "Category").some((f) => isCall(f.claim) && ["Noun", "Thing"].some((k) => isHead(positional(f.claim as Call)[0], k)));
  const functionWord = (concept: string) => lex.facts(concept).some((f) => isSeedPart(f.meta.from, "function-words"));
  // The concepts a word may be as a noun.
  const nouns = new Map<string, string[]>();
  const nounsOf = (w: string) => {
    let have = nouns.get(w);
    if (!have) {
      const hits = lex.lookup(w).map((h) => h.concept);
      have = hits.some(functionWord) ? [] : [...new Set(hits.filter(isNoun))];
      nouns.set(w, have);
    }
    return have;
  };
  const isKind = (head: string, kind: string) => (lex.kinds(head).get(kind) ?? Infinity) <= 1;

  // The command senses the tool packs give, by the page they come from.
  let senses: Map<string, string> | undefined;
  const senseFrom = (from: Expr) => {
    if (!senses) {
      senses = new Map();
      for (const f of known?.factsWithHead("SenseOf") ?? []) if (isHead(f.meta.from, "ToolDoc")) senses.set(key(f.meta.from), f.subject);
    }
    return senses.get(key(from));
  };
  // What the documentation the store has says a command changes (tooldocs' readings' effects), and
  // the options it lists. Undefined where the store does not know the command.
  const effectsKnown = (path: string[], flags: string[]): Expr | undefined => {
    if (!known) return undefined;
    const pageFrom = key(c("ToolDoc", s(path.join("-")), s("NAME")));
    const word = known.lookup(path[path.length - 1]).map((h) => h.concept);
    const runs = word.flatMap((w) => known.readingsOn(w)).filter((r) => key(r.meta.from) === pageFrom && isHead(r.becomes, "Run"));
    if (!runs.length) return undefined;
    const reads = (es: Expr[]) => es.length > 0 && es.every((e) => isHead(e, "Reads"));
    if (!runs.every((r) => reads(r.effects))) return c("UnknownEffects");
    // Each option used must be one the command's page lists, and itself only show.
    const sense = senseFrom(c("ToolDoc", s(path.join("-")), s("NAME")));
    for (const flag of flags) {
      const option = sense
        ? known
            .factsNaming(sense)
            .filter((f) => isHead(f.claim, "PartOf"))
            .map((f) => f.subject)
            .find((o) => known.facts(o, "Name").some((nf) => (positional(nf.claim as Call)[0] as { value?: string })?.value === flag))
        : undefined;
      if (!option) return c("UnknownEffects");
      const main = (positional(known.facts(option, "Name")[0].claim as Call)[0] as { value: string }).value;
      const optFrom = key(c("ToolDoc", s(path.join("-")), s(main)));
      const optRuns = word.flatMap((w) => known.readingsOn(w)).filter((r) => key(r.meta.from) === optFrom);
      if (!optRuns.length || !optRuns.every((r) => reads(r.effects))) return c("UnknownEffects");
    }
    return c("Reads");
  };

  for (const [pi, page] of pages.entries()) {
    progress?.(pi, pages.length);
    result.pages++;
    const pageName = `${page.platform}/${page.name.replace(/\s+/g, "-")}`;
    const pageFrom = c("Tldr", s(pageName));
    const title = page.name.split(/\s+/);
    const program = title[0];
    const toolWord = names.word(program);
    // A tool, called by its name (as tooldocs names one), where no other page has said so.
    if (!tools.has(toolWord) && !(known ?? lex).facts(toolWord, "IsA").some((f) => isHead(positional(f.claim as Call)[0], "Tool")) && !lex.lookup(program).some((h) => functionWord(h.concept))) {
      const claims: Expr[] = [c("IsA", c("Tool")), c("Name", s(program))];
      if (!lex.facts(toolWord, "Lemma").length) claims.unshift(c("Lemma", s(program)));
      if (!lex.facts(toolWord, "Category").length)
        claims.push(c("Category", c("Thing")), c("Category", c("Manner"), c("Modifies", ["side", c("Right")], ["category", c("Act")], ["role", c("Instrument")])));
      forms.push(c("Concept", c(toolWord), ...claims, ["from", pageFrom]));
    }
    tools.add(toolWord);
    // The summary is the tool's (or, for a page of a subcommand, its own), as a man page's is.
    // A subcommand the tool's own documentation has is that command; one it does not is new.
    const command = encodeLemma(page.name) ?? toolWord;
    const knownSense = title.length > 1 ? senseFrom(c("ToolDoc", s(title.join("-")), s("NAME"))) : undefined;
    const owner = title.length === 1 ? toolWord : (knownSense ?? names.other(`tldr-command:${page.name}`, `${command}#TldrCommand`));
    if (title.length > 1 && !knownSense) forms.push(c("Concept", c(owner), c("IsA", c("Command")), c("PartOf", c(toolWord)), c("Name", s(title.slice(1).join(" "))), ["from", pageFrom]));
    if (page.summary.length) forms.push(c("Concept", c(owner), c("Said", block(page.summary.join("\n"), pageFrom)), ["from", pageFrom]));

    for (const [i, ex] of page.examples.entries()) {
      result.examples++;
      const parsed = parseCommand(ex.command);
      if ("why" in parsed) {
        result.skipped.push({ page: pageName, command: ex.command, why: parsed.why });
        continue;
      }
      const from = c("Tldr", s(pageName), n(i + 1));
      const example = names.other(`tldr:${pageName}:${i + 1}`, `${command}#Tldr${i + 1}`);
      // What the description says, without tldr's marks for the letters an option is named by
      // ("E[x]tract"). Code spans stay: what they name is heard as a name ("Create a `package.json`
      // file" is about that file, not any file).
      const said = ex.description.replace(/\[([A-Za-z]+)\]/g, "$1");
      // Called by its command line, as the page writes it.
      const claims: Expr[] = [c("PartOf", c(owner)), c("Name", s(ex.command)), c("Said", block(said, from))];
      // What is said in parentheses is an aside to what the example does ("(running and stopped)").
      const u: Understood | undefined = await understand?.(said.replace(/\s*\([^()]*\)/g, "").trim());
      const slots = [...new Set(parsed.args.flat().flatMap((p) => ("slot" in p ? [p.slot] : [])))];
      result.slots += slots.length;
      const program0 = (parsed.args[0][0] as { text: string }).text;
      const argv = parsed.args.slice(1).map((pieces) => {
        const parts = pieces.map((p) => ("slot" in p ? v(varName(p.slot)) : s(p.text)));
        return parts.length === 1 ? parts[0] : c("Joined", ...parts);
      });
      const becomes = c("Run", s(program0), c("Args", ...argv));
      // The command it is: the page's, where the command line starts with its words.
      const words0 = parsed.args.map((a) => (a.length === 1 && "text" in a[0] ? a[0].text : ""));
      const path = title.every((w, j) => words0[j] === w) ? title : [program0];
      const flags = words0.slice(path.length).filter((w) => /^--?[A-Za-z]/.test(w)).map((w) => w.split("=")[0]);
      const effects = effectsKnown(path, flags);
      if (effects) result.knownEffects++;
      if (u) {
        result.understood++;
        // Each slot takes the place of the thing the description names it as: said as the
        // request's own words there (a file's name), or as one of that kind with them ("port 3000").
        let bare: Expr = u.what;
        let named: Expr = u.what;
        let placed = 0;
        for (const slot of slots) {
          // The thing it is first ("file" of path/to/file), the phrase that is one before one of
          // a narrower kind; never what the description is as a whole (the act itself).
          const nodes = phrases(named).filter((x) => x !== named && isCall(core(x)) && isNoun((core(x) as Call).head));
          let at: Call | undefined;
          for (const w of slotWords(slot)) {
            const kinds = nounsOf(w);
            at = nodes.find((x) => kinds.includes((core(x) as Call).head)) ?? nodes.find((x) => kinds.some((k) => isKind((core(x) as Call).head, k)));
            if (at) break;
          }
          if (!at) continue;
          const atBare = phrases(bare).find((x) => key(x) === key(at));
          if (atBare) bare = replaceAt(bare, atBare, v(varName(slot)));
          named = replaceAt(named, at, c((core(at) as Call).head, v(varName(slot))));
          placed++;
          // A slot is one of its kind written as its value ({{port}} is a port, said as 3000), so
          // the noun may be followed by the value that names one: "port 3000", "process 1234".
          const noun = (core(at) as Call).head;
          if (!named_.has(noun)) {
            named_.add(noun);
            forms.push(c("Fact", c(noun), c("Category", c("Thing"), c("Takes", ["side", c("Right")], ["category", c("Thing")], ["role", c("Name")])), ["from", from]));
          }
        }
        result.placed += placed;
        claims.push(c("Describes", c(example), bare));
        if (placed) claims.push(c("Describes", c(example), named));
      }
      forms.push(c("Concept", c(example), ...claims, ["from", from]));
      forms.push(c("Reading", ["on", c(example)], ["pattern", c(example)], ["becomes", becomes], ["effects", effects ?? c("UnknownEffects")], ["from", from]));
    }
  }
  progress?.(pages.length, pages.length);
  forms.unshift(c("Pack", ["name", s("tldr")], ["version", s(version)], ["license", s("CC BY 4.0")], ["from", c("Tldr")]));
  result.text = format({ forms: forms as Call[] });
  return result;
}
