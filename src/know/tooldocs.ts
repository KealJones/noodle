// Learning a tool from its documentation (design sections 6 and 25): a documented command's name
// gives its word a sense. A tool's own page refers to its subcommands' pages (git(1) lists
// git-push(1)); each subcommand page's NAME gives its summary and its SYNOPSIS the command line.
// The word ("push") gets a sense whose reading becomes Run of that command, at the documentation's
// trust level (3, design section 20): a proposal, offered before it runs, since what a command
// changes is unknown until its description is understood (phase 4 proper).
//
// Nothing here knows git: the subcommand pages are found from the tool's page, by the man page
// reference convention, for any program.

import { createHash } from "node:crypto";
import { type Call, type Expr, c, isCall, positional, role, s, v } from "../runtime/expr.js";
import type { Primitive, World } from "../runtime/primitive.js";
import type { Store } from "../runtime/store.js";
import { format } from "../ncon/index.js";
import { Names, encodeLemma } from "./names.js";

export interface ToolResult {
  text: string;
  commands: string[];
  skipped: string[];
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

export async function learnTool(program: string, read: Primitive, world: World, store: Store): Promise<ToolResult> {
  const page = await read.run([c("ManPage", s(program))], world);
  const subs = references(world.store, page).filter((r) => r.name.startsWith(`${program}-`));
  const names = new Names(store);
  const from = c("ToolDoc", s(program));
  const forms: Expr[] = [c("Pack", ["name", s(`tool-${program}`)], ["version", s("local")], ["from", from])];
  const commands: string[] = [];
  const skipped: string[] = [];
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
    if (words[0] !== program || words[1] !== lemma) {
      skipped.push(sub.name);
      continue;
    }
    // The function-word lexicon is protected (design section 20): a word or form it has ("am" is
    // a form of "be") never gets a learned reading.
    if (store.lookup(lemma).some((h) => store.facts(h.concept).some((f) => isSeedPart(f.meta.from, "function-words")))) {
      skipped.push(sub.name);
      continue;
    }
    const pageFrom = c("ToolDoc", s(sub.name), s("NAME"));
    const word = names.word(lemma);
    const sense = `${word}#${encodeLemma(program) ?? "Tool"}Command`;
    const summary = blockText(world.store, role(doc, "summary"));
    const claims: Expr[] = [c("Sense", c(sense))];
    if (!store.facts(word, "Lemma").length) claims.unshift(c("Lemma", s(lemma)));
    // A command is something done: its word is an act that may take what it is done to.
    if (!store.facts(word, "Category").length)
      claims.push(c("Category", c("Act"), c("Takes", ["side", c("Right")], ["category", c("Thing")], ["role", c("Theme")], ["optional", { kind: "boolean", value: true, pos: { line: 0, column: 0 } }])));
    forms.push(c("Concept", c(word), ...claims, ["from", pageFrom]));
    const senseClaims: Expr[] = [c("SenseOf", c(word)), c("IsA", c("Program"))];
    if (summary) {
      const id = "b_" + createHash("sha256").update(summary).digest("hex").slice(0, 16);
      forms.push(c("Block", ["id", s(id)], ["media", s("text/plain")], ["body", s(summary)], ["from", pageFrom]));
      senseClaims.push(c("Said", c("Block", s(id))));
    }
    if (usage) senseClaims.push(c("Usage", c(sense), usage));
    forms.push(c("Concept", c(sense), ...senseClaims, ["from", pageFrom]));
    // Told to do it, it runs the command. What it changes is not known yet: unknown effects are
    // guarded, so it is offered first (design sections 13 and 20).
    forms.push(
      c(
        "Reading",
        ["on", c(word)],
        ["pattern", c(word, ["agent", c("Addressee")])],
        ["becomes", c("Run", s(program), c("Args", ...words.slice(1).map((w) => s(w))))],
        ["effects", c("UnknownEffects")],
        ["from", pageFrom],
      ),
    );
    // A command line that takes a positional argument (a placeholder in its synopsis, not an
    // option's value) takes what the act is done to: "add a.txt" runs git add a.txt.
    if (usage && takesPlaceholder(usage))
      forms.push(
        c(
          "Reading",
          ["on", c(word)],
          ["pattern", c(word, ["agent", c("Addressee")], ["theme", v("x")])],
          ["becomes", c("Run", s(program), c("Args", ...words.slice(1).map((w) => s(w)), v("x")))],
          ["effects", c("UnknownEffects")],
          ["from", pageFrom],
        ),
      );
    commands.push(lemma);
  }
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
