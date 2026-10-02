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
import { type Call, type Expr, c, isCall, isHead, positional, role, s, v, withRoles } from "../runtime/expr.js";
import { Chart } from "../runtime/chart.js";
import { hear } from "../runtime/hear.js";
import type { EffectClass, Primitive, World } from "../runtime/primitive.js";
import { PRIMITIVES } from "../runtime/primitives/index.js";
import type { Store } from "../runtime/store.js";
import { Rewriter } from "../runtime/rewrite.js";
import { Weights } from "../runtime/score.js";
import { format } from "../ncon/index.js";
import { Names, encodeLemma } from "./names.js";
import { categoriesFor } from "./wordnet.js";

export interface ToolResult {
  text: string;
  commands: string[];
  skipped: string[];
}

/** What a command's summary says it does, understood, and the effects that follows. */
export interface Understood {
  /** The act the summary reduces to, heard as a request to do it. */
  what: Expr;
  /** Reads, where everything it does is showing something; otherwise undefined (unknown). */
  effects?: EffectClass[];
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
  const heard = (text: string): Expr | undefined => {
    const h = hear(words, text, { names: [] });
    if (!h.tokens.length) return undefined;
    const chart = new Chart(words, h, 0, h.tokens.length, weights.get).build();
    const best = chart
      .edges()
      .filter((e) => e.category === "Act" && !e.wraps && !e.heads && !e.gap && e.pending.every((p) => p.takes.optional))
      .sort((a, b2) => b2.score - a.score)[0];
    if (!best || !isCall(best.expr)) return undefined;
    return rewriter.normalize(c("Directive", withRoles(best.expr, { agent: c("Addressee") })))[0]?.expr;
  };
  return async (summary) => {
    const lf = heard(summary) ?? (summary.includes(",") ? heard(summary.split(",")[0]) : undefined);
    if (!isHead(lf, "Directive")) return undefined;
    const what = positional(lf)[0];
    const acts = isHead(what, "And") || isHead(what, "Sequence") ? positional(what) : [what];
    const shows = acts.every((a) => {
      const p = isCall(a) ? PRIMITIVES.get(a.head) : undefined;
      return !!p && p.effects(positional(a as Call), world).every((e) => e === "Reads" || e === "Speaks");
    });
    return { what, effects: shows ? ["Reads"] : undefined };
  };
}

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

export async function learnTool(
  program: string,
  read: Primitive,
  world: World,
  store: Store,
  /** The words other packs give (and no tool's readings), to understand the pages with. */
  words?: Store,
): Promise<ToolResult> {
  const page = await read.run([c("ManPage", s(program))], world);
  const subs = references(world.store, page).filter((r) => r.name.startsWith(`${program}-`));
  const names = new Names(store);
  const from = c("ToolDoc", s(program));
  const forms: Expr[] = [c("Pack", ["name", s(`tool-${program}`)], ["version", s("local")], ["from", from])];
  const commands: string[] = [];
  const skipped: string[] = [];
  // The tool's own terms first, so its summaries are heard with them ("Show commit logs").
  if (words) {
    const terms = await learnTerms(program, references(world.store, page), read, world, words, names);
    forms.push(...terms);
    words.load(format({ forms: [c("Pack", ["name", s(`tool-${program}-terms`)], ["version", s("local")], ["from", from]), ...terms] as Call[] }));
  }
  const understand = words ? summaryReader(words) : undefined;
  // The tool's own name is a word for the tool: "git push" is push, done with git.
  const toolWord = names.word(program);
  if (!store.lookup(program).some((h) => store.facts(h.concept).some((f) => isSeedPart(f.meta.from, "function-words")))) {
    const toolFrom = c("ToolDoc", s(program), s("NAME"));
    const claims: Expr[] = [c("IsA", c("Program"))];
    if (!store.facts(toolWord, "Lemma").length) claims.unshift(c("Lemma", s(program)));
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
      const lex = words ?? store;
      const kind = lex.lookup(ws[1]).find((h) => h.features.includes("Plural"))?.concept ?? lex.lookup(ws[1])[0]?.concept;
      if (!kind) continue;
      const tFrom = c("ToolDoc", s(program), s(title!.kind === "string" ? title.value : ""));
      for (const r of ["modifier", "instrument"])
        forms.push(c("Reading", ["on", c(kind)], ["pattern", c(kind, [r, c(toolWord)])], ["becomes", c("Run", s(program), v("args"))], ["from", tFrom]));
      break;
    }
  const protectedWord = (lemma: string) => store.lookup(lemma).some((h) => store.facts(h.concept).some((f) => isSeedPart(f.meta.from, "function-words")));
  const act = (lemma: string, from: Expr) => {
    const word = names.word(lemma);
    const claims: Expr[] = [];
    if (!store.facts(word, "Lemma").length) claims.push(c("Lemma", s(lemma)));
    // A command is something done: its word is an act that may take what it is done to.
    if (!store.facts(word, "Category").length)
      claims.push(c("Category", c("Act"), c("Takes", ["side", c("Right")], ["category", c("Thing")], ["role", c("Theme")], ["optional", { kind: "boolean", value: true, pos: { line: 0, column: 0 } }])));
    return { word, claims };
  };
  // The sense, and the effects its readings claim: what its summary, understood, says it does.
  const senseOf = async (word: string, doc: Expr, pageFrom: Expr, usage: Call | undefined): Promise<{ sense: string; effects: Expr }> => {
    const sense = `${word}#${encodeLemma(program) ?? "Tool"}Command`;
    const summary = blockText(world.store, role(doc, "summary"));
    // A command is something done: its sense is a verb sense (what the chart weighs its act entry by).
    const senseClaims: Expr[] = [c("SenseOf", c(word)), c("IsA", c("Program")), c("PartOfSpeech", c("PartOfSpeechVerb"))];
    let effects: Expr = c("UnknownEffects");
    if (summary) {
      const id = "b_" + createHash("sha256").update(summary).digest("hex").slice(0, 16);
      forms.push(c("Block", ["id", s(id)], ["media", s("text/plain")], ["body", s(summary)], ["from", pageFrom]));
      senseClaims.push(c("Said", c("Block", s(id))));
      const u = await understand?.(summary);
      if (u) senseClaims.push(c("Describes", c(sense), u.what));
      if (u?.effects) effects = u.effects.length === 1 ? c(u.effects[0]) : c("All", ...u.effects.map((e) => c(e)));
    }
    if (usage) senseClaims.push(c("Usage", c(sense), usage));
    forms.push(c("Concept", c(sense), ...senseClaims, ["from", pageFrom]));
    return { sense, effects };
  };
  const run = (words: string[], extra?: Expr) => c("Run", s(program), c("Args", ...words.slice(1).map((w) => s(w)), ...(extra ? [extra] : [])));
  // Each reading also comes in forms that name the tool, done with it or said of it ("git status":
  // status, with git; "the git log": the log, of git), so the tool's name picks its own command
  // where two tools share a word.
  const reading = (word: string, pattern: Expr, becomes: Expr, from: Expr, effects: Expr) => {
    forms.push(c("Reading", ["on", c(word)], ["pattern", pattern], ["becomes", becomes], ["effects", effects], ["from", from]));
    if (isCall(pattern))
      for (const r of ["instrument", "modifier"])
        forms.push(c("Reading", ["on", c(word)], ["pattern", { ...pattern, args: [...pattern.args, { name: r, value: c(toolWord) }] }], ["becomes", becomes], ["effects", effects], ["from", from]));
  };

  for (const sub of subs) {
    let doc: Expr;
    try {
      doc = await read.run([c("ManPage", s(sub.name), { kind: "number", value: sub.section, pos: { line: 0, column: 0 } })], world);
    } catch {
      skipped.push(sub.name);
      continue;
    }
    const lemma = sub.name.slice(program.length + 1);
    const usage = firstUsage(doc);
    const words = usage ? leadingWords(usage) : [];
    // The command line's words after the program are the subcommand; it must be the page's own.
    // The function-word lexicon is protected (design section 20): a word or form it has ("am" is
    // a form of "be") never gets a learned reading.
    if (words[0] !== program || words[1] !== lemma || protectedWord(lemma)) {
      skipped.push(sub.name);
      continue;
    }
    const pageFrom = c("ToolDoc", s(sub.name), s("NAME"));
    // A group of commands ("gh pr" lists gh-pr-view(1), gh-pr-create(1)...) names a kind of thing
    // its commands are done to: "view the pr" is gh pr view.
    const leaves = references(world.store, doc).filter((r) => r.name.startsWith(`${sub.name}-`));
    if (leaves.length) {
      const noun = names.word(lemma);
      const nounClaims: Expr[] = [];
      if (!store.facts(noun, "Lemma").length) nounClaims.push(c("Lemma", s(lemma)));
      if (!store.facts(noun, "Category").length) nounClaims.push(c("Category", c("Noun")));
      if (nounClaims.length) forms.push(c("Concept", c(noun), ...nounClaims, ["from", pageFrom]));
      for (const leaf of leaves) {
        let leafDoc: Expr;
        try {
          leafDoc = await read.run([c("ManPage", s(leaf.name), { kind: "number", value: leaf.section, pos: { line: 0, column: 0 } })], world);
        } catch {
          skipped.push(leaf.name);
          continue;
        }
        const verb = leaf.name.slice(sub.name.length + 1);
        const leafUsage = firstUsage(leafDoc);
        const leafWords = leafUsage ? leadingWords(leafUsage) : [];
        if (leafWords.join(" ") !== [program, lemma, verb].join(" ") || protectedWord(verb) || verb.includes("-")) {
          skipped.push(leaf.name);
          continue;
        }
        const leafFrom = c("ToolDoc", s(leaf.name), s("NAME"));
        const { word, claims } = act(verb, leafFrom);
        const { sense, effects } = await senseOf(word, leafDoc, leafFrom, leafUsage);
        forms.push(c("Concept", c(word), c("Sense", c(sense)), ...claims, ["from", leafFrom]));
        // Done to the group's kind of thing: the pr, a pr, pr.
        for (const theme of [c("Ref", ["kind", c(noun)]), c(noun), c("Some", c(noun)), c("Every", c(noun))])
          reading(word, c(word, ["theme", theme]), run(leafWords), leafFrom, effects);
        commands.push(`${lemma} ${verb}`);
      }
      continue;
    }
    const { word, claims } = act(lemma, pageFrom);
    const { sense, effects } = await senseOf(word, doc, pageFrom, usage);
    forms.push(c("Concept", c(word), c("Sense", c(sense)), ...claims, ["from", pageFrom]));
    // Told to do it, it runs the command. The pattern names no agent: in "commit and push" the
    // addressee is on the conjunction, not on each act. Its effects are what its summary claims:
    // a command that only shows is held to reading; any other is unknown, guarded, and offered
    // first (design sections 13 and 20).
    reading(word, c(word), run(words), pageFrom, effects);
    // A command line that takes a positional argument (a placeholder in its synopsis, not an
    // option's value) takes what the act is done to: "add a.txt" runs git add a.txt.
    if (usage && takesPlaceholder(usage)) reading(word, c(word, ["theme", v("x")]), run(words, v("x")), pageFrom, effects);
    commands.push(lemma);
  }
  // The terms were lent to the words to hear the summaries with; they are kept in the tool's pack.
  if (words) words.unload(`tool-${program}-terms`);
  return { text: format({ forms: forms as Call[] }), commands, skipped };
}

function isSeedPart(from: Expr, part: string): boolean {
  return isCall(from) && from.head === "Seed" && positional(from)[0]?.kind === "string" && (positional(from)[0] as { value: string }).value === part;
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
