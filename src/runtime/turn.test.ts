import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSession } from "../assistant/index.js";
import { key } from "./expr.js";
import { seededStore } from "./seed.js";

// An invented lexicon, standing in for imports (testing.md section 2.1: invented lexicons).
const LEXICON = `Pack(name="test-lexicon", version="0", from=Seed("test"))
Concept(Push(), Lemma("push"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme(), optional=true)))
Concept(Broken(), Lemma("broken"), Category(Property()))
`;

function session() {
  const store = seededStore();
  store.load(LEXICON);
  return createSession(store, mkdtempSync(join(tmpdir(), "noodle-turn-")));
}

test("a social turn gets the seed's reply and runs nothing", async () => {
  const s = session();
  assert.equal((await s.turn("thanks!!")).text, "You're welcome.");
  assert.equal((await s.turn("sorry byeeee")).text, "No worries.\n\nBye.");
});

test("don't push yet is a constraint until told, echoed, and blocks a later push", async () => {
  const s = session();
  const r = await s.turn("dont push yet");
  assert.ok(r.record.lf.some((x) => key(x).startsWith("Constraint(Not(Push(") && key(x).includes("until=Told()")), r.record.lf.map(key).join("; "));
  assert.equal(r.text, "Got it: I won't push until you say so.");
  assert.equal(s.conversation.rules.length, 1);
  const r2 = await s.turn("push");
  assert.equal(r2.text, "You said not to push yet. Do it now?");
});

test("a word it has no sense for is said, not guessed", async () => {
  const s = session();
  assert.equal((await s.turn("frobnicate the zorp")).text.split("\n\n")[0], "I don't know what `frobnicate` means here.");
});
