// Local before outside, and stuck then ask how (design sections 17 and 21), with a fake ChatGPT and
// fake world sources behind Know: nothing here calls gptb or goes out. Harmless programs (echo) only.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSession } from "../assistant/index.js";
import { Know } from "./know/know.js";
import { seededStore } from "./seed.js";
import type { Store } from "./store.js";
import { howPrompt, parseHow, tutorThrough } from "./tutor.js";
import type { Session } from "./turn.js";

const root = () => {
  const dir = mkdtempSync(join(tmpdir(), "noodle-how-"));
  writeFileSync(join(dir, "notes.txt"), "a\nb\n");
  return dir;
};

/**
 * A session whose Know has fake world sources (each question asked is recorded in `web`, and
 * answered by `page` if given) and, unless `reply` is undefined, a fake ChatGPT.
 */
function session(store: Store, reply?: (q: string) => string | undefined, page?: { title: string; text: string }) {
  const s = createSession(store, root(), { grants: ["SendsOutside"] });
  const asked: string[] = [];
  const web: string[] = [];
  const know = new Know(store, () => new Date(), reply ? { chatgpt: async (m) => { const q = typeof m === "string" ? m : (m.at(-1)?.content ?? ""); asked.push(q); return reply(q); } } : {});
  know.answer = async (q) => {
    web.push(q);
    return page ? { block: store.addBlock(page.text, "text/plain", { kind: "call", head: "Wikipedia", args: [], pos: { line: 0, column: 0 } }).id, title: page.title, url: "https://example.org/x", source: "Wikipedia" } : undefined;
  };
  know.learnAbout = async () => false;
  know.look = async () => undefined;
  s.world.know = know;
  if (reply) s.how = tutorThrough(know);
  return { s, asked, web };
}

const NONE = "kind: none\ncommand: none\nanswer: none\nask: none\nbecause: Nothing fits.";

test("the reply to how is read strictly: five lines in order, the kind naming what is given", () => {
  assert.deepEqual(parseHow("kind: command\ncommand: `ls -la`\nanswer: none\nask: none\nbecause: It lists them.\n\nMore prose."), { kind: "command", command: "ls -la", answer: undefined, ask: undefined, because: "It lists them." });
  assert.deepEqual(parseHow("Kind: answer\nCommand: none\nAnswer: It is 4.\nAsk: none\nBecause: Two and two."), { kind: "answer", command: undefined, answer: "It is 4.", ask: undefined, because: "Two and two." });
  assert.deepEqual(parseHow(NONE), { kind: "none", command: undefined, answer: undefined, ask: undefined, because: "Nothing fits." });
  for (const bad of [
    "kind: command\ncommand: none\nanswer: none\nask: none\nbecause: x",
    "kind: answer\ncommand: `ls`\nanswer: none\nask: none\nbecause: x",
    "kind: command\ncommand: ls\nanswer: none\nask: none\nbecause: x",
    "kind: maybe\ncommand: none\nanswer: none\nask: none\nbecause: x",
    "command: `ls`\nkind: command\nanswer: none\nask: none\nbecause: x",
    "Sure!\nkind: command\ncommand: `ls`\nanswer: none\nask: none\nbecause: x",
    "kind: command\ncommand: `ls`\nanswer: none",
    "",
  ])
    assert.equal(parseHow(bad), undefined, bad);
  const q = howPrompt("what branch am i on", [{ who: "User", text: "hi" }, { who: "Self", text: "Hello." }]);
  assert.match(q, /the user: hi\nthe assistant: Hello\.\n\nThe message: what branch am i on\n/);
  assert.match(q, /kind: <command, answer, or none>\ncommand: <[^>]*backticks; otherwise none>\nanswer: <[^>]*>\nask: <[^>]*>\nbecause: <one sentence>$/);
});

test("a question about here is never sent to the world's sources: with ChatGPT off it is stuck honestly", async () => {
  const { s, web } = session(seededStore(), undefined, { title: "Place (geography)", text: "A place is a location." });
  const r = await s.turn("what is this place");
  assert.match(r.text, /couldn't work out/);
  assert.deepEqual(web, []);
  assert.ok(r.record.reasons.some((x) => /is about here \(This\)/.test(x.what)));
  // A question about the world still is (the control).
  await s.turn("what is a cat");
  assert.deepEqual(web, ["what is a cat"]);
});

test("stuck, then ask how: a command ChatGPT gives is offered as its command line, never run; a yes keeps it for the question", async () => {
  const { s, asked, web } = session(seededStore(), () => "kind: command\ncommand: `echo here`\nanswer: none\nask: none\nbecause: It says where.");
  const r = await s.turn("what is this place");
  assert.match(r.text, /ChatGPT suggests: run `echo here`/);
  assert.deepEqual(r.acts, []);
  assert.deepEqual(web, []);
  assert.equal(asked.length, 1);
  assert.match(asked[0], /^kind: <command, answer, or none>$/m);
  // A yes keeps it as the user's reading, and the question is read again: it comes to the command,
  // which (nothing says what it changes) is offered.
  const yes = await s.turn("yes");
  assert.match(yes.text, /for that I'll run `echo here`/);
  assert.match(yes.text, /`echo here`.*Go ahead\?/s);
  const again = await s.turn("what is this place");
  assert.match(again.text, /`echo here`.*Go ahead\?/s);
  assert.equal(asked.length, 1);
});

test("an answer ChatGPT gives is said as from it; a reply in another shape, or none, leaves the honest stuck line", async () => {
  assert.match((await session(seededStore(), () => "kind: answer\ncommand: none\nanswer: It is a test place.\nask: none\nbecause: It is.").s.turn("what is this place")).text, /^From ChatGPT:\n\nIt is a test place\.$/);
  assert.match((await session(seededStore(), () => NONE).s.turn("what is this place")).text, /couldn't work out/);
  assert.match((await session(seededStore(), () => "It is a test place.").s.turn("what is this place")).text, /couldn't work out/);
});

test("a page that only shares a word with the question gives way to ChatGPT's answer; a page about what was asked does not", async () => {
  const loose = session(seededStore(), () => "kind: answer\ncommand: none\nanswer: A cat is a small animal.\nask: none\nbecause: It is.", { title: "Cat Stevens", text: "Cat Stevens is a singer." });
  assert.match((await loose.s.turn("what is a cat")).text, /From ChatGPT:\n\nA cat is a small animal\./);
  const none = session(seededStore(), () => NONE, { title: "Cat Stevens", text: "Cat Stevens is a singer." });
  assert.match((await none.s.turn("what is a cat")).text, /Cat Stevens is a singer/);
  const close = session(seededStore(), () => "kind: answer\ncommand: none\nanswer: A cat is a small animal.\nask: none\nbecause: It is.", { title: "Cat", text: "The cat is a small mammal." });
  assert.match((await close.s.turn("what is a cat")).text, /The cat is a small mammal/);
  assert.equal(close.asked.length, 0);
});

test("a command whose own documentation says it only reads runs held to reading after the yes", async () => {
  const store = seededStore();
  store.load(`Pack(name="test-how", version="0", from=Seed("test"))
Concept(Echo#ToolCommand(), IsA(Command()), Name("echo"), from=ToolDoc("echo", "NAME"))
Concept(Echo(), Lemma("echo"), Sense(Echo#ToolCommand()), Category(Act()), from=ToolDoc("echo", "NAME"))
Reading(on=Echo(), pattern=Echo(), becomes=Run("echo", Args()), effects=Reads(), from=ToolDoc("echo", "NAME"))
`);
  const { s } = session(store, () => "kind: command\ncommand: `echo here`\nanswer: none\nask: none\nbecause: It says where.");
  await s.turn("what is this place");
  const yes = await s.turn("yes");
  assert.doesNotMatch(yes.text, /Go ahead\?/);
  assert.match(yes.text, /\nhere\n/);
});

test("ChatGPT is asked with the conversation's last turns, both sides, and never about a turn only about the conversation", async () => {
  const { s, asked } = session(seededStore(), () => NONE);
  await s.turn("what is a cat");
  await s.turn("what is this place");
  assert.equal(asked.length, 2);
  assert.match(asked[1], /The conversation so far:\nthe user: what is a cat\nthe assistant: I couldn't work out "what is a cat"\.\n\nThe message: what is this place\n/);
  // An assent with nothing pending, a refusal, a pick by number: the conversation's own structure answers them.
  for (const p of ["yes", "yes go ahead", "no", "2"]) {
    const r = await s.turn(p);
    assert.equal(asked.length, 2, p);
    assert.doesNotMatch(r.text, /ChatGPT/, p);
  }
});

test("what ChatGPT asks back is answered here where it can be, and ChatGPT asked once more; otherwise the user is asked, and the reply goes back", async () => {
  // Answered here: what is in notes.txt is read from the workspace.
  const own = session(seededStore(), (q) =>
    /The assistant answered: `notes\.txt`/.test(q) ? "kind: command\ncommand: `echo two`\nanswer: none\nask: none\nbecause: It has two lines." : "kind: none\ncommand: none\nanswer: none\nask: what is in notes.txt\nbecause: It depends on the file.",
  );
  const r = await own.s.turn("what is this place");
  assert.equal(own.asked.length, 2);
  assert.match(own.asked[1], /You asked: what is in notes\.txt\nThe assistant answered: `notes\.txt`:/);
  assert.match(own.asked[1], /The message: what is this place\n/);
  assert.match(r.text, /ChatGPT suggests: run `echo two`/);
  // Not answered here: relayed as ChatGPT's, and the user's reply goes back with the message.
  const relayed = session(seededStore(), (q) =>
    /The user answered: the kitchen/.test(q) ? "kind: answer\ncommand: none\nanswer: It is the kitchen.\nask: none\nbecause: The user said so." : "kind: none\ncommand: none\nanswer: none\nask: which room are you in?\nbecause: It depends on where you are.",
  );
  const asks = await relayed.s.turn("what is this place");
  assert.equal(asks.text, "ChatGPT asks: which room are you in?");
  const back = await relayed.s.turn("the kitchen");
  assert.match(relayed.asked.at(-1)!, /You asked: which room are you in\?\nThe user answered: the kitchen\n/);
  assert.match(relayed.asked.at(-1)!, /The message: what is this place\n/);
  assert.match(back.text, /From ChatGPT:\n\nIt is the kitchen\./);
  // A turn that does something of its own is not a reply to ChatGPT's question.
  const own2 = session(seededStore(), () => "kind: none\ncommand: none\nanswer: none\nask: which room are you in?\nbecause: x");
  await own2.s.turn("what is this place");
  const stop = await own2.s.turn("what's in notes.txt");
  assert.match(stop.text, /`notes\.txt`:/);
  assert.equal(own2.asked.length, 1);
  // Never more than twice a turn: asked back again after an answer from here, it goes to the user.
  const twice = session(seededStore(), () => "kind: none\ncommand: none\nanswer: none\nask: what is in notes.txt\nbecause: x");
  assert.equal((await twice.s.turn("what is this place")).text, "ChatGPT asks: what is in notes.txt");
  assert.equal(twice.asked.length, 2);
});
