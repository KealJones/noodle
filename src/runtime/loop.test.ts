// Try, offer, learn (design section 17): the scored match over what commands say they do, the
// numbered choice after a no, a command given in backticks for a step nothing could do, taught
// procedures with a slot whose steps feed each other, and all of it kept for the next session.
// Invented words and harmless programs (printf, echo) only.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSession } from "../assistant/index.js";
import { seededStore } from "./seed.js";

const root = () => mkdtempSync(join(tmpdir(), "noodle-loop-"));

const words = `Pack(name="test-loop", version="0", from=Seed("test"))
Concept(Zap(), Lemma("zap"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())))
Concept(Blip(), Lemma("blip"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())))
Concept(Bloop(), Lemma("bloop"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())))
`;

test("a procedure taught with a slot learns each step's command, chains them, and goes straight through next time", async () => {
  const store = seededStore();
  store.load(words);
  const dir = root();
  const config = { grants: ["UnknownEffects" as const] };
  const s = createSession(store, dir, config);
  assert.match((await s.turn("zap 42 means blip 42 and bloop it")).text, /^So when you say "zap 42", you mean "blip 42 and bloop it"\?/);
  assert.match((await s.turn("yes")).text, /in place of 42/);
  // Nothing does the first step yet: it says so, and asks for the command.
  assert.match((await s.turn("zap 7")).text, /Give me its command in backticks/);
  // Given, it is kept for the step (7 is the slot), and the request is read again: now the
  // second step is the one nothing does.
  const first = (await s.turn("`printf %s 7`")).text;
  assert.match(first, /Got it: for that I'll run `printf %s 7`/);
  assert.match(first, /Give me its command in backticks/);
  // The second step is given its command without what it is done to: it is given what the first printed.
  // Run (its effects granted here): the first step's output is the second's argument.
  const both = (await s.turn("`echo`")).text;
  assert.match(both, /printf %s 7\n```\n\n```\n7\n```\n\n```\necho 7\n```\n\n```\n7\n/);
  // A new session over the same store: another value, straight through, nothing asked.
  const t = createSession(store, dir, config);
  assert.match((await t.turn("zap 9")).text, /printf %s 9[^]*echo 9\n```\n\n```\n9\n/);
});

test("a no to an offer brings the other readings, numbered; a pick is learned as what the request means", async () => {
  const store = seededStore();
  store.load(`${words}
Reading(on=Zap(), pattern=Zap(theme=$x), becomes=Run("echo", Args("one", $x)), effects=UnknownEffects(), from=ToolDoc("test", "NAME"))
Reading(on=Zap(), pattern=Zap(theme=$x), wants=IsA($x, Moment()), becomes=Run("echo", Args("two", $x)), effects=UnknownEffects(), from=ToolDoc("test", "NAME"))
`);
  const dir = root();
  const s = createSession(store, dir, {});
  assert.match((await s.turn("zap 5")).text, /I can run `echo one 5`/);
  const list = (await s.turn("no")).text;
  assert.match(list, /Did you mean one of these\?\n\n1\. run `echo two 5`/);
  // Picked, it is offered (its effects are unknown), and kept from the user: the same request
  // with another value is that act from now on.
  assert.match((await s.turn("1")).text, /I can run `echo two 5`/);
  const t = createSession(store, dir, {});
  assert.match((await t.turn("zap 6")).text, /I can run `echo two 6`/);
});

test("a request no reading reaches is matched to what a command's summary says it does", async () => {
  const store = seededStore();
  store.load(`${words}
Concept(Zorch(), Lemma("zorch"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme())))
Concept(Frob(), Lemma("frob"), Category(Noun()))
Concept(Frob#Cmd(), SenseOf(Zap()), Describes(Frob#Cmd(), Zorch(agent=Addressee(), theme=Some(Frob()))), from=ToolDoc("frobtool", "NAME"))
Reading(on=Zap(), pattern=Zap(), becomes=Run("echo", Args("frobs")), effects=UnknownEffects(), from=ToolDoc("frobtool", "NAME"))
`);
  const s = createSession(store, root(), {});
  assert.match((await s.turn("zorch the frob")).text, /I can run `echo frobs`/);
  // Described alike by another command, the same fit is a guess between them (Match:Ambiguity):
  // neither is offered on it.
  store.load(`Pack(name="test-loop-2", version="0", from=Seed("test"))
Concept(Frob#Cmd2(), SenseOf(Blip()), Describes(Frob#Cmd2(), Zorch(agent=Addressee(), theme=Some(Frob()))), from=ToolDoc("frobtool2", "NAME"))
Reading(on=Blip(), pattern=Blip(), becomes=Run("echo", Args("other frobs")), effects=UnknownEffects(), from=ToolDoc("frobtool2", "NAME"))
`);
  assert.doesNotMatch((await createSession(store, root(), {}).turn("zorch the frob")).text, /I can run/);
});

test("\"when I say X, Y\" teaches the same as \"X means Y\"", async () => {
  const store = seededStore();
  store.load(words);
  const s = createSession(store, root(), {});
  assert.match((await s.turn("when I say zap 42, blip 42 and bloop it")).text, /^So when you say "zap 42", you mean "blip 42 and bloop it"\?/);
  assert.match((await s.turn("yes")).text, /in place of 42/);
  assert.match((await s.turn("zap 7")).text, /Give me its command in backticks/);
});

test("a command that needs an argument is not run without one: it asks for it", async () => {
  const store = seededStore();
  store.load(`${words}
Concept(Zip(), Lemma("zip"), Category(Act(), Takes(side=Right(), category=Thing(), role=Theme(), optional=true)))
Reading(on=Zip(), pattern=Zip(), becomes=Run("echo", Args(Gap("pid"))), effects=UnknownEffects(), from=ToolDoc("zip", "NAME"))
Reading(on=Zip(), pattern=Zip(theme=$x), becomes=Run("echo", Args($x)), effects=UnknownEffects(), from=ToolDoc("zip", "NAME"))
`);
  const s = createSession(store, root(), {});
  assert.equal((await s.turn("zip")).text, "To run `echo pid`, I need to know which pid.");
  assert.match((await s.turn("zip 12")).text, /I can run `echo 12`/);
});
