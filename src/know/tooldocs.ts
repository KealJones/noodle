// Learning a tool from its documentation (design sections 6 and 25): a documented command's name
// gives its word a sense. A tool's own page refers to its subcommands' pages (git(1) lists
// git-push(1)); each subcommand page's NAME gives its summary and its SYNOPSIS the command line.
// The word ("push") gets a sense whose reading becomes Run of that command, at the documentation's
// trust level (3, design section 20): a proposal, offered before it runs, since what a command
// changes is unknown.
//
// What a command does is what its summary says, understood like any request: "Show the working
// tree status", heard as a request to do it, reduces to showing something (Say or Read, which
// only read). That is kept on the command's sense (Describes), and its readings claim to only read
// (effects=Reads()). The claim is the documentation's, so it grants nothing by itself: Run holds
// a command it is told only reads to reading, where it can neither write nor reach the network
// (design section 20). Any other summary, or one not understood, leaves its effects unknown.
//
// Nothing here knows git: the subcommand pages are found from the tool's page, by the man page
// reference convention, for any program.

import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { type Call, type Expr, c, isCall, isHead, isVar, key, positional, role, s, v, withRoles } from "../runtime/expr.js";
import { Chart } from "../runtime/chart.js";
import { hear } from "../runtime/hear.js";
import type { EffectClass, Primitive, World } from "../runtime/primitive.js";
import { PRIMITIVES } from "../runtime/primitives/index.js";
import type { Store } from "../runtime/store.js";
import { Rewriter } from "../runtime/rewrite.js";
import { Weights } from "../runtime/score.js";
import { match } from "../runtime/match.js";
import { format } from "../ncon/index.js";
import { Names, encodeLemma } from "./names.js";
import { categoriesFor } from "./wordnet.js";
import { Learner, type Statement, sentences } from "../runtime/know/learn.js";

export interface ToolResult {
  text: string;
  commands: string[];
  skipped: string[];
  /** What its pages say of the kinds of things they speak of, heard into facts. */
  facts: Statement[];
}

/** What a command's summary says it does, understood, and the effects that follows. */
export interface Understood {
  /** The act the summary reduces to, heard as a request to do it. */
  what: Expr;
  /** Reads, where everything it does is showing something; otherwise undefined (unknown). */
  effects?: EffectClass[];
  /** The act as heard, before it is read: what a request saying the same would be heard as. */
  heard?: Expr;
}

/**
 * Understands a command's summary over a store of words that has no tool's readings in it (a
 * command must not be understood through itself, nor through another tool's word for it). A
 * summary says what the command does, as a verb phrase ("Show the working tree status"), so it is
 * heard as one act spanning it all, or failing that its head before the first comma (what follows
 * is a qualification: "Show changes between commits, commit and working tree, etc"), and read as a
 * request to do it. The best reading, by the chart's score and then rewriting's, is its meaning; a
 * command whose every act there is one that only reads or says (Read, Say) only shows something.
 */
export function summaryReader(words: Store): (summary: string) => Promise<Understood | undefined> {
  const weights = new Weights(words);
  const rewriter = new Rewriter(words, weights.get);
  const world: World = { root: tmpdir(), store: words, now: () => new Date(), say() {}, ask() {} };
  const heard = (text: string): { lf: Expr; act: Expr } | undefined => {
    const h = hear(words, text, { names: [] });
    if (!h.tokens.length) return undefined;
    const chart = new Chart(words, h, 0, h.tokens.length, weights.get).build();
    const acts = chart
      .edges()
      .filter((e) => e.category === "Act" && !e.wraps && !e.heads && !e.gap && e.pending.every((p) => p.takes.optional) && isCall(e.expr))
      .sort((a, b2) => b2.score - a.score);
    // Of the readings the chart scores alike (the same words, as one frame's roles or another's:
    // "find" as getting a thing or as coming to know it), the one whose meaning reads best.
    const tied = acts.filter((e) => e.score === acts[0]?.score);
    let best: { lf: Expr; act: Expr; score: number } | undefined;
    for (const e of tied) {
      const d = rewriter.normalize(c("Directive", withRoles(e.expr as Call, { agent: c("Addressee") })))[0];
      if (d && (!best || d.score > best.score)) best = { lf: d.expr, act: e.expr, score: d.score };
    }
    return best && { lf: best.lf, act: best.act };
  };
  return async (summary) => {
    // A summary written as a sentence ends in a full stop, which says nothing of what is done.
    const said = summary.trim().replace(/\.$/, "");
    const h = heard(said) ?? (said.includes(",") ? heard(said.split(",")[0]) : undefined);
    const lf = h?.lf;
    if (!isHead(lf, "Directive")) return undefined;
    const what = positional(lf)[0];
    const acts = isHead(what, "And") || isHead(what, "Sequence") ? positional(what) : [what];
    const shows = acts.every((a) => {
      const p = isCall(a) ? PRIMITIVES.get(a.head) : undefined;
      return !!p && p.effects(positional(a as Call), world).every((e) => e === "Reads" || e === "Speaks");
    });
    return { what, effects: shows ? ["Reads"] : undefined, heard: h!.act };
  };
}

/** A page's DESCRIPTION section. */
const descriptionOf = (doc: Expr): Call | undefined =>
  isCall(doc) ? (doc.args.map((a) => a.value).find((x) => isHead(x, "Section") && positional(x as Call)[0]?.kind === "string" && /^DESCRIPTION$/.test((positional(x as Call)[0] as { value: string }).value)) as Call | undefined) : undefined;

/**
 * Words in a sentence of a manual beyond which it is not heard for facts: the chart's work grows
 * with a sentence's length, and a sentence that long is rarely heard whole.
 */
const MAX_WORDS = 40;

const blockText = (store: Store, b: Expr | undefined) => {
  const id = isCall(b) && b.head === "Block" ? positional(b)[0] : undefined;
  return id?.kind === "string" ? (store.block(id.value)?.body ?? "") : "";
};

/** Every item term in a page that is a reference to another page, "name(section)". */
function references(store: Store, page: Expr): { name: string; section: number }[] {
  const out: { name: string; section: number }[] = [];
  const visit = (e: Expr) => {
    if (!isCall(e)) return;
    if (e.head === "Item") {
      const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\((\d)\)$/.exec(blockText(store, role(e, "term")).trim());
      if (m) out.push({ name: m[1], section: Number(m[2]) });
    }
    for (const a of e.args) visit(a.value);
  };
  visit(page);
  return out;
}

/** The items of a page, in order (a term and what it says). */
function items(page: Expr): Call[] {
  const out: Call[] = [];
  const visit = (e: Expr) => {
    if (!isCall(e)) return;
    if (e.head === "Item") out.push(e);
    else for (const a of e.args) visit(a.value);
  };
  visit(page);
  return out;
}

/**
 * A tool's own terms (design section 25: learning a tool is understanding its documentation). The
 * pages the tool's page refers to that are named for the tool and are in the manual's section of
 * overviews and conventions (7: gitglossary(7), gitrevisions(7)) define the tool's terms as
 * items. A term that is one word, and that the other packs have no noun for, is a noun of the
 * tool's ("commit": "As a noun: A single point in the Git history"), its first paragraph kept on
 * its sense, so the tool's summaries and requests about it can be heard with it.
 */
async function learnTerms(program: string, refs: { name: string; section: number }[], read: Primitive, world: World, words: Store, names: Names): Promise<Expr[]> {
  const out: Expr[] = [];
  const done = new Set<string>();
  // A word the other packs have as a noun needs nothing; one they have as a property ("dirty",
  // "unchanged") is defined as that. A word they have only as an act ("commit", "merge"), or not
  // at all ("pathspec"), is also the tool's name for a thing.
  const isNoun = (concept: string) => words.facts(concept, "Category").some((f) => ["Noun", "Property", "Manner"].some((k) => isHead(positional(f.claim as Call)[0], k)));
  for (const ref of refs) {
    if (ref.section !== 7 || !ref.name.startsWith(program) || ref.name.startsWith(`${program}-`)) continue;
    let doc: Expr;
    try {
      doc = await read.run([c("ManPage", s(ref.name), { kind: "number", value: ref.section, pos: { line: 0, column: 0 } })], world);
    } catch {
      continue;
    }
    const pageFrom = c("ToolDoc", s(ref.name));
    for (const item of items(doc)) {
      const term = blockText(world.store, role(item, "term")).trim();
      if (!/^\p{Ll}+$/u.test(term) || done.has(term)) continue;
      done.add(term);
      const hits = words.lookup(term).filter((h) => h.text === term && !h.features.length);
      if (hits.some((h) => isNoun(h.concept) || words.facts(h.concept).some((f) => isSeedPart(f.meta.from, "function-words")))) continue;
      const word = hits[0]?.concept ?? names.word(term);
      const definition = positional(item).map((p) => (isHead(p, "Paragraph") ? blockText(world.store, positional(p)[0]) : "")).find(Boolean);
      const sense = `${word}#${encodeLemma(program) ?? "Tool"}Term`;
      const senseClaims: Expr[] = [c("SenseOf", c(word)), c("PartOfSpeech", c("PartOfSpeechNoun"))];
      if (definition) {
        const id = "b_" + createHash("sha256").update(definition).digest("hex").slice(0, 16);
        out.push(c("Block", ["id", s(id)], ["media", s("text/plain")], ["body", s(definition)], ["from", pageFrom]));
        senseClaims.push(c("Said", c("Block", s(id))));
      }
      out.push(c("Concept", c(sense), ...senseClaims, ["from", pageFrom]));
      out.push(c("Concept", c(word), ...(hits.length ? [] : [c("Lemma", s(term))]), c("PartOfSpeech", c("PartOfSpeechNoun")), c("Sense", c(sense)), ["from", pageFrom]));
      // The noun's chart entries, by the seed's mapping of a part of speech (as WordNet's are).
      for (const cat of categoriesFor(words, "PartOfSpeechNoun")) out.push(c("Fact", c(word), cat, ["from", c("Derived", pageFrom, c("Seed", s("lexical-rules")))]));
    }
  }
  return out;
}

/** An option of a command, from its page's items: "-a, --approve", "-b, --body <string>". */
interface OptionDoc {
  flag: string;
  /** Its other names ("--message" beside "-m <msg>"). */
  aliases: string[];
  /** The placeholder of the value it takes, if it takes one. */
  value?: string;
  /** Whether the value may be left out ("-i [i]"): the flag alone is a command line too. */
  optional?: boolean;
  text: string;
}

const firstParagraph = (store: Store, item: Call) => positional(item).map((p) => (isHead(p, "Paragraph") ? blockText(store, positional(p)[0]) : "")).find(Boolean);

/** The options a page documents: its items whose term is a flag. */
function optionsOf(store: Store, page: Expr): OptionDoc[] {
  const out: OptionDoc[] = [];
  const seen = new Set<string>();
  for (const it of items(page)) {
    const term = blockText(store, role(it, "term")).trim();
    const text = firstParagraph(store, it);
    if (!term.startsWith("-") || !text) continue;
    const flags: string[] = [];
    const aliases: string[] = [];
    let value: string | undefined;
    let optional = false;
    for (const tok of term.split(/[\s,]+/).filter(Boolean)) {
      if (tok.startsWith("-") && !value) {
        const [f, val] = tok.split("=");
        flags.push(f.replace(/\[|\]/g, ""));
        if (val) value = val.replace(/[<>[\]]/g, "");
      } else if (tok.startsWith("-")) aliases.push(tok.split("=")[0].replace(/\[|\]/g, ""));
      else if (!value) {
        value = tok.replace(/[<>[\]]/g, "");
        optional = tok.startsWith("[");
      }
    }
    // The long form is the one a command line can be read by.
    const flag = flags.sort((a, b2) => b2.length - a.length)[0];
    if (!flag || !/^--?[A-Za-z0-9][\w-]*$/.test(flag) || seen.has(flag)) continue;
    seen.add(flag);
    out.push({ flag, aliases: [...flags.filter((f) => f !== flag), ...aliases].filter((f) => /^--?[A-Za-z0-9][\w-]*$/.test(f)), value: value || undefined, optional, text });
  }
  return out;
}

/** The subcommands a page of help lists: its items whose term is a word (the longest of its names). */
function commandItems(store: Store, page: Expr): string[] {
  const out: string[] = [];
  for (const it of items(page)) {
    const names = blockText(store, role(it, "term"))
      .trim()
      .split(/,\s*/)
      .filter((w) => /^[a-z][a-z0-9-]*$/.test(w));
    const name = names.sort((a, b2) => b2.length - a.length)[0];
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** The placeholders a usage line takes as the command's own arguments (not an option's value). */
function placeholders(u: Call | undefined): string[] {
  const out: string[] = [];
  const visit = (e: Expr, inOption: boolean) => {
    if (!isCall(e)) return;
    if (e.head === "Placeholder" && !inOption) {
      const t = positional(e)[0];
      if (t?.kind === "string") out.push(t.value);
    }
    for (const a of e.args) visit(a.value, inOption || e.head === "Option");
  };
  if (u) for (const x of positional(u)) visit(x, false);
  return out;
}

/** What a phrase is at its core: a referent's kind, and inside anything that only wraps one thing ("a", "the"). */
function core(e: Expr): Expr {
  if (isHead(e, "Ref") && role(e, "kind")) return core(role(e, "kind")!);
  if (isCall(e) && e.args.length === 1 && e.args[0].name === undefined && isCall(e.args[0].value)) return core(e.args[0].value);
  return e;
}

const OBJECT = "$object";
/** What an act says, in words (core.ncon): what an option that takes what is said takes. */
const MESSAGE = "Message";


/** A heard phrase with the thing a group's commands are done to taken out of it. */
function withoutObject(e: Expr, kind: Expr, exactly = false): Expr | undefined {
  if (isCall(e) && (exactly ? key(core(e)) === key(kind) : match(kind, core(e)))) return v(OBJECT);
  if (!isCall(e)) return undefined;
  for (let i = 0; i < e.args.length; i++) {
    const inner = withoutObject(e.args[i].value, kind, exactly);
    if (inner) {
      const args = e.args.slice();
      args[i] = { ...args[i], value: inner };
      return { ...e, args };
    }
  }
  return undefined;
}

const putObject = (e: Expr, object: Expr): Expr => (isCall(e) ? { ...e, args: e.args.map((a) => ({ ...a, value: isVarNamed(a.value, OBJECT) ? object : putObject(a.value, object) })) } : e);
const isVarNamed = (e: Expr, name: string) => isVar(e) && e.text === name;

/** The part of a heard act a reading's pattern may name: who does it is the addressee's, not the command's. */
const withoutAgent = (e: Expr): Expr => (isCall(e) ? { ...e, args: e.args.filter((a) => a.name !== "agent") } : e);

interface Group {
  noun: string;
  /** What the group's commands' summaries say they are done to ("a pull request"), at its core. */
  kind?: Expr;
}

/** Sentences of a manual's description heard when it is learned in bulk. */
const BULK_SENTENCES = 6;

export async function learnTool(
  program: string,
  read: Primitive,
  world: World,
  store: Store,
  /** The words other packs give (and no tool's readings), to understand the pages with. */
  words?: Store,
  /** Where to learn it from: its manual pages, its help (run held to reading), or either, manual first. */
  how: "manual" | "help" | "any" = "any",
  /**
   * Learned in bulk, with every other program on the machine, not because it was asked for: its
   * name is a word for it only where English has no other word with that name, and what its
   * pages say it does is a description for the scored match, not a reading of ordinary words.
   */
  bulk = false,
): Promise<ToolResult> {
  // A program's manual page, or where it has none, its own help: the same structure either way.
  let manual = how !== "help";
  let page: Expr;
  try {
    if (!manual) throw new Error("help");
    page = await read.run([c("ManPage", s(program))], world);
  } catch (e) {
    if (how === "manual") throw e;
    manual = false;
    page = await read.run([c("Help", s(program))], world);
  }
  const readDoc = (path: string[], ref?: { name: string; section?: number }) =>
    manual
      ? read.run([c("ManPage", s(ref?.name ?? path.join("-")), ...(ref?.section !== undefined ? [{ kind: "number", value: ref.section, pos: { line: 0, column: 0 } } as Expr] : []))], world)
      : read.run([c("Help", ...path.map((w) => s(w)))], world);
  // The pages a page lists as its subcommands': by the manual's reference convention (git(1) lists
  // git-push(1)), or the help's items that are words.
  const subsOf = (doc: Expr, path: string[], name: string): { name: string; section?: number; path: string[] }[] =>
    manual
      ? references(world.store, doc)
          .filter((r) => r.name.startsWith(`${name}-`))
          .map((r) => ({ ...r, path: [...path, r.name.slice(name.length + 1)] }))
      : commandItems(world.store, doc).map((w) => ({ name: `${name}-${w}`, path: [...path, w] }));
  const names = new Names(store);
  const from = c("ToolDoc", s(program));
  const forms: Expr[] = [c("Pack", ["name", s(`tool-${program}`)], ["version", s("local")], ["from", from])];
  const optionTexts = new Set<string>();
  const commands: string[] = [];
  const skipped: string[] = [];
  // The tool's own terms first, so its summaries are heard with them ("Show commit logs").
  if (words) {
    const terms = manual ? await learnTerms(program, references(world.store, page), read, world, words, names) : [];
    forms.push(...terms);
    words.load(format({ forms: [c("Pack", ["name", s(`tool-${program}-terms`)], ["version", s("local")], ["from", from]), ...terms] as Call[] }));
  }
  const understand = words ? summaryReader(words) : undefined;
  const learner = words ? new Learner(words) : undefined;
  const facts: Statement[] = [];
  const lex = words ?? store;
  // The tool's own name is a word for the tool: "git push" is push, done with git. A program
  // learned in bulk whose name English already has as a word ("yes", "date", "file") is not that
  // word: it is a concept of its own, named as a program ("the date command") or as code (`date`).
  const english = (w: string) =>
    bulk ? lex.lookup(w).find((h) => h.text === w && lex.facts(h.concept).some((f) => !isHead(f.meta.from, "ToolDoc") && !isHead(f.meta.from, "Tldr")))?.concept : undefined;
  const sameWord = english(program);
  const toolWord = sameWord ? names.other(`program:${program}`, `${encodeLemma(program) ?? "Tool"}Program`) : names.word(program);
  if (sameWord || !store.lookup(program).some((h) => store.facts(h.concept).some((f) => isSeedPart(f.meta.from, "function-words")))) {
    const toolFrom = c("ToolDoc", s(program), s("NAME"));
    // A tool (the core's kind of what is learned to use), called by its name.
    const claims: Expr[] = [c("IsA", c("Tool")), c("Name", s(program))];
    if (sameWord) {
      const command = lex.lookup("command").find((h) => lex.facts(h.concept, "IsA").some((f) => isHead(positional(f.claim as Call)[0], "Program")))?.concept;
      // Named as a program it is a noun ("the date command"), as well as a thing (below).
      if (command) claims.push(c("Words", c(sameWord), c(command)), c("Category", c("Noun")));
      // And it is one more sense of the word, its newest, a noun: which sense "tar" means is the
      // score's, by how likely the sense is and how the rest of what was said fits it.
      claims.push(c("PartOfSpeech", c("PartOfSpeechNoun")));
      forms.push(c("Concept", c(sameWord), c("Sense", c(toolWord)), ["from", toolFrom]));
    } else if (!store.facts(toolWord, "Lemma").length) claims.unshift(c("Lemma", s(program)));
    if (!store.facts(toolWord, "Category").length)
      claims.push(c("Category", c("Thing")), c("Category", c("Manner"), c("Modifies", ["side", c("Right")], ["category", c("Act")], ["role", c("Instrument")])));
    forms.push(c("Concept", c(toolWord), ...claims, ["from", toolFrom]));
  }
  // What the tool's page calls its commands: the heading of the section that names the tool and
  // one other word ("GIT COMMANDS"). A rule or a request about the tool's commands ("don't run git
  // commands") is about running the tool, with any arguments.
  if (isCall(page))
    for (const sec of page.args.map((a) => a.value).filter((x) => isHead(x, "Section"))) {
      const title = positional(sec as Call)[0];
      const ws = title?.kind === "string" ? title.value.toLowerCase().split(/\s+/) : [];
      if (ws.length !== 2 || ws[0] !== program) continue;
      const kind = lex.lookup(ws[1]).find((h) => h.features.includes("Plural"))?.concept ?? lex.lookup(ws[1])[0]?.concept;
      if (!kind) continue;
      const tFrom = c("ToolDoc", s(program), s(title!.kind === "string" ? title.value : ""));
      for (const r of ["modifier", "instrument"])
        forms.push(c("Reading", ["on", c(kind)], ["pattern", c(kind, [r, c(toolWord)])], ["becomes", c("Run", s(program), v("args"))], ["from", tFrom]));
      break;
    }
  const protectedWord = (lemma: string) => store.lookup(lemma).some((h) => store.facts(h.concept).some((f) => isSeedPart(f.meta.from, "function-words")));
  const act = (lemma: string) => {
    const word = names.word(lemma);
    const claims: Expr[] = [];
    if (!(bulk ? lex : store).facts(word, "Lemma").length) claims.push(c("Lemma", s(lemma)));
    // A command is something done: its word is an act that may take what it is done to.
    if (!(bulk ? lex : store).facts(word, "Category").length)
      claims.push(c("Category", c("Act"), c("Takes", ["side", c("Right")], ["category", c("Thing")], ["role", c("Theme")], ["optional", { kind: "boolean", value: true, pos: { line: 0, column: 0 } }])));
    return { word, claims };
  };
  const effectsOf = (e: EffectClass[] | undefined): Expr => (e ? (e.length === 1 ? c(e[0]) : c("All", ...e.map((x) => c(x)))) : c("UnknownEffects"));
  // What a command does, by its summary or, where the summary does not say it only shows something,
  // the first sentence its page's description gives of it (the same act, said at more length).
  const understood = async (doc: Expr): Promise<{ summary: string; u?: Understood }> => {
    const summary = blockText(world.store, role(doc, "summary"));
    const u = summary ? await understand?.(summary) : undefined;
    if (u?.effects) return { summary, u };
    const desc = descriptionOf(doc);
    const para = isCall(desc) ? positional(desc).find((p) => isHead(p, "Paragraph")) : undefined;
    const first = para ? blockText(world.store, positional(para as Call)[0]).split(/(?<=\.)\s/)[0] : "";
    const d = first && first !== summary ? await understand?.(first) : undefined;
    return { summary, u: d?.effects ? { ...d, heard: u?.heard ?? d.heard } : u };
  };
  // The sense, and the effects its readings claim: what its summary, understood, says it does.
  const senseOf = (word: string, path: string[], summary: string, u: Understood | undefined, pageFrom: Expr, usage: Call | undefined): { sense: string; effects: Expr } => {
    // One sense per command: "view" in "gh pr view" and in "gh repo view" are two commands.
    const sense = `${word}#${encodeLemma(path.slice(0, -1).join(" ") || program) ?? "Tool"}Command`;
    // A command is something done: its sense is a verb sense (what the chart weighs its act entry by).
    // It is one of the tool's commands, called by its command line's words.
    const senseClaims: Expr[] = [c("SenseOf", c(word)), c("IsA", c("Command")), c("PartOf", c(toolWord)), c("Name", s(path.join(" "))), c("PartOfSpeech", c("PartOfSpeechVerb"))];
    if (summary) {
      const id = "b_" + createHash("sha256").update(summary).digest("hex").slice(0, 16);
      forms.push(c("Block", ["id", s(id)], ["media", s("text/plain")], ["body", s(summary)], ["from", pageFrom]));
      senseClaims.push(c("Said", c("Block", s(id))));
      if (u) senseClaims.push(c("Describes", c(sense), u.what));
    }
    if (usage) senseClaims.push(c("Usage", c(sense), usage));
    forms.push(c("Concept", c(sense), ...senseClaims, ["from", pageFrom]));
    return { sense, effects: effectsOf(u?.effects) };
  };
  const run = (path: string[], ...extra: Expr[]) => c("Run", s(program), c("Args", ...path.slice(1).map((w) => s(w)), ...extra));
  // Each reading also comes in forms that name the tool, done with it or said of it ("git status":
  // status, with git; "the git log": the log, of git), so the tool's name picks its own command
  // where two tools share a word.
  // Learned in bulk, a reading of ordinary words ("create a file") is only in the forms that name
  // the tool: said without it, what the page describes is the scored match's to find.
  const reading = (word: string, pattern: Expr, becomes: Expr, from: Expr, effects: Expr) => {
    if (!bulk || word === toolWord) forms.push(c("Reading", ["on", c(word)], ["pattern", pattern], ["becomes", becomes], ["effects", effects], ["from", from]));
    if (isCall(pattern) && word !== toolWord)
      for (const r of ["instrument", "modifier"])
        forms.push(c("Reading", ["on", c(word)], ["pattern", { ...pattern, args: [...pattern.args, { name: r, value: c(toolWord) }] }], ["becomes", becomes], ["effects", effects], ["from", from]));
  };
  // A placeholder's kind: the noun its word is ("number", "url"; "jq filter" is a filter).
  const kindOf = (placeholder: string): string | undefined => {
    const w = placeholder.toLowerCase().split(/[^a-z]+/).filter(Boolean).pop();
    const hits = w ? lex.lookup(w).filter((h) => h.text === w) : [];
    return hits.find((h) => lex.facts(h.concept, "Category").some((f) => isHead(positional(f.claim as Call)[0], "Noun")))?.concept ?? hits[0]?.concept;
  };
  // The things a group's command is done to: its noun and what its summaries call it, as a
  // referent, a bare noun, some or every; and where its command line takes an argument that names
  // one ("pr 1748"), the noun with that argument, of the placeholder's kind.
  const objectsOf = (g: Group, usage: Call | undefined): { pattern: Expr; x: boolean }[] => {
    const out: { pattern: Expr; x: boolean }[] = [];
    for (const h of [c(g.noun), ...(g.kind ? [g.kind] : [])]) for (const f of [c("Ref", ["kind", h]), h, c("Some", h), c("Every", h)]) out.push({ pattern: f, x: false });
    for (const p of placeholders(usage)) {
      const k = kindOf(p);
      if (!k) continue;
      const h = c(g.noun, [lowerFirst(k), v("x")]);
      out.push({ pattern: h, x: true }, { pattern: c("Ref", ["kind", h]), x: true });
    }
    return out;
  };

  const learnCommand = async (path: string[], doc: Expr, group: Group | undefined, heard: { summary: string; u?: Understood }) => {
    const pageFrom = c("ToolDoc", s(path.join("-")), s("NAME"));
    const lemma = path[path.length - 1];
    const own = path.length === 1;
    const { word, claims } = own ? { word: toolWord, claims: [] as Expr[] } : act(lemma);
    const usage = firstUsage(doc);
    const { sense, effects } = senseOf(word, path, heard.summary, heard.u, pageFrom, usage);
    forms.push(c("Concept", c(word), c("Sense", c(sense)), ...claims, ["from", pageFrom]));
    const objects = group ? objectsOf(group, usage) : [];
    // Told to do it, it runs the command. The pattern names no agent: in "commit and push" the
    // addressee is on the conjunction, not on each act. Its effects are what its summary claims:
    // a command that only shows is held to reading; any other is unknown, guarded, and offered
    // first (design sections 13 and 20).
    if (group) for (const o of objects) reading(word, c(word, ["theme", o.pattern]), run(path, ...(o.x ? [v("x")] : [])), pageFrom, effects);
    else {
      // A command line that needs an argument (a placeholder its synopsis does not make optional)
      // is not run without one: told to do it with nothing named, its slot is left open (a Gap),
      // and the act is stuck on it and asks for it. A page with no synopsis read says nothing of
      // how it is run, so it gives no reading that runs it bare.
      const needed = usage ? requiredPlaceholder(usage) : undefined;
      if (usage) reading(word, c(word), needed ? run(path, c("Gap", s(needed))) : run(path), pageFrom, effects);
      // A command line that takes a positional argument (a placeholder in its synopsis, not an
      // option's value) takes what the act is done to: "add a.txt" runs git add a.txt; a program
      // of its own that needs one, too ("kill 1234").
      if (usage && takesPlaceholder(usage) && (!own || needed)) reading(word, c(word, ["theme", v("x")]), run(path, v("x")), pageFrom, effects);
    }
    // Said the way its summary says it ("add a comment to the pr"): the summary as heard, with what
    // the group's commands are done to taken out and put back as any of its forms.
    const phrased = (heardAct: Expr | undefined, becomes: (x: boolean) => Expr, from: Expr, eff: Expr) => {
      if (!isCall(heardAct) || (heardAct.head === word && !group)) return;
      const bare = withoutAgent(heardAct) as Call;
      if (group?.kind) {
        const holed = withoutObject(bare, group.kind);
        if (holed) {
          for (const o of objects) reading(bare.head, putObject(holed, o.pattern), becomes(o.x), from, eff);
          return;
        }
      }
      if (bare.args.length && bare.head !== word) reading(bare.head, bare, becomes(false), from, eff);
    };
    phrased(heard.u?.heard, (x) => run(path, ...(x ? [v("x")] : [])), pageFrom, effects);
    // A group's command that only shows the thing itself ("View a pull request": what it is done
    // to is its object, not part of it, and nothing more is said of it than the group's kind; not
    // "a pull request in git") is what showing one is: "show me pr 1748".
    if (!bulk && group?.kind && isHead(effects, "Reads") && isCall(heard.u?.heard)) {
      const holed = withoutObject(withoutAgent(heard.u.heard), group.kind, true);
      if (isCall(holed) && holed.args.some((a) => isVarNamed(a.value, OBJECT)))
        // Shown is read or said to the user (the bridge has both, chosen by the score).
        for (const o of objects)
          for (const shown of ["Read", "Say"])
            forms.push(c("Reading", ["on", c(group.noun)], ["pattern", c(shown, o.pattern)], ["becomes", run(path, ...(o.x ? [v("x")] : []))], ["effects", effects], ["from", pageFrom]));
    }
    // Each option is understood as its description says it: the act it names, done to what the
    // command is done to, adds the flag ("Approve pull request": approve the pr runs it with
    // --approve). What it changes is unknown unless the command and the option both only show.
    for (const o of optionsOf(world.store, doc)) {
      // Each option is one of the command's, called by its flag, with what its page says of it.
      const optionFrom = c("ToolDoc", s(path.join("-")), s(o.flag));
      const id = "b_" + createHash("sha256").update(o.text).digest("hex").slice(0, 16);
      if (!optionTexts.has(id)) forms.push(c("Block", ["id", s(id)], ["media", s("text/plain")], ["body", s(o.text)], ["from", optionFrom]));
      optionTexts.add(id);
      const option = names.other(`option:${path.join(" ")} ${o.flag}`, `${encodeLemma(o.flag) ?? "Flag"}Option`);
      forms.push(c("Concept", c(option), c("IsA", c("Option")), c("PartOf", c(sense)), c("Name", s(o.flag)), ...o.aliases.map((a) => c("Name", s(a))), c("Said", c("Block", s(id))), ["from", optionFrom]));
      if (o.value && !o.optional) {
        // An option whose value is text, by the words its page names the value with (its
        // placeholder, its flag: "--body <text>", "-m <msg>, --message=<msg>"), takes what the act
        // says (the message role, seed/function-words.ncon 11c): "comment on pr 1748 saying looks
        // good" runs it with the words said as its value.
        // A flag names its value only when it is one word ("--message"; "--reuse-message" reuses a commit's).
        const kinds = [o.value, ...[o.flag, ...o.aliases].filter((f) => !f.replace(/^-+/, "").includes("-"))].map(kindOf).filter((k): k is string => !!k);
        if (!kinds.some((k) => k === MESSAGE || (lex.kindDistance(k, MESSAGE) ?? Infinity) <= 1)) continue;
        const said = v("said");
        const optFrom = c("ToolDoc", s(path.join("-")), s(o.flag));
        if (group) for (const ob of objects) reading(word, c(word, ["theme", ob.pattern], ["message", said]), run(path, ...(ob.x ? [v("x")] : []), s(o.flag), said), optFrom, effects);
        else {
          reading(word, c(word, ["message", said]), run(path, s(o.flag), said), optFrom, effects);
          if (usage && takesPlaceholder(usage) && !own) reading(word, c(word, ["theme", v("x")], ["message", said]), run(path, v("x"), s(o.flag), said), optFrom, effects);
        }
        continue;
      }
      // What it does is its first sentence; what follows qualifies it.
      const ou = await understand?.(o.text.split(/(?<=\.)\s/)[0]);
      if (!ou?.heard) continue;
      const optFrom = c("ToolDoc", s(path.join("-")), s(o.flag));
      const eff = isHead(effects, "Reads") && ou.effects ? effects : c("UnknownEffects");
      phrased(ou.heard, (x) => run(path, ...(x ? [v("x")] : []), s(o.flag)), optFrom, eff);
      // What the option does, as its page says it, is a description of the command run with it,
      // for the scored match ("selects the listing of files any of whose Internet address
      // matches"), as the command's own summary is. A command line that needs an argument is
      // stuck on it until it is said.
      if (!group && usage) {
        const needed = requiredPlaceholder(usage);
        forms.push(c("Concept", c(option), c("Describes", c(option), ou.what), ["from", optFrom]));
        forms.push(c("Reading", ["on", c(option)], ["pattern", c(option)], ["becomes", run(path, s(o.flag), ...(needed ? [c("Gap", s(needed))] : []))], ["effects", eff], ["from", optFrom]));
      }
    }
    // What the page says of the things it is about, beyond what the command does: its
    // description's sentences, and each option's beyond its first, heard as a page's opening is
    // (Know's own pipeline) into facts on the kinds they speak of ("an open file may be ... a
    // network file": a network file is a kind of open file), from the page. A fact from a sentence
    // only part of which was heard is kept Pending.
    if (learner) {
      const desc = descriptionOf(doc);
      const texts: { text: string; from: Expr }[] = [];
      if (desc) for (const p of positional(desc).filter((x) => isHead(x, "Paragraph"))) texts.push({ text: blockText(world.store, positional(p as Call)[0]), from: c("ToolDoc", s(path.join("-")), s("DESCRIPTION")) });
      // Learned in bulk, only the opening of the description is heard (where a page says what its
      // things are, when it does): each sentence costs about half a second, and hearing every
      // sentence of every manual on the machine takes a day for a handful of facts.
      if (bulk) {
        const opening = sentences(texts.map((t) => t.text).join(" ")).slice(0, BULK_SENTENCES).join(" ");
        texts.splice(0, texts.length, ...(opening ? [{ text: opening, from: c("ToolDoc", s(path.join("-")), s("DESCRIPTION")) }] : []));
      } else
        for (const o of optionsOf(world.store, doc)) {
          const rest = sentences(o.text).slice(1).join(" ");
          if (rest) texts.push({ text: rest, from: c("ToolDoc", s(path.join("-")), s(o.flag)) });
        }
      const kept = new Set<string>();
      for (const { text, from: f } of texts)
        for (const st of learner.statements(text, MAX_WORDS)) {
          const k = `${st.subject} ${key(st.claim)}`;
          if (kept.has(k)) continue;
          kept.add(k);
          forms.push(c("Fact", c(st.subject), st.claim, ["from", f], ...(st.partial ? ([["status", c("Pending")]] as [string, Expr][]) : [])));
          facts.push(st);
        }
    }
    commands.push(path.slice(1).join(" ") || program);
  };

  const subs = subsOf(page, [program], program);
  // A program with no subcommands is itself the command ("jq", "pwd"), and what its page says it
  // does is what it does ("what does jq do").
  if (!subs.length) await learnCommand([program], page, undefined, await understood(page));
  for (const sub of subs) {
    let doc: Expr;
    try {
      doc = await readDoc(sub.path, sub);
    } catch {
      skipped.push(sub.name);
      continue;
    }
    const usage = firstUsage(doc);
    const ws = usage ? leadingWords(usage) : [];
    const lemma = sub.path[1];
    // The command line's words after the program are the subcommand; it must be the page's own.
    // The function-word lexicon is protected (design section 20): a word or form it has ("am" is
    // a form of "be") never gets a learned reading.
    if (ws[0] !== program || ws[1] !== lemma || protectedWord(lemma)) {
      skipped.push(sub.name);
      continue;
    }
    // A group of commands ("gh pr" lists gh-pr-view(1), gh-pr-create(1)...) names a kind of thing
    // its commands are done to: "view the pr" is gh pr view.
    const leaves = subsOf(doc, [program, lemma], sub.name);
    if (!leaves.length) {
      await learnCommand([program, lemma], doc, undefined, await understood(doc));
      continue;
    }
    const pageFrom = c("ToolDoc", s(sub.name), s("NAME"));
    const noun = names.word(lemma);
    const nounClaims: Expr[] = [];
    if (!store.facts(noun, "Lemma").length) nounClaims.push(c("Lemma", s(lemma)));
    if (!store.facts(noun, "Category").length) nounClaims.push(c("Category", c("Noun")));
    const docs: { path: string[]; doc: Expr; heard: { summary: string; u?: Understood } }[] = [];
    for (const leaf of leaves) {
      let leafDoc: Expr;
      try {
        leafDoc = await readDoc(leaf.path, leaf);
      } catch {
        skipped.push(leaf.name);
        continue;
      }
      const verb = leaf.path[2];
      const leafUsage = firstUsage(leafDoc);
      const leafWords = leafUsage ? leadingWords(leafUsage) : [];
      if (leafWords.join(" ") !== [program, lemma, verb].join(" ") || protectedWord(verb) || verb.includes("-")) {
        skipped.push(leaf.name);
        continue;
      }
      docs.push({ path: leafWords, doc: leafDoc, heard: await understood(leafDoc) });
    }
    // What the group's commands are done to, as their summaries say it: the phrase most of them
    // name ("a pull request" in "View a pull request", "Merge a pull request").
    // What the group's commands are done to, as their summaries say it: the phrase most of them
    // name ("a pull request" in "View a pull request", "List pull requests in a repository"), a
    // phrase counting wherever it is named with more said of it ("relevant pull requests").
    const phrases = docs.map((d) => {
      const out: Expr[] = [];
      const visit = (e: Expr, top: boolean) => {
        if (!isCall(e)) return;
        if (!top) out.push(core(e));
        for (const a of e.args) if (a.name !== "agent") visit(a.value, false);
      };
      if (d.heard.u?.heard) visit(d.heard.u.heard, true);
      return out;
    });
    const candidates = new Map<string, Expr>();
    for (const ps of phrases) for (const p of ps) if (isCall(p)) candidates.set(key(p), p);
    const named = (k: Expr) => phrases.filter((ps) => ps.some((p) => match(k, p))).length;
    const best = [...candidates.values()].map((e) => ({ e, n: named(e) })).sort((a, b2) => b2.n - a.n || key(b2.e).length - key(a.e).length)[0];
    const group: Group = { noun, kind: best && best.n >= 2 && best.n * 2 >= docs.length ? best.e : undefined };
    // An argument that names one of them, said after the noun ("pr 1748"), of its placeholder's kind.
    const roles = new Set<string>();
    for (const d of docs) for (const p of placeholders(firstUsage(d.doc))) {
      const k = kindOf(p);
      if (k) roles.add(k);
    }
    for (const k of roles) nounClaims.push(c("Category", c("Thing"), c("Takes", ["side", c("Right")], ["category", c("Thing")], ["role", c(k)], ["kind", c(k)])));
    if (nounClaims.length) forms.push(c("Concept", c(noun), ...nounClaims, ["from", pageFrom]));
    for (const d of docs) await learnCommand(d.path, d.doc, group, d.heard);
  }
  // The terms were lent to the words to hear the summaries with; they are kept in the tool's pack.
  if (words) words.unload(`tool-${program}-terms`);
  return { text: format({ forms: forms as Call[] }), commands, skipped, facts };
}

const lowerFirst = (x: string) => x[0].toLowerCase() + x.slice(1);

function isSeedPart(from: Expr, part: string): boolean {
  return isCall(from) && from.head === "Seed" && positional(from)[0]?.kind === "string" && (positional(from)[0] as { value: string }).value === part;
}

/** The first placeholder a usage line needs (not inside an optional part or an option), its name without "...". */
function requiredPlaceholder(u: Call): string | undefined {
  const visit = (e: Expr): string | undefined => {
    if (!isCall(e) || e.head === "Optional" || e.head === "Option") return undefined;
    if (e.head === "Placeholder") {
      const t = positional(e)[0];
      return t?.kind === "string" ? t.value.replace(/\s*\.\.\.$/, "") : undefined;
    }
    for (const a of e.args) {
      const r = visit(a.value);
      if (r) return r;
    }
    return undefined;
  };
  for (const x of positional(u)) {
    const r = visit(x);
    if (r) return r;
  }
  return undefined;
}

function takesPlaceholder(u: Call): boolean {
  const visit = (e: Expr, inOption: boolean): boolean => {
    if (!isCall(e)) return false;
    if (e.head === "Placeholder") return !inOption;
    return e.args.some((a) => visit(a.value, inOption || e.head === "Option"));
  };
  return positional(u).some((x) => visit(x, false));
}

function firstUsage(doc: Expr): Call | undefined {
  let found: Call | undefined;
  const visit = (e: Expr) => {
    if (found || !isCall(e)) return;
    if (e.head === "Usage") found = e;
    else for (const a of e.args) visit(a.value);
  };
  visit(doc);
  return found;
}

/** The plain words a usage line starts with: the program and its subcommand. */
function leadingWords(u: Call): string[] {
  const out: string[] = [];
  for (const x of positional(u)) {
    if (x.kind !== "string") break;
    out.push(x.value);
  }
  return out;
}
