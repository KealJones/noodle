// Time, reminders and the workspace through whole turns: the seed with an invented lexicon
// (testing.md section 2.1) standing in for WordNet and VerbNet, and a clock the test sets.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSession } from "../assistant/index.js";
import { seededStore } from "./seed.js";

// What the imports would give these words: a part of speech, VerbNet's frame and semantics for
// "remind" (tell-37.2), and nothing else.
const LEXICON = `Pack(name="test-time", version="0", from=Seed("test"))
Fact(Moment(), Category(Noun()))
Fact(Day(), Category(Noun()))
Fact(Minute(), Category(Noun()))
Fact(Hour(), Category(Noun()))
Fact(Here(), Category(Noun()))
Concept(Good(), Category(Property()))
Concept(Remind(), Lemma("remind"), Category(Act(), Takes(side=Right(), category=Thing(), role=Recipient())))
Reading(on=Remind(), pattern=Remind(agent=$a, recipient=$r, topic=$t), becomes=Cause(agent=$a, result=Become(HasInformation($r, $t))))
Concept(Stretch(), Lemma("stretch"), Category(Act()))
Concept(Call(), Lemma("call"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())))
Concept(Mom(), Lemma("mom"), Category(Noun()))
`;

function session(root = mkdtempSync(join(tmpdir(), "noodle-time-"))) {
  const store = seededStore();
  store.load(LEXICON);
  const s = createSession(store, root);
  // Thursday, October 1, 2026, 9:05 PM where the user is.
  let now = new Date(2026, 9, 1, 21, 5);
  s.world.now = () => now;
  return { s, root, setNow: (t: Date) => (now = t) };
}

test("questions about the time and the date read the clock and say it in the user's time", async () => {
  const { s } = session();
  for (const ask of ["what time is it?", "what's the time", "what time is it now"]) assert.equal((await s.turn(ask)).text, "It's 9:05 PM.", ask);
  for (const ask of ["what day is it", "what is the date today", "what's the date", "what day is today"])
    assert.equal((await s.turn(ask)).text, "Today is Thursday, October 1.", ask);
});

test("the twelve-hour clock: midnight, noon and the minutes", async () => {
  const { s, setNow } = session();
  setNow(new Date(2026, 9, 1, 0, 7));
  assert.equal((await s.turn("what time is it")).text, "It's 12:07 AM.");
  setNow(new Date(2026, 9, 1, 12, 30));
  assert.equal((await s.turn("what time is it")).text, "It's 12:30 PM.");
});

test("time said in passing is not a question about the time", async () => {
  const { s } = session();
  for (const said of ["I had a good time", "the time is right"]) {
    const r = await s.turn(said);
    assert.ok(!r.text.startsWith("It's") && !r.text.startsWith("Today is"), `${said}: ${r.text}`);
  }
});

test("what is here is the workspace: its entries, and where it is", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "noodle-here-")));
  writeFileSync(join(root, "b.txt"), "x");
  writeFileSync(join(root, "a.md"), "y");
  mkdirSync(join(root, "src"));
  const { s } = session(root);
  for (const ask of ["what's in here", "what is here"]) assert.equal((await s.turn(ask)).text, "- `a.md`\n- `b.txt`\n- `src/`", ask);
  for (const ask of ["where are we", "where am i"]) assert.equal((await s.turn(ask)).text, `We're in \`${root}\`.`, ask);
});

test("a reminder is kept, listed, and said at the first turn after it falls due", async () => {
  const { s, setNow } = session();
  assert.equal((await s.turn("remind me tomorrow to call mom")).text, "I'll remind you tomorrow at 9:05 PM to call mom.");
  assert.equal((await s.turn("remind me in an hour to stretch")).text, "I'll remind you at 10:05 PM to stretch.");
  assert.equal((await s.turn("what will you remind me about?")).text, "- stretch, at 10:05 PM\n- call mom, tomorrow at 9:05 PM");
  setNow(new Date(2026, 9, 1, 22, 6));
  assert.equal((await s.turn("what time is it")).text, "Reminder: stretch.\n\nIt's 10:06 PM.");
  // Said once: it is off the schedule now.
  assert.equal((await s.turn("what time is it")).text, "It's 10:06 PM.");
  setNow(new Date(2026, 9, 3, 8, 0));
  assert.equal((await s.turn("what will you remind me about")).text, "Reminder: call mom.\n\nThere's nothing I'm going to remind you of.");
});

test("a dry run schedules nothing and says nothing that has fallen due", async () => {
  const { s, setNow } = session();
  await s.turn("remind me in an hour to stretch", { dry: true });
  setNow(new Date(2026, 9, 1, 23, 0));
  assert.equal((await s.turn("what will you remind me about")).text, "There's nothing I'm going to remind you of.");
});
