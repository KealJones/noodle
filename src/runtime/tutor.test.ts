// ChatGPT as a tutor for choices (design section 17), with a fake ChatGPT behind Know: nothing
// here calls gptb or goes out. Invented words and harmless programs (echo) only.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSession } from "../assistant/index.js";
import { key } from "./expr.js";
import { Know } from "./know/know.js";
import { TUTOR, Weights, isTutor } from "./score.js";
import { seededStore } from "./seed.js";
import { Store } from "./store.js";
import { parseTutor, tutorPrompt, tutorThrough } from "./tutor.js";
import type { Session } from "./turn.js";

const root = () => mkdtempSync(join(tmpdir(), "noodle-tutor-"));

/** Two readings of "zap" that tie exactly: echo first, echo second, with the effects given. */
const zap = (effects: string) => `Pack(name="test-tutor", version="0", from=Seed("test"))
Concept(Zap(), Lemma("zap"), Category(Act()))
Reading(on=Zap(), pattern=Zap(), becomes=Run("echo", Args("first")), effects=${effects}())
Reading(on=Zap(), pattern=Zap(), becomes=Run("echo", Args("second")), effects=${effects}())
`;

/** A session whose tutor is a fake ChatGPT behind Know, answering with the option said `second`. */
function tutored(s: Session, store: Store, reply: (q: string) => string | undefined, asked: string[] = []) {
  const know = new Know(store, () => new Date(), {
    chatgpt: async (q) => {
      asked.push(q);
      return reply(q);
    },
  });
  s.world.know = know;
  s.tutor = tutorThrough(know);
  return asked;
}

/** The number the question gave the option that runs `echo second`. */
const second = (q: string) => /(\d+)\. run `echo second`/.exec(q)?.[1];

test("the reply is read strictly: three lines in order, a choice in range or none, a command in backticks or none, a because; prose after is not read", () => {
  assert.deepEqual(parseTutor("choice: 2\nsuggest: none\nbecause: It reads.", 3), { choice: 2, suggest: undefined, because: "It reads." });
  assert.deepEqual(parseTutor("\nChoice: none\n\nSuggest: `git log -5`\nBecause: Neither fits.\n\nHere is more about git log.", 3), { choice: null, suggest: "git log -5", because: "Neither fits." });
  for (const bad of [
    "choice: 4\nsuggest: none\nbecause: x",
    "choice: 2\nbecause: x",
    "choice: 2\nbecause: x\nsuggest: none",
    "choice: none\nsuggest: git log\nbecause: x",
    "I think 2.\nchoice: 2\nsuggest: none\nbecause: x",
    "choice: two\nsuggest: none\nbecause: x",
    "```\nchoice: 1\nsuggest: none\nbecause: x\n```",
    "",
  ])
    assert.equal(parseTutor(bad, 3), undefined, bad);
  const q = tutorPrompt("zap it", [{ who: "User", text: "hi" }, { who: "Self", text: "Hello." }], ["1. run `echo a`", "2. run `echo b`"]);
  assert.match(q, /the user: hi\nthe assistant: Hello\.\n\nThe request: zap it\n\nThe options:\n1\. run `echo a`\n2\. run `echo b`\n/);
  assert.match(q, /choice: <the option's number, or none>\nsuggest: <[^>]*backticks; otherwise none>\nbecause: <one sentence>$/);
});

test("a command ChatGPT suggests joins the numbered choice, marked, and is not run; picked, it is kept as a command the user gave", async () => {
  const store = seededStore();
  store.load(zap("UnknownEffects"));
  const s = createSession(store, root(), { grants: ["UnknownEffects"] });
  tutored(s, store, () => "choice: none\nsuggest: `echo third`\nbecause: Neither option is right.\n\nSome prose that is only kept.");
  const r = await s.turn("zap");
  assert.match(r.text, /^Did you mean one of these\?\n\n1\. run `echo (first|second)`\n\n2\. run `echo (first|second)`\n\n3\. run `echo third` \(ChatGPT's suggestion\)\n\nSay its number/);
  assert.deepEqual(r.acts, []);
  // Picked: kept for what "zap" means, as a command typed in backticks would be, and the request read again.
  const picked = (await s.turn("3")).text;
  assert.match(picked, /echo third/);
  assert.match(picked, /\nthird\n/);
  const again = (await s.turn("zap")).text;
  assert.match(again, /\nthird\n/);
  assert.doesNotMatch(again, /Did you mean/);
});

test("for acts with effects, the tutor's pick only orders the numbered choice, marked; it learns weakly, and a matching pick confirms its because", async () => {
  const store = seededStore();
  store.load(zap("UnknownEffects"));
  const s = createSession(store, root(), { grants: ["UnknownEffects"] });
  const asked = tutored(s, store, (q) => `choice: ${second(q)}\nsuggest: none\nbecause: Zap means echo.`);
  const r = await s.turn("zap");
  assert.equal(asked.length, 1);
  assert.match(asked[0], /The request: zap/);
  // Nothing ran: the user is asked, the tutor's pick first and marked.
  assert.match(r.text, /^Did you mean one of these\?\n\n1\. run `echo second` \(ChatGPT's pick\)\n\n2\. run `echo first`\n\nSay its number/);
  assert.deepEqual(r.acts, []);
  // A weak update, kept apart as the tutor's.
  assert.ok(s.weights.tutored.size > 0);
  assert.equal(s.weights.learned.size, 0);
  // The because, heard into proposals: Pending, from ChatGPT as a tutor.
  const reasons = r.record.reasons.map((x) => x.what).join("\n");
  assert.match(reasons, /ChatGPT's pick for "zap": \d, because Zap means echo\./);
  assert.match(reasons, /proposed from ChatGPT's because \(pending\)/);
  // Kept as proposals, Pending, where nothing reading the concept's facts finds them.
  const pending = store.facts("Tutor", "Proposes");
  assert.ok(pending.length > 0);
  assert.ok(pending.every((f) => f.meta.status === "Pending" && isTutor(f.meta.from)));
  assert.equal(store.factsWithHead("Mean").filter((f) => isTutor(f.meta.from)).length, 0);
  // The user picks the same: it runs, and the proposals have proved out into facts.
  assert.match((await s.turn("1")).text, /second/);
  assert.ok(pending.every((f) => store.item(f.meta.id)?.meta.status === "Active"));
  assert.ok(store.factsWithHead("Mean").some((f) => isTutor(f.meta.from) && f.meta.status === "Active"));
});

test("for acts that only read, the tutor's pick is taken for this turn, and the reply says so", async () => {
  const store = seededStore();
  store.load(zap("Reads"));
  const s = createSession(store, root(), {});
  tutored(s, store, (q) => `choice: ${second(q)}\nsuggest: none\nbecause: The second one.`);
  const r = await s.turn("zap");
  assert.match(r.text, /^ChatGPT thought you meant: run `echo second`\./);
  assert.match(r.text, /\nsecond\n/);
  assert.doesNotMatch(r.text, /Did you mean/);
});

test("where the winner is not sure enough and acts, it is offered as before; a no lists the tutor's pick first", async () => {
  const store = seededStore();
  store.load(`Pack(name="test-tutor2", version="0", from=Seed("test"))
Concept(Zap(), Lemma("zap"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())))
Reading(on=Zap(), pattern=Zap(theme=$x), becomes=Run("echo", Args("one", $x)), effects=UnknownEffects(), from=ToolDoc("test", "NAME"))
Reading(on=Zap(), pattern=Zap(theme=$x), wants=IsA($x, Moment()), becomes=Run("echo", Args("two", $x)), effects=UnknownEffects(), from=ToolDoc("test", "NAME"))
Reading(on=Zap(), pattern=Zap(theme=$x), wants=IsA($x, Moment()), becomes=Run("echo", Args("three", $x)), effects=UnknownEffects(), from=ToolDoc("test", "NAME"))
`);
  const s = createSession(store, root(), { askBelow: 0.99 });
  const asked = tutored(s, store, (q) => `choice: ${/(\d+)\. run `echo three 5`/.exec(q)?.[1]}\nsuggest: none\nbecause: Three.`);
  assert.match((await s.turn("zap 5")).text, /^I can run `echo one 5`/);
  assert.equal(asked.length, 1);
  assert.match((await s.turn("no")).text, /Did you mean one of these\?\n\n1\. run `echo three 5` \(ChatGPT's pick\)\n\n2\. run `echo two 5`/);
});

test("a reply not in the asked shape is ignored: the user is asked as before, and nothing is learned", async () => {
  const store = seededStore();
  store.load(zap("UnknownEffects"));
  const s = createSession(store, root(), { grants: ["UnknownEffects"] });
  tutored(s, store, () => "I would go with the second one!");
  const r = await s.turn("zap");
  assert.match(r.text, /^Did you mean one of these\?\n\n1\. run `echo (first|second)`\n\n2\./);
  assert.doesNotMatch(r.text, /ChatGPT/);
  assert.equal(s.weights.tutored.size, 0);
});

test("the tutor's weights: never on a feature the user taught, kept with their source, and left out when the tutor is off", () => {
  const store = new Store();
  const w = new Weights(store);
  w.learned.set("Evidence:a", 2);
  w.update(new Map([["Evidence:a", 1], ["Evidence:b", 1]]), new Map(), 0.25, 0.25, "tutor");
  assert.equal(w.get("Evidence:a"), 2);
  assert.equal(w.learned.get("Evidence:a"), 2);
  assert.equal(w.tutored.get("Evidence:b"), 0.25);
  assert.ok(!w.tutored.has("Evidence:a"));
  const text = w.toNcon();
  assert.match(text, new RegExp(`Weight\\("Evidence:b", 0.25\\), from=${key(TUTOR).replace(/[()]/g, "\\$&")}`));
  const kept = new Store();
  kept.load(text);
  assert.equal(new Weights(kept).get("Evidence:b"), 0.25);
  assert.equal(new Weights(kept).get("Evidence:a"), 2);
  // Off: what the tutor taught is not used, and not written.
  const off = new Weights(kept, false);
  assert.equal(off.get("Evidence:b"), 0);
  assert.doesNotMatch(off.toNcon(), /ChatGPT/);
});

test("with the tutor off in the config, ChatGPT is not asked about a choice", async () => {
  const store = seededStore();
  store.load(zap("UnknownEffects"));
  const s = createSession(store, root(), { tutor: false, know: true, chatgpt: false });
  assert.equal(s.tutor, undefined);
  assert.equal(s.weights.tutor, false);
});
