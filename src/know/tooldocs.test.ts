import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSession } from "../assistant/index.js";
import { PRIMITIVES } from "../runtime/primitives/index.js";
import { seededStore } from "../runtime/seed.js";
import { learnTool, summaryReader } from "./tooldocs.js";

// What the imports would give these words (testing.md section 2.1): VerbNet's "show" in its two
// frames (reflexive_appearance-48.1.2, transfer_mesg-37.1.1), a verb with no reading, and nouns.
const WORDS = `Pack(name="test-words", version="0", from=Seed("test"))
Concept(Show(), Lemma("show"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())),
  Category(Act(), Takes(side=Right(), category=Thing(), role=Recipient()), Takes(side=Right(), category=Thing(), role=Topic())))
Reading(on=Show(), pattern=Show(agent=$agent, theme=$theme), becomes=Cause(agent=$agent, result=Become(Appear($theme))))
Reading(on=Show(), pattern=Show(agent=$agent, recipient=$recipient, topic=$topic), becomes=Cause(result=Become(HasInformation($recipient, $topic))))
Concept(Record(), Lemma("record"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())))
Concept(Change(), Category(Noun()))
Concept(Peek(), Lemma("peek"), Category(Noun()), Category(Act()))
`;

test("a summary that only shows something claims to only read; any other leaves effects unknown", async () => {
  const words = seededStore();
  words.load(WORDS);
  const understand = summaryReader(words);
  assert.deepEqual((await understand("Show the peek"))?.effects, ["Reads"]);
  assert.equal((await understand("Record changes"))?.effects, undefined);
});

// A command a tool's documentation says only shows something (its readings claim Reads()).
const PEEK = `Pack(name="tool-peek", version="0", from=ToolDoc("peek"))
Reading(on=Peek(), pattern=Peek(), becomes=Run("ls", Args("-1")), effects=Reads(), from=ToolDoc("peek", "NAME"))
`;

test("a command claimed to only read runs held to reading, unasked, and is what it shows", { skip: process.platform !== "darwin" && "no confinement here" }, async () => {
  const store = seededStore();
  store.load(WORDS);
  store.load(PEEK);
  const root = mkdtempSync(join(tmpdir(), "noodle-peek-"));
  writeFileSync(join(root, "a.txt"), "hi\n");
  const s = createSession(store, root);
  assert.match((await s.turn("peek")).text, /^```\nls -1\n```\n\n```\na\.txt\n```$/);
  assert.match((await s.turn("show me the peek")).text, /a\.txt/);
  await s.turn("dont peek yet");
  assert.match((await s.turn("peek")).text, /^You said not to/);
});

const hasDocs = (() => {
  try {
    execFileSync("man", ["-w", "git-push"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("a tool's documentation gives its commands' words a sense that runs them, offered first", { skip: !hasDocs && "no git man pages here" }, async () => {
  const store = seededStore();
  const world = { root: tmpdir(), store, now: () => new Date(), say() {}, ask() {} };
  // The words to understand its pages with: here the seed alone, which has no word for "show", so
  // no summary is understood and every command's effects stay unknown.
  const r = await learnTool("git", PRIMITIVES.get("Read")!, world, store, seededStore());
  assert.ok(r.commands.includes("push") && r.commands.includes("status"));
  // Its glossary's terms that no pack has a noun for are its nouns, defined by it.
  assert.match(r.text, /Commit#GitTerm\(\),\s*SenseOf\(Commit\(\)\),\s*PartOfSpeech\(PartOfSpeechNoun\(\)\)/);
  assert.ok(!/effects=Reads\(\)/.test(r.text));
  // "am" is a form of the protected "be": never given a learned reading.
  assert.ok(!r.commands.includes("am"));
  store.load(r.text);

  const repo = mkdtempSync(join(tmpdir(), "noodle-git-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "a.txt"), "hi\n");
  const s = createSession(store, repo);
  const offer = await s.turn("git status");
  assert.equal(offer.text, "I can run `git status`, but I don't know yet what it changes. Go ahead?");
  const ran = await s.turn("yes");
  assert.match(ran.text, /^```\ngit status\n```\n\n```\n[\s\S]*a\.txt[\s\S]*```$/);
  await s.turn("dont push yet");
  assert.equal((await s.turn("push")).text, "You said not to run `git push` yet. Run `git push` now?");
});
