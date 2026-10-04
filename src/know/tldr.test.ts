import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSession } from "../assistant/index.js";
import { seededStore } from "../runtime/seed.js";
import { learnTldr, parseCommand, parsePage } from "./tldr.js";

// What the imports would give these words: an act that takes what it is done to, and nouns.
const WORDS = `Pack(name="test-words", version="0", from=Seed("test"))
Concept(Frob(), Lemma("frob"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())))
Concept(Widget(), Lemma("widget"), Category(Noun()))
Concept(Gadget(), Lemma("gadget"), Category(Noun()))
`;

// An invented page in tldr's shape: a tool nothing else knows.
const PAGE = `# zap

> Frobs widgets.
> More information: <https://example.invalid/zap>.

- Frob a widget:

\`zap {{[-f|--frob]}} {{widget_name}}\`

- Frob every gadget:

\`zap --all | cat\`

- Show sizes in a unit:

\`zap -{{b|k|m}}\`
`;

test("a page is read into its summary and examples; a command line into arguments and slots", () => {
  const p = parsePage(PAGE, "common")!;
  assert.equal(p.name, "zap");
  assert.deepEqual(p.summary, ["Frobs widgets."]);
  assert.deepEqual(
    p.examples.map((e) => e.description),
    ["Frob a widget", "Frob every gadget", "Show sizes in a unit"],
  );
  // An option offered in two spellings is the option, in its long one; a placeholder is a slot.
  assert.deepEqual(parseCommand("zap {{[-f|--frob]}} {{widget_name}}"), { args: [[{ text: "zap" }], [{ text: "--frob" }], [{ slot: "widget_name" }]] });
  // A slot written inside an argument is a piece of it; quotes keep what they hold as one.
  assert.deepEqual(parseCommand('lsof -i :{{port}} "a b"'), { args: [[{ text: "lsof" }], [{ text: "-i" }], [{ text: ":" }, { slot: "port" }], [{ text: "a b" }]] });
  // What only a shell does, and values offered with no name, are not run.
  assert.deepEqual(parseCommand("zap --all | cat"), { why: "shell syntax" });
  assert.deepEqual(parseCommand("zap -{{b|k|m}}"), { why: "a placeholder of values with no name" });
});

async function learned() {
  const words = seededStore();
  words.load(WORDS);
  const store = seededStore();
  store.load(WORDS);
  const r = await learnTldr([parsePage(PAGE, "common")!], store, words);
  return { store, r };
}

test("each example is a task: its description understood, its command a reading with slots", async () => {
  const { r } = await learned();
  assert.equal(r.pages, 1);
  assert.equal(r.examples, 3);
  assert.equal(r.skipped.length, 2);
  assert.equal(r.understood, 1);
  assert.equal(r.placed, 1);
  const text = r.text.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/,\s+/g, ", ");
  assert.match(text, /^Pack\(name="tldr", version="local", license="CC BY 4.0", from=Tldr\(\)\)/);
  // The tool, called by its name; the summary is its own, as a man page's is.
  assert.match(text, /Concept\(Zap\(\), Lemma\("zap"\), IsA\(Tool\(\)\), Name\("zap"\)/);
  assert.match(text, /body="Frobs widgets\."/);
  // The slot takes the place of what the description names it as: the request's value there, or
  // one of that kind named by its value.
  assert.match(text, /Describes\(Zap#Tldr1\(\), Frob\(theme=\$widget_name, agent=Addressee\(\)\)\)/);
  assert.match(text, /Describes\(Zap#Tldr1\(\), Frob\(theme=Widget\(\$widget_name\), agent=Addressee\(\)\)\)/);
  assert.match(text, /becomes=Run\("zap", Args\("--frob", \$widget_name\)\), effects=UnknownEffects\(\), from=Tldr\("common\/zap", 1\)/);
  // A widget may be named by a value after it.
  assert.match(text, /Fact\(Widget\(\), Category\(Thing\(\), Takes\(side=Right\(\), category=Thing\(\), role=Name\(\)\)\)/);
});

test("a request reaches an example by the scored match, its slot filled by what it says, never guessed", async () => {
  const { store, r } = await learned();
  store.load(r.text);
  const root = mkdtempSync(join(tmpdir(), "noodle-tldr-"));
  const s = createSession(store, root, { grants: [] });
  // Filled from the request, and offered: what it changes is unknown, and Tldr grants nothing.
  const said = (await s.turn("frob widget 42")).text;
  assert.match(said, /`zap --frob 42`/);
  assert.match(said, /Go ahead\?$/);
  assert.match((await s.turn("no")).text, /./);
  // Nothing says which widget: the slot is not guessed.
  assert.doesNotMatch((await s.turn("frob a widget")).text, /`zap --frob/);
  // A near-miss: another thing frobbed is not this example.
  assert.doesNotMatch((await s.turn("frob the gadget")).text, /zap/);
});
