import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSession } from "../assistant/index.js";
import { c, key } from "../runtime/expr.js";
import { PRIMITIVES } from "../runtime/primitives/index.js";
import { parseHelp } from "../runtime/primitives/helptext.js";
import { seededStore } from "../runtime/seed.js";
import { learnTool } from "./tooldocs.js";

// Help text in the common layouts (invented): a NAME line, a labelled usage with a continuation,
// headings ending in a colon or in capitals, items with two spaces or a colon, a description
// continued on more indented lines, and an option further right than the one before it.
const HELP = `zz - squeeze and stretch files [version 2]

Usage:  zz [options] <pattern> [FILES...]
        zz --list

Zz squeezes files, and stretches them back.

COMMANDS
  pack:     Pack files into an archive
  i, info   Show what an archive holds
            and how big it is

Options:
  -n, --dry-run          do nothing; say what would be done
      --level <n>        how hard to squeeze
  -o, --output FILE      where to write
`;

test("help text is read into usage lines, a summary, and items with their descriptions", () => {
  const h = parseHelp(HELP, ["zz"]);
  assert.equal(h.summary, "squeeze and stretch files");
  assert.deepEqual(h.usages, ["zz [options] <pattern> [FILES...]", "zz --list"]);
  const items = Object.fromEntries(h.sections.flatMap((x) => x.items).map((i) => [i.term, i.text]));
  assert.equal(items["pack"], "Pack files into an archive");
  assert.equal(items["i, info"], "Show what an archive holds and how big it is");
  assert.equal(items["-n, --dry-run"], "do nothing; say what would be done");
  assert.equal(items["--level <n>"], "how hard to squeeze");
  assert.equal(items["-o, --output FILE"], "where to write");
});

// A program with no manual page, only help (invented), on a PATH of its own: a group of commands
// ("ticket") done to a thing named by a number, one that only shows it, and one with an option.
const PQ = `#!/bin/sh
case "$*" in
  "--help") printf 'Work with tickets from the command line.\\n\\nUSAGE\\n  pq <command> [flags]\\n\\nCOMMANDS\\n  ticket:     Work with tickets\\n' ;;
  "ticket --help") printf 'Work with tickets.\\n\\nUSAGE\\n  pq ticket <command> [flags]\\n\\nCOMMANDS\\n  view:     View a ticket\\n  review:   Review a ticket\\n  close:    Close a ticket\\n' ;;
  "ticket view --help") printf 'View a ticket.\\n\\nUSAGE\\n  pq ticket view [<number>] [flags]\\n' ;;
  "ticket close --help") printf 'Close a ticket.\\n\\nUSAGE\\n  pq ticket close [<number>] [flags]\\n' ;;
  "ticket review --help") printf 'Review a ticket.\\n\\nUSAGE\\n  pq ticket review [<number>] [flags]\\n\\nFLAGS\\n  -a, --approve   Approve a ticket\\n' ;;
  ticket\\ view\\ *) echo "ticket $3: all good" ;;
  *) echo "pq: unknown $*" >&2; exit 2 ;;
esac
`;

// What the imports would give these words (testing.md section 2.1): viewing is reading.
const WORDS = `Pack(name="test-words", version="0", from=Seed("test"))
Concept(View(), Lemma("view"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())))
Reading(on=View(), pattern=View(agent=$a, theme=$t), becomes=Read($t))
Concept(Approve(), Lemma("approve"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())))
Concept(Close(), Lemma("close"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())))
Concept(Review(), Lemma("review"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())))
Concept(Ticket(), Lemma("ticket"), Category(Noun()))
Concept(Show(), Lemma("show"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())),
  Category(Act(), Takes(side=Right(), category=Thing(), role=Recipient()), Takes(side=Right(), category=Thing(), role=Topic())))
Reading(on=Show(), pattern=Show(agent=$agent, theme=$theme), becomes=Cause(agent=$agent, result=Become(Appear($theme))))
Reading(on=Show(), pattern=Show(agent=$agent, recipient=$recipient, topic=$topic), becomes=Cause(result=Become(HasInformation($recipient, $topic))))
`;

const confined = process.platform === "darwin";

function fakeProgram(): string {
  const bin = mkdtempSync(join(tmpdir(), "noodle-pq-"));
  writeFileSync(join(bin, "pq"), PQ);
  chmodSync(join(bin, "pq"), 0o755);
  if (!process.env.PATH?.startsWith(bin)) process.env.PATH = `${bin}:${process.env.PATH}`;
  return bin;
}

test("a program with only help is learned from it: commands, a number its noun takes, an option, and what only shows", { skip: !confined && "no confinement here" }, async () => {
  fakeProgram();
  const words = seededStore();
  words.load(WORDS);
  const store = seededStore();
  store.load(WORDS);
  const world = { root: tmpdir(), store, now: () => new Date(), say() {}, ask() {} };
  const r = await learnTool("pq", PRIMITIVES.get("Read")!, world, store, words);
  assert.ok(["ticket view", "ticket review", "ticket close"].every((x) => r.commands.includes(x)), r.commands.join());
  // The noun takes a number after it, as the commands' usage lines say ("pq ticket view [<number>]").
  assert.match(r.text, /Category\(Thing\(\), Takes\(side=Right\(\), category=Thing\(\), role=Number\(\), kind=Number\(\)\)\)/);
  // The option's description, understood, is a reading that adds its flag.
  assert.match(r.text, /pattern=Approve\(theme=Ticket\(number=\$x\)\),\s*becomes=Run\("pq", Args\("ticket", "review", \$x, "--approve"\)\)/);
  // "View a ticket" only shows something: held to reading. "Close a ticket" is unknown.
  assert.match(r.text, /pattern=View\(theme=Ticket\(number=\$x\)\),\s*becomes=Run\("pq", Args\("ticket", "view", \$x\)\),\s*effects=Reads\(\)/);
  assert.match(r.text, /pattern=Close\(theme=Ticket\(number=\$x\)\),\s*becomes=Run\("pq", Args\("ticket", "close", \$x\)\),\s*effects=UnknownEffects\(\)/);
  // One hierarchy: the program is a tool, each command one of its, each option one of the command's.
  assert.match(r.text, /Pq\(\),\s*Lemma\("pq"\),\s*IsA\(Tool\(\)\),\s*Name\("pq"\)/);
  assert.match(r.text, /IsA\(Command\(\)\),\s*PartOf\(Pq\(\)\),\s*Name\("pq ticket review"\)/);
  assert.match(r.text, /IsA\(Option\(\)\),\s*PartOf\(Review#PqTicketCommand\(\)\),\s*Name\("--approve"\)/);
  store.load(r.text);

  const sess = createSession(store, tmpdir());
  // The number fills the command's argument; showing the thing runs what only shows it, held.
  assert.match((await sess.turn("view ticket 12")).text, /pq ticket view 12[\s\S]*ticket 12: all good/);
  assert.match((await sess.turn("show me ticket 7")).text, /ticket 7: all good/);
  // An approval is offered, never run: what it changes is unknown and the reading is documentation's.
  assert.equal((await sess.turn("approve ticket 12")).text, "I can run `pq ticket review 12 --approve`, but I don't know yet what it changes. Go ahead?");
  // A word that is not a number does not fill a number's place.
  assert.doesNotMatch((await createSession(store, tmpdir()).turn("view ticket twelve")).text, /pq ticket view twelve/);
});

test("a program a request names is learned on demand: offered when it needs running, then the request read again; a yes is remembered", { skip: !confined && "no confinement here" }, async () => {
  fakeProgram();
  const store = seededStore();
  store.load(WORDS);
  const root = mkdtempSync(join(tmpdir(), "noodle-pq-root-"));
  const sess = createSession(store, root);
  assert.equal((await sess.turn("what does pq do")).text, "I can learn `pq` from its help (`pq --help`, run held to reading). Go ahead?");
  const yes = await sess.turn("yes");
  // Learned, and the request read again: a question about a program with subcommands, which only its commands answer.
  assert.match(yes.text, /^I learned `pq` from its help\./);
  assert.ok(store.packNames().includes("tool-pq"));
  // Said yes to, the command is the user's own way of saying it from now on (from=User), with the
  // number as a variable, and said alone too.
  const s2 = createSession(store, root);
  await s2.turn("close ticket 12");
  await s2.turn("yes");
  const mine = store.readingsOn("Close").filter((x) => key(x.meta.from) === key(c("User")));
  assert.ok(mine.some((x) => key(x.pattern) === key(c("Close", ["theme", c("Ticket", ["number", { kind: "variable", text: "$a1", pos: { line: 0, column: 0 } }])]))), mine.map((x) => key(x.pattern)).join());
  // Another session, another number, said without the noun: the same command comes back, offered.
  const s3 = createSession(store, root);
  assert.equal((await s3.turn("close 13")).text, "I can run `pq ticket close 13`, but I don't know yet what it changes. Go ahead?");
});

// A command with an option whose value is text (invented): what the request says, quoted or after
// "saying", is the option's value, as written.
const NT = `#!/bin/sh
case "$*" in
  "--help") printf 'Work with notes.\\n\\nUSAGE\\n  nt <command> [flags]\\n\\nCOMMANDS\\n  ticket:     Work with tickets\\n' ;;
  "ticket --help") printf 'Work with tickets.\\n\\nUSAGE\\n  nt ticket <command> [flags]\\n\\nCOMMANDS\\n  view:     View a ticket\\n  note:     Note a ticket\\n' ;;
  "ticket view --help") printf 'View a ticket.\\n\\nUSAGE\\n  nt ticket view [<number>] [flags]\\n' ;;
  "ticket note --help") printf 'Note a ticket.\\n\\nUSAGE\\n  nt ticket note [<number>] [flags]\\n\\nFLAGS\\n  -b, --body <text>   The note body text\\n  -R, --repo <repo>   Select another repository\\n  -p, --pin   Keep the note on top\\n' ;;
  *) echo "nt: unknown $*" >&2; exit 2 ;;
esac
`;

test("an option whose value is text takes what the request says, quoted or after saying, as written", { skip: !confined && "no confinement here" }, async () => {
  const bin = fakeProgram();
  writeFileSync(join(bin, "nt"), NT);
  chmodSync(join(bin, "nt"), 0o755);
  const extra = `${WORDS}
Concept(Note(), Lemma("note"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())))
Concept(Message(), Lemma("message"), IsA(Text()), Category(Noun()))
`;
  const words = seededStore();
  words.load(extra);
  const store = seededStore();
  store.load(extra);
  const world = { root: tmpdir(), store, now: () => new Date(), say() {}, ask() {} };
  const r = await learnTool("nt", PRIMITIVES.get("Read")!, world, store, words);
  // The text option takes the act's message; the repository option does not.
  assert.match(r.text, /pattern=Note\(theme=Ticket\(number=\$x\), message=\$said\),\s*becomes=Run\("nt", Args\("ticket", "note", \$x, "--body", \$said\)\)/);
  assert.doesNotMatch(r.text, /"--repo", \$said/);
  store.load(r.text);
  const offer = (cmd: string) => `I can run \`${cmd}\`, but I don't know yet what it changes. Go ahead?`;
  assert.equal((await createSession(store, tmpdir()).turn("note ticket 12 saying looks good")).text, offer(`nt ticket note 12 --body "looks good"`));
  assert.equal((await createSession(store, tmpdir()).turn("note ticket 12 with the message 'ship it'")).text, offer(`nt ticket note 12 --body "ship it"`));
  assert.equal((await createSession(store, tmpdir()).turn("note ticket 12 “all done”")).text, offer(`nt ticket note 12 --body "all done"`));
  // Without anything said, the command alone.
  const s = createSession(store, tmpdir());
  assert.equal((await s.turn("note ticket 12")).text, offer("nt ticket note 12"));
  // A correction that names a flag of the command offered: the command with it, kept for next time.
  const fixed = (await s.turn("no, use --pin")).text;
  assert.match(fixed, /Got it: for that I'll run `nt ticket note 12 --pin`/);
  assert.match(fixed, /I can run `nt ticket note 12 --pin`/);
  assert.equal((await createSession(store, tmpdir()).turn("note ticket 13")).text, offer("nt ticket note 13 --pin"));
  // A flag the command does not have is not a correction of it.
  const t = createSession(store, tmpdir());
  await t.turn("view ticket 3 saying hi");
  assert.doesNotMatch((await t.turn("no, use --pin")).text, /--pin/);
  // Or the whole command line, in backticks.
  const u = createSession(store, tmpdir());
  await u.turn("note ticket 14");
  assert.match((await u.turn("no, `nt ticket note 14 --body done`")).text, /Got it: for that I'll run `nt ticket note 14 --body done`/);
});
