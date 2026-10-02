import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

// The regression of 0.21: with imported senses beside the seed's ("hi" the abbreviation, "thank"
// the verb) and a correction that had taught Unworked a weight of 0, the social reading tied with
// the imported one and lost. A reply is an answer, so it wins on ReachedAct as well.
test("a social turn keeps its reply beside imported senses and a learned Unworked weight", async () => {
  const store = seededStore();
  store.load(`Pack(name="test-imported", version="0", from=Seed("test"))
Concept(Hi(), Lemma("hi"), Category(Thing()))
Concept(Thank(), Lemma("thank"), Form("thanks", ThirdSingular()), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme(), optional=true)))
Fact(Feature(), Weight("Unworked", 0))
`);
  const s = createSession(store, mkdtempSync(join(tmpdir(), "noodle-turn-")));
  // Not won on the order of a tie: the social reading scores above every reading of the other sense.
  for (const [said, reply, other] of [["hi", "Hi.", "Hi("], ["thanks!", "You're welcome.", "Thank("]]) {
    const r = await s.turn(said);
    assert.equal(r.text, reply);
    const cands = r.record.reasons[0].candidates;
    const rival = Math.max(...cands.filter((x) => x.label.includes(other)).map((x) => x.score));
    assert.ok(cands[0].score > rival, `${said}: ${cands[0].score} vs ${rival}`);
  }
});

test("a question about the assistant or the user is answered from the graph, never from Know", async () => {
  const store = seededStore();
  store.load(LEXICON);
  // "name" as an import gives it: a noun.
  store.load(`Pack(name="test-name", version="0", from=Seed("test"))
Fact(Name(), Category(Noun()))
`);
  const s = createSession(store, mkdtempSync(join(tmpdir(), "noodle-turn-")));
  const asked: string[] = [];
  s.world.know = { cached: () => undefined, answer: async (q: string) => (asked.push(q), undefined) } as never;
  assert.equal((await s.turn("how are you?")).text, "I'm good, thanks.");
  assert.equal((await s.turn("what's your name")).text, "I'm Noodle.");
  assert.equal((await s.turn("what is my name?")).text, "You haven't told me that.");
  assert.equal((await s.turn("who are you")).text, "I don't know that about myself.");
  assert.deepEqual(asked, []);
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
  assert.equal((await s.turn("frobnicate the zorp")).text, "I don't know these words yet: frobnicate and zorp.");
  assert.equal((await s.turn("frobnicate")).text, "I don't know what `frobnicate` means here.");
});

test("asking what is in a file reads it and shows its content", async () => {
  const root = mkdtempSync(join(tmpdir(), "noodle-turn-"));
  writeFileSync(join(root, "README.md"), "# Hello\n");
  const s = createSession(seededStore(), root);
  for (const ask of ["what is in README.md?", "whats in readme.md", "whats in it?"]) {
    const r = await s.turn(ask);
    assert.equal(r.text, "`README.md`:\n\n```\n# Hello\n```", ask);
  }
});

test("two readings that tie exactly and do different things are asked about", async () => {
  const store = seededStore();
  store.load(`Pack(name="test-zap0", version="0", from=Seed("test"))
Concept(Zap(), Lemma("zap"), Category(Act()))
Reading(on=Zap(), pattern=Zap(), becomes=Run("echo", Args("first")), effects=UnknownEffects())
Reading(on=Zap(), pattern=Zap(), becomes=Run("echo", Args("second")), effects=UnknownEffects())
`);
  const s = createSession(store, mkdtempSync(join(tmpdir(), "noodle-turn-")), { grants: ["UnknownEffects"] });
  assert.match((await s.turn("zap")).text, /^Do you mean `echo (first|second)`, or `echo (first|second)`\?$/);
});

test("a correction flips the last choice to the next reading that acts, and the weights remember", async () => {
  const store = seededStore();
  store.load(`Pack(name="test-zap", version="0", from=Seed("test"))
Concept(Zap(), Lemma("zap"), Category(Act()))
Reading(on=Zap(), pattern=Zap(agent=Addressee()), becomes=Run("echo", Args("first")), effects=UnknownEffects())
Reading(on=Zap(), pattern=Zap(agent=Addressee()), wants=IsA(Zap(), Moment()), becomes=Run("echo", Args("second")), effects=UnknownEffects())
`);
  const s = createSession(store, mkdtempSync(join(tmpdir(), "noodle-turn-")), { grants: ["UnknownEffects"] });
  const first = await s.turn("zap");
  const ranFirst = first.text.includes("first");
  const flipped = await s.turn("no");
  assert.match(flipped.text, ranFirst ? /second/ : /first/);
  // The update moved toward the corrected reading: the next "zap" picks it.
  const again = await s.turn("zap");
  assert.match(again.text, ranFirst ? /second/ : /first/);
});

test("what a correction teaches is kept across sessions, in the store", async () => {
  const lex = `Pack(name="test-zap2", version="0", from=Seed("test"))
Concept(Zap(), Lemma("zap"), Category(Act()))
Reading(on=Zap(), pattern=Zap(), becomes=Run("echo", Args("first")), effects=UnknownEffects())
Reading(on=Zap(), pattern=Zap(), wants=IsA(Zap(), Moment()), becomes=Run("echo", Args("second")), effects=UnknownEffects())
`;
  const db = join(mkdtempSync(join(tmpdir(), "noodle-store-")), "store.db");
  const root = mkdtempSync(join(tmpdir(), "noodle-turn-"));
  const store1 = seededStore(undefined, db);
  store1.load(lex);
  const s1 = createSession(store1, root, { grants: ["UnknownEffects"], learn: true });
  const ranFirst = (await s1.turn("zap")).text.includes("first");
  await s1.turn("no");
  store1.close();
  // The same database opened again: the seed and the lexicon are not read again, and the
  // learned weights are there.
  const store2 = seededStore(undefined, db);
  assert.equal(store2.load(lex), 0);
  const s2 = createSession(store2, root, { grants: ["UnknownEffects"] });
  assert.match((await s2.turn("zap")).text, ranFirst ? /second/ : /first/);
});

test("a word taught with \"X means Y\" is echoed, kept when confirmed, and used", async () => {
  const store = seededStore();
  store.load(LEXICON);
  const s = createSession(store, mkdtempSync(join(tmpdir(), "noodle-turn-")));
  const echo = await s.turn("yeet means push");
  assert.equal(echo.text, 'So when you say "yeet", you mean "push"? I\'ll remember it if so.');
  assert.equal((await s.turn("yes")).text, 'Got it: "yeet" means "push".');
  await s.turn("dont push yet");
  assert.equal((await s.turn("yeet")).text, "You said not to push yet. Do it now?");
});

test("a weight change the replay gate vetoes is put back, and the flip still happens", async () => {
  const store = seededStore();
  store.load(`Pack(name="test-zap3", version="0", from=Seed("test"))
Concept(Zap(), Lemma("zap"), Category(Act()))
Reading(on=Zap(), pattern=Zap(), becomes=Run("echo", Args("first")), effects=UnknownEffects())
Reading(on=Zap(), pattern=Zap(), wants=IsA(Zap(), Moment()), becomes=Run("echo", Args("second")), effects=UnknownEffects())
`);
  const s = createSession(store, mkdtempSync(join(tmpdir(), "noodle-turn-")), { grants: ["UnknownEffects"] });
  let asked = 0;
  s.gate = async () => {
    asked++;
    return false;
  };
  const ranFirst = (await s.turn("zap")).text.includes("first");
  assert.match((await s.turn("no")).text, ranFirst ? /second/ : /first/);
  assert.equal(asked, 1);
  assert.equal(s.weights.learned.size, 0);
});
